import { promisify } from 'node:util';
import child_process from 'node:child_process';
import fs from 'node:fs';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

import {
	FORCE_IGNORE_FILENAME,
	GIT_CHECKOUT_COMMAND,
	GIT_CLONE_COMMAND,
	GIT_COMMIT_COMMAND,
	GIT_PULL_COMMAND,
	GIT_PUSH_COMMAND,
	PACKAGE_ALIAS_DELIMITER,
	PACKAGE_BUILD_NUMBER,
	PACKAGE_ID_PREFIX,
	PACKAGE_INSTALL_COMMAND,
	PACKAGE_VERSION_CREATE_COMMAND,
	PACKAGE_VERSION_CREATE_REPORT_COMMAND,
	PACKAGE_VERSION_ID_PREFIX,
	PACKAGE_VERSION_INCREMENT,
	PACKAGE_VERSION_PROMOTE_COMMAND,
	SFDX_PROJECT_JSON_FILENAME,
	SOQL_QUERY_COMMAND
} from '../config';

import { error, github, sfdx } from '../util';

const exec = promisify(child_process.exec);

let packageAliases = {};
let reversePackageAliases = {};
let sfdxProjectJSON = {};

const SECRETS_CLIENT = new SecretsManagerClient({ region: process.env.AWS_REGION });
const GIT_CONFIG_VARS = {};

async function orchestrate({ pullRequestNumber, sortedPackagesToUpdate, updatedPackages = {} }, context) {
	try {
		Object.assign(
			GIT_CONFIG_VARS, 
			JSON.parse((await SECRETS_CLIENT.send(new GetSecretValueCommand({ SecretId: 'warehouse/gitConfigVars' }))).SecretString)
		);
		await cloneRepo(pullRequestNumber);
		process.stdout.write('Repo cloned\n');

		parseSFDXProjectJSON();
		await sfdx.authorize();
		let packageLimit = await sfdx.getRemainingPackageNumber();
		process.stdout.write(`Remaining package version creation limit is ${packageLimit}\n`);
		process.stdout.write(`List of packages to update is ${sortedPackagesToUpdate.join(', ')}\n`);

		updatedPackages = await updatePackages(packageLimit, sortedPackagesToUpdate, updatedPackages, context);

		await installPackages(updatedPackages);
		await github.deletePackageLabelFromIssue(pullRequestNumber);
		await github.mergeOpenPullRequest(pullRequestNumber);
		try {
			await pushUpdatedPackageJSON(updatedPackages);
		} catch (err) {
			console.error(err);
		}
	} catch (err) {
		error.fatal('orchestrate()', err);
	}
}

async function cloneRepo(pullRequestNumber) {
	let pullRequest = await github.getOpenPullRequestDetails({ pullRequestNumber });
	let stderr;

	if (fs.existsSync(process.env.REPOSITORY_NAME)) {
		({ _, stderr } = await exec(`rm -rf ${process.env.REPOSITORY_NAME}`));
		if (stderr) {
			error.fatal('cloneRepo()', stderr);
		}
	}

	({ _, stderr } = await exec(
		`${GIT_CLONE_COMMAND} -q https://${GIT_CONFIG_VARS.GITHUB_USERNAME}:${GIT_CONFIG_VARS.GITHUB_TOKEN}@${process.env.REPOSITORY_URL} -b ${pullRequest.head.ref}`
	));
	if (stderr) error.fatal('cloneRepo()', stderr);

	try {
		process.chdir(process.env.REPOSITORY_NAME);
	} catch (err) {
		error.fatal('cloneRepo()', err);
	}
}

function parseSFDXProjectJSON() {
	try {
		sfdxProjectJSON = JSON.parse(fs.readFileSync(SFDX_PROJECT_JSON_FILENAME));
		packageAliases = sfdxProjectJSON.packageAliases;
		reversePackageAliases = {};

		for (let alias in packageAliases) {
			reversePackageAliases[packageAliases[alias]] = alias;
		}
	} catch (err) {
		error.fatal('parseSFDXProjectJSON()', err);
	}
}

async function updatePackages(packageLimit, sortedPackagesToUpdate, updatedPackages, context) {
	updateForceIgnore();
	let query;
	const results = await context.runInChildContext( // what to do (if anything) with results?
		'updatePackages',
		async (childContext) => {
			for(let packageToUpdate of sortedPackagesToUpdate) {
				let stdout;
				let stderr;

				childContext.waitForCondition(
					async (state, _) => {
						const packageLimit = await sfdx.getRemainingPackageNumber();
						return { ...state, packageLimit };
					},
					{
						initialState: { packageLimit },
						waitStrategy: (state) => {
							state.packageLimit > 0 ? { shouldContinue : false } : { shouldContinue: true, delay: { hours: process.env.PACKAGE_LIMIT_WAIT_TIME }};
						}
					}
				);

				query = `SELECT MajorVersion, MinorVersion, PatchVersion FROM Package2Version WHERE Package2.Name='${packageToUpdate}' ORDER BY MajorVersion DESC, MinorVersion DESC, PatchVersion DESC`;
				({ stdout, stderr } = await exec(`${SOQL_QUERY_COMMAND} -q "${query}" -t -o ${process.env.HUB_ALIAS} --json`));
				if(stderr) error.fatal('updatePackages()', stderr);
				let mostRecentPackage = JSON.parse(stdout).result.records[0];
				let newPackageVersionNumber = `${mostRecentPackage.MajorVersion}.${mostRecentPackage.MinorVersion + PACKAGE_VERSION_INCREMENT}.${mostRecentPackage.PatchVersion}.${PACKAGE_BUILD_NUMBER}`;
				let newPackageVersionName = `${mostRecentPackage.MajorVersion}.${mostRecentPackage.MinorVersion + PACKAGE_VERSION_INCREMENT}`;
				process.stdout.write(`Creating package ${packageToUpdate} version ${newPackageVersionNumber}\n`);
				
				({ stdout, stderr } = await exec(
					`${PACKAGE_VERSION_CREATE_COMMAND} -p ${packageToUpdate} -n ${newPackageVersionNumber} -a ${newPackageVersionName} -x -c -v ${process.env.HUB_ALIAS} --json`
				));
				if(stderr) error.fatal('updatePackages()', stderr);
				const result = JSON.parse(stdout).result;
				if(result.Status !== 'Success' && result.Status !== 'Error') {
					childContext.waitForCondition(
						'checkPackageCreationStatus',
						async (state, _) => {
							({ stdout, stderr } = await exec(`${PACKAGE_VERSION_CREATE_REPORT_COMMAND} -i ${state.requestId} -v ${process.env.HUB_ALIAS} --json`));
							return { ...state, status: JSON.parse(stdout).result[0].Status};
						},
						{
							initialState: {
								requestId: result.Id,
								status: result.Status
							},
							waitStrategy: (state) => {
								state.status === 'Success' || state.status === 'Error' ? { shouldContinue: false } : { 
									shouldContinue: true, delay: { minutes: process.env.PACKAGE_CREATE_REPORT_WAIT_TIME }
								}
							}
						}
					)
				}

				({ stdout, stderr } = await exec(`${PACKAGE_VERSION_CREATE_REPORT_COMMAND} -i ${result.Id} -v ${process.env.HUB_ALIAS} --json`));
				if(stderr) error.fatal('updatePackages()', stderr);
				let subscriberPackageVersionId = JSON.parse(stdout).result[0].SubscriberPackageVersionId;
				process.stdout.write(`Releasing package ${packageToUpdate} version ${newPackageVersionNumber}\n`);

				({ stdout, stderr } = await exec(`${PACKAGE_VERSION_PROMOTE_COMMAND} -p ${subscriberPackageVersionId} -n --json`));
				if(stderr) error.fatal('updatePackages()', stderr);
				updatedPackages[`${packageToUpdate}@${newPackageVersionNumber}`] = subscriberPackageVersionId;

				await updatePackageJSON(packageToUpdate, newPackageVersionNumber);
				packageLimit--;
			}
		}
	);
	return { updatedPackages };
}

async function installPackages(updatedPackages) {
	for (let updatedPackageAlias in updatedPackages) {
		process.stdout.write(`Installing package ${updatedPackageAlias}\n`);
		let { stderr } = await exec(
			`${PACKAGE_INSTALL_COMMAND} -p ${updatedPackages[updatedPackageAlias]} -o ${process.env.HUB_ALIAS} -w ${process.env.PACKAGE_INSTALL_WAIT_TIME} -r --json`
		);
		if (stderr) error.fatal('installPackages()', stderr);
	}
}

async function pushUpdatedPackageJSON(updatedPackages) {
	let stderr;
	({ stderr } = await exec(`${GIT_CHECKOUT_COMMAND} main`));
	if (stderr) error.fatal('pushUpdatedPackageJSON()', stderr);

	({ stderr } = await exec(`${GIT_PULL_COMMAND}`))

	process.stdout.write('Updating sfdx-project.json and pushing to main');
	for (let updatedPackageAlias in updatedPackages) {
		sfdxProjectJSON.packageAliases[updatedPackageAlias] = updatePackages[updatedPackageAlias];
	}
	fs.writeFileSync(SFDX_PROJECT_JSON_FILENAME, JSON.stringify(sfdxProjectJSON, null, 2));
	({ stderr } = await exec(`${GIT_COMMIT_COMMAND} -m "${COMMIT_MESSAGE}" --author="${GIT_CONFIG_VARS.GIT_COMMIT_NAME} ${GIT_CONFIG_VARS.GIT_COMMIT_EMAIL}"`));
	if (stderr) error.fatal('pushUpdatedPackageJSON()', stderr);

	({ stderr } = await exec(GIT_PUSH_COMMAND));
	if (stderr) error.fatal('pushUpdatedPackageJSON()', stderr);
}

function updateForceIgnore() {
	let sourceDirectories = [];
	for (let packageDirectory of sfdxProjectJSON.packageDirectories) {
		sourceDirectories.push(packageDirectory.path);
	}

	let forceIgnore = fs.readFileSync(FORCE_IGNORE_FILENAME, { encoding: 'utf8' });
	let forceIgnoreLines = forceIgnore.split('\n');
	for (let i in forceIgnoreLines) {
		if (sourceDirectories.includes(forceIgnoreLines[i]) && (forceIgnoreLines[i].indexOf('#') == -1)) {
			forceIgnoreLines[i] = '#' + forceIgnoreLines[i];
		}
	}
	fs.writeFileSync(FORCE_IGNORE_FILENAME, forceIgnoreLines.join('\n'));
}

async function updatePackageJSON(packageName, fullPackageNumber) {
	for (let packageDirectory of sfdxProjectJSON.packageDirectories) {
		if (packageDirectory.dependencies) {
			for (let i in packageDirectory.dependencies) {
				if (packageName === await getPackageNameFromDependency(packageDirectory.dependencies[i])) {
					packageDirectory.dependencies[i] = {
						"package": packageName,
						"versionNumber": `${fullPackageNumber.substring(0, fullPackageNumber.lastIndexOf('.'))}.RELEASED`
					}
				}
			}
		}
	}

	fs.writeFileSync(SFDX_PROJECT_JSON_FILENAME, JSON.stringify(sfdxProjectJSON, null, 2));
	parseSFDXProjectJSON();
}

async function getPackageNameFromDependency(dependentPackage) {
	let endIndex = dependentPackage.package.indexOf(PACKAGE_ALIAS_DELIMITER);
	if (endIndex == -1) {
		endIndex = dependentPackage.package.length;
	}

	if (dependentPackage.package.startsWith(PACKAGE_VERSION_ID_PREFIX) && Object.keys(reversePackageAliases).includes(dependentPackage.package)) {
		let alias = reversePackageAliases[dependentPackage.package];
		return alias.slice(0, alias.indexOf(PACKAGE_ALIAS_DELIMITER));
	} else if (dependentPackage.package.startsWith(PACKAGE_VERSION_ID_PREFIX)) {
		let query = `SELECT Package2Id FROM Package2Version WHERE SubscriberPackageVersionId='${dependentPackage.package}'`
		const { stderr, stdout } = await exec(
			`${SOQL_QUERY_COMMAND} -q "${query}" -t -o ${process.env.HUB_ALIAS} --json`
		);

		if (stderr) error.fatal('getPackageNameFromDependency()', stderr);
		let result = JSON.parse(stdout).result.records;
		if (result.length > 0 && reversePackageAliases[result[0].Package2Id]) {
			return reversePackageAliases[result[0].Package2Id];
		}
	} else if (dependentPackage.package.startsWith(PACKAGE_ID_PREFIX)) {
		return reversePackageAliases[dependentPackage.package];
	} else {
		return dependentPackage.package.slice(0, endIndex);
	}
}

export {
	orchestrate
}