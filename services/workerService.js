import path from 'node:path';
import { promisify } from 'node:util';
import child_process from 'node:child_process';
import fs from 'node:fs';

import {
	FORCE_IGNORE_FILENAME,
	GIT_CHECKOUT_COMMAND,
	GIT_CLONE_COMMAND,
	GIT_COMMIT_COMMAND,
	GIT_PULL_COMMAND,
	GIT_PUSH_COMMAND,
	GIT_REPO_FOLDER,
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
	SF_HOME,
	SOQL_QUERY_COMMAND
} from '../config';

import { error, github, secretsManager, sfdx } from '../util';

const exec = promisify(child_process.exec);

let packageAliases = {};
let reversePackageAliases = {};
let sfdxProjectJSON = {};

async function orchestrate({ pullRequestNumber, sortedPackagesToUpdate, updatedPackages = {} }, context) {
	try {
		process.stdout.write('Cloning repo\n');
		await cloneRepo(pullRequestNumber);

		process.stdout.write('Installing sf cli\n');
		await sfdx.install();
		process.stdout.write('Parsing sfdx-project.json\n');
		parseSFDXProjectJSON();
		process.stdout.write('Authorizing sf cli\n');
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
			process.stderr.write(err);
		}
	} catch (err) {
		error.fatal('orchestrate()', err);
	}
}

async function cloneRepo(pullRequestNumber) {
	let pullRequest = await github.getOpenPullRequestDetails({ pullRequestNumber });
	let stderr;

	if (fs.existsSync(GIT_REPO_FOLDER)) {
		({ _, stderr } = await exec(`rm -rf ${GIT_REPO_FOLDER}`));
		if (stderr) error.fatal('cloneRepo()', stderr);
	}

	try {
		fs.mkdirSync(GIT_REPO_FOLDER);
	} catch(err) {
		error.fatal('cloneRepo()', err);
	}

	const gitConfigVars = await secretsManager.getSecret('warehouse/gitConfigVars');
	({ _, stderr } = await exec(
		`${GIT_CLONE_COMMAND} -q https://${gitConfigVars.GITHUB_USERNAME}:${gitConfigVars.GITHUB_TOKEN}@${process.env.REPOSITORY_URL} -b ${pullRequest.head.ref} ${GIT_REPO_FOLDER}`
	));
	if (stderr) error.fatal('cloneRepo()', stderr);

	try {
		process.chdir(GIT_REPO_FOLDER);
	} catch (err) {
		error.fatal('cloneRepo()', err);
	}
}

function parseSFDXProjectJSON() {
	try {
		sfdxProjectJSON = JSON.parse(fs.readFileSync(path.join(GIT_REPO_FOLDER, SFDX_PROJECT_JSON_FILENAME)));
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

				await childContext.waitForCondition(
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

				query = `SELECT MajorVersion, MinorVersion, PatchVersion, BuildNumber, IsReleased FROM Package2Version WHERE Package2.Name='${packageToUpdate}' ORDER BY MajorVersion DESC, MinorVersion DESC, PatchVersion DESC, BuildNumber DESC LIMIT 1`;
				({ stdout, stderr } = await exec(
					`${SOQL_QUERY_COMMAND} -q "${query}" -t -o ${process.env.HUB_ALIAS} --json`,
				    {env: {...process.env, ...SF_HOME}}
				));
				if(stderr) error.fatal('updatePackages()', stderr);
				let latestPackageVersion = JSON.parse(stdout).result.records[0];
				let newPackageVersionNumber = latestPackageVersion.IsReleased ? 
					`${latestPackageVersion.MajorVersion}.${latestPackageVersion.MinorVersion + PACKAGE_VERSION_INCREMENT}.${latestPackageVersion.PatchVersion}.${PACKAGE_BUILD_NUMBER}` :
					`${latestPackageVersion.MajorVersion}.${latestPackageVersion.MinorVersion}.${latestPackageVersion.PatchVersion}.${Number.parseInt(latestPackageVersion.BuildNumber) + 1}`;
				let newPackageVersionName = latestPackageVersion.IsReleased ? 
					`${latestPackageVersion.MajorVersion}.${latestPackageVersion.MinorVersion + PACKAGE_VERSION_INCREMENT}` :
					`${latestPackageVersion.MajorVersion}.${latestPackageVersion.MinorVersion}`;
				process.stdout.write(`Creating package ${packageToUpdate} version ${newPackageVersionNumber}\n`);
				try {
				({ stdout, stderr } = await exec(
					`${PACKAGE_VERSION_CREATE_COMMAND} -p ${packageToUpdate} -n ${newPackageVersionNumber} -a ${newPackageVersionName} -x -v ${process.env.HUB_ALIAS} --skip-validation --json`, // remove skip-validation later, -c
					{env: {...process.env, ...SF_HOME}}
				));

				} catch(err) {
					process.stdout.write(`stdout ${stdout}\n`);
					process.stderr.write(`stderr ${stderr}\n`);
					error.fatal('updatePackages()', err);
				}
				if(stderr) error.fatal('updatePackages()', stderr);
				const result = JSON.parse(stdout).result;
				process.stdout.write(`Package version creation result: ${JSON.stringify(result)}\n`);
								process.stdout.write(`Package version creation result status: ${JSON.stringify(result.Status)}\n`);

				if(result.Status !== 'Success' && result.Status !== 'Error') {
					await childContext.waitForCondition(
						'checkPackageCreationStatus',
						async (state, _) => {
							process.stdout.write('in waitForCondition\n');
							process.stdout.write(`waitForCondition state ${JSON.stringify(state)}\n`);
							({ stdout, stderr } = await exec(
								`${PACKAGE_VERSION_CREATE_REPORT_COMMAND} -i ${state.requestId} -v ${process.env.HUB_ALIAS} --json`,
								{env: {...process.env, ...SF_HOME}}
							));
							process.stdout.write(`package version create report stdout ${stdout}\n`);
							return { ...state, status: JSON.parse(stdout).result[0].Status };
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

				process.stdout.write(`results after waitForCondition ${JSON.stringify(result)}\n`);
				//process.exit(1);
				({ stdout, stderr } = await exec(
					`${PACKAGE_VERSION_CREATE_REPORT_COMMAND} -i ${JSON.parse(JSON.stringify(result)).Id} -v ${process.env.HUB_ALIAS} --json`,
					{env: {...process.env, ...SF_HOME}}
				));
				if(stderr) error.fatal('updatePackages()', stderr);
				process.stdout.write(`Releasing package ${packageToUpdate} version ${newPackageVersionNumber}\n`);
				let subscriberPackageVersionId = result.SubscriberPackageVersionId;

				({ stdout, stderr } = await exec(
					`${PACKAGE_VERSION_PROMOTE_COMMAND} -p ${subscriberPackageVersionId} -n --json`,
					{env: {...process.env, ...SF_HOME}}
				));
				if(stderr) error.fatal('updatePackages()', stderr);
				updatedPackages[`${packageToUpdate}@${newPackageVersionNumber}`] = subscriberPackageVersionId;

				await updatePackageJSON(packageToUpdate, newPackageVersionNumber);
				packageLimit--;
			}
		}
	);
	return { updatedPackages };
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
			`${SOQL_QUERY_COMMAND} -q "${query}" -t -o ${process.env.HUB_ALIAS} --json`,
			{env: {...process.env, ...SF_HOME}}
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

async function installPackages(updatedPackages) {
	for (let updatedPackageAlias in updatedPackages) {
		process.stdout.write(`Installing package ${updatedPackageAlias}\n`);
		let { stderr } = await exec(
			`${PACKAGE_INSTALL_COMMAND} -p ${updatedPackages[updatedPackageAlias]} -o ${process.env.HUB_ALIAS} -w ${process.env.PACKAGE_INSTALL_WAIT_TIME} -r --json`,
			{env: {...process.env, ...SF_HOME}}
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

	const gitConfigVars = await secretsManager.getSecret('warehouse/gitConfigVars');
	({ stderr } = await exec(`${GIT_COMMIT_COMMAND} -m "${COMMIT_MESSAGE}" --author="${gitConfigVars.GIT_COMMIT_NAME} ${gitConfigVars.GIT_COMMIT_EMAIL}"`));
	if (stderr) error.fatal('pushUpdatedPackageJSON()', stderr);

	({ stderr } = await exec(GIT_PUSH_COMMAND));
	if (stderr) error.fatal('pushUpdatedPackageJSON()', stderr);
}

export {
	orchestrate
}