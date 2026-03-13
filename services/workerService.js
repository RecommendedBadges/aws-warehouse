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

async function orchestrate({ pullRequestNumber, sortedPackagesToUpdate = {} }, context) {
	try {
		process.stdout.write('Cloning repo\n');
		await cloneRepo(pullRequestNumber);

		process.stdout.write('Installing sf cli\n');
		await sfdx.install();
		process.stdout.write('Parsing sfdx-project.json\n');
		parseSFDXProjectJSON();
		process.stdout.write('Authorizing sf cli\n');
		await sfdx.authorize();
		process.stdout.write(`List of packages to update is ${sortedPackagesToUpdate.join(', ')}\n`);

		let updatedPackages = await updatePackages(sortedPackagesToUpdate, context);

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

	process.stdout.write(`Current folder contents before cloning: ${fs.readdirSync(process.cwd())}\n`);
	if (fs.existsSync(GIT_REPO_FOLDER)) {
		({ _, stderr } = await exec(`rm -rf ${GIT_REPO_FOLDER}`));
		if (stderr) error.fatal('cloneRepo()', stderr);
	}

	try {
		fs.mkdirSync(GIT_REPO_FOLDER);
	} catch(err) {
		error.fatal('cloneRepo()', err);
	}
	process.stdout.write('Created repository folder\n');

	const gitConfigVars = await secretsManager.getSecret('warehouse/gitConfigVars');
	try {
		({ _, stderr } = await exec(
			`${GIT_CLONE_COMMAND} -q https://${gitConfigVars.GITHUB_USERNAME}:${gitConfigVars.GITHUB_TOKEN}@${process.env.REPOSITORY_URL} -b ${pullRequest.head.ref} ${GIT_REPO_FOLDER}`
		));
		if (stderr) error.fatal('cloneRepo()', stderr);
	} catch (err) {
		process.stderr.write(`Error cloning repository: ${stderr}`);
		error.fatal('cloneRepo()', err);
	}

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

async function updatePackages(sortedPackagesToUpdate, context) {
	updateForceIgnore();
	let updatedPackages = {};
	let query;
	for(let packageToUpdate of sortedPackagesToUpdate) {
		let stdout;
		let stderr;

		let initialPackageLimit = await sfdx.getRemainingPackageNumber();
		process.stdout.write(`Remaining package version creation limit is ${initialPackageLimit}\n`);
		await context.waitForCondition(
			`check-package-limit-${packageToUpdate}`,
			async (state, _) => {
				const limit = await sfdx.getRemainingPackageNumber();
				process.stdout.write(`Remaining package version creation limit is ${limit}\n`);
				return { ...state, limit };
			},
			{
				initialState: { limit: initialPackageLimit },
				waitStrategy: (state) => state.limit > 0 ? 
					{ shouldContinue : false } : 
					{ shouldContinue: true, delay: { hours: process.env.PACKAGE_LIMIT_WAIT_TIME }}
			}
		);

		let { status, subscriberPackageVersionId, requestId, newPackageVersionNumber } = await context.step(
			`create-package-version-${packageToUpdate}`,
			async () => {
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

				({ stdout, stderr } = await exec(
					`${PACKAGE_VERSION_CREATE_COMMAND} -p ${packageToUpdate} -n ${newPackageVersionNumber} -a ${newPackageVersionName} -x -v ${process.env.HUB_ALIAS} -c --json`,
					{env: {...process.env, ...SF_HOME}}
				));
				if(stderr) error.fatal('updatePackages()', stderr);
				let result = JSON.parse(stdout).result;
				return { status: result.Status, subscriberPackageVersionId: result.SubscriberPackageVersionId, requestId: result.Id, newPackageVersionNumber };
			}
		);

		if(status !== 'Success' && status !== 'Error') {
			({ subscriberPackageVersionId } = await context.waitForCondition(
				`check-package-creation-status-${packageToUpdate}`,
				async (state, _) => {
					({ stdout, stderr } = await exec(
						`${PACKAGE_VERSION_CREATE_REPORT_COMMAND} -i ${requestId} -v ${process.env.HUB_ALIAS} --json`,
						{env: {...process.env, ...SF_HOME}}
					));
					if(stderr) error.fatal('updatePackages()', stderr);
					let packageCreateReportResult = JSON.parse(stdout).result[0];
					process.stdout.write(`Package ${packageToUpdate} version ${newPackageVersionNumber} creation status is ${packageCreateReportResult.Status}\n`);
					return { ...state, status: packageCreateReportResult.Status, subscriberPackageVersionId: packageCreateReportResult.SubscriberPackageVersionId};
				},
				{
					initialState: {
						requestId,
						status
					},
					waitStrategy: (state) => state.status === 'Success' || state.status === 'Error' ?
						{ shouldContinue: false } :
						{ shouldContinue: true, delay: { minutes: process.env.PACKAGE_CREATE_REPORT_WAIT_TIME } }
				}
			));
		}


		query = `SELECT IsReleased FROM Package2Version WHERE SubscriberPackageVersionId='${subscriberPackageVersionId}'`;
		({ stdout, stderr } = await exec(
			`${SOQL_QUERY_COMMAND} -q "${query}" -t -o ${process.env.HUB_ALIAS} --json`,
			{env: {...process.env, ...SF_HOME}}
		));
		if(stderr) error.fatal('updatePackages()', stderr);
		if(!JSON.parse(stdout).result.records[0].IsReleased) {
			process.stdout.write(`Releasing package ${packageToUpdate} version ${newPackageVersionNumber}\n`);
			({ stdout, stderr } = await exec(
				`${PACKAGE_VERSION_PROMOTE_COMMAND} -p ${subscriberPackageVersionId} -n --json`,
				{env: {...process.env, ...SF_HOME}}
			));
			if(stderr) error.fatal('updatePackages()', stderr);
		}

		updatedPackages[packageToUpdate] = {
			alias: `${packageToUpdate}@${newPackageVersionNumber}`,
			subscriberPackageVersionId,
			newPackageVersionNumber
		};
		await updatePackageJSON(packageToUpdate, newPackageVersionNumber);
	}
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
	for (let updatedPackage in updatedPackages) {
		process.stdout.write(`Installing package ${updatedPackage.alias}\n`);
		let { stderr } = await exec(
			`${PACKAGE_INSTALL_COMMAND} -p ${updatedPackage.alias} -o ${process.env.HUB_ALIAS} -w ${process.env.PACKAGE_INSTALL_WAIT_TIME} -r --json`,
			{env: {...process.env, ...SF_HOME}}
		);
		if (stderr) error.fatal('installPackages()', stderr);
	}
}

async function pushUpdatedPackageJSON(updatedPackages) {
	let stderr;
	({ stderr } = await exec(`${GIT_CHECKOUT_COMMAND} main`));
	if(stderr) error.fatal('pushUpdatedPackageJSON()', stderr);

	({ stderr } = await exec(`${GIT_PULL_COMMAND}`))
	if(stderr) error.fatal('pushUpdatedPackageJSON()', stderr);

	process.stdout.write('Updating sfdx-project.json and pushing to main');
	for (let updatedPackage in updatedPackages) {
		sfdxProjectJSON.packageAliases[updatedPackage.alias] = updatedPackage.subscriberPackageVersionId;
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