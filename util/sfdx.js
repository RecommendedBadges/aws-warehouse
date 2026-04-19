import { promisify } from 'node:util';
import child_process from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

import { fatal } from './error.js';
import { getSecret } from './secretsManager.js';
import { AUTH_JWT_GRANT_COMMAND, CLI_SERVICE_AGREEMENT, LIMITS_API_DISPLAY_COMMAND, PACKAGE_LIMIT_NAME, SF_HOME, SF_PATH, SF_TAR} from '../config';

const exec = promisify(child_process.exec);

async function install() {
    let stderr;
    let stdout;

    try {
        ({stdout, stderr} = await exec(`sf -v`));
        return;
    } catch(err) {
        process.stdout.write('Installing SF cli\n');
    }

    try {
        ({stdout, stderr} = await exec(`ls ${SF_PATH}`));
        process.stdout.write(`SF CLI path ls ${stdout}\n`);
    } catch(err) {
        process.stdout.write('Error listing directory for SF CLI\n');
    }

    const sfBinExists = fs.existsSync(`${SF_PATH}/bin/`)
    const sfPathExists = fs.existsSync(`${SF_PATH}/`)
    const sfTarExists = fs.existsSync(`${SF_TAR}`);

    try {
        if(sfBinExists) {
            addSFCliToPath();
            return;
        } else if(sfTarExists && !sfPathExists) {
            makeSFPathDir();
            uncompressSFCliTar();
            addSFCliToPath();
            return;
        } else if(sfTarExists && sfPathExists) {
            uncompressSFCliTar();
            addSFCliToPath();
            return;
        } else {
            process.stdout.write('Downloading SF CLI\n');
            ({stdout, stderr} = await exec(`wget https://developer.salesforce.com/media/salesforce-cli/sf/channels/stable/${SF_TAR}`));
            makeSFPathDir();
            uncompressSFCliTar();
            addSFCliToPath();
        }
    } catch(err) {
        fatal('install()', err);
    }
}

function addSFCliToPath() {
    process.stdout.write('Adding SF CLI to PATH\n');
    process.env.PATH = `${SF_PATH}/bin/:${process.env.PATH}`;
}

async function makeSFPathDir() {
    process.stdout.write(`Creating directory for SF CLI at ${SF_PATH}\n`);
    const {_, stderr} = await exec(`mkdir -p ${SF_PATH}`);
    if(stderr) fatal('makeSFPathDir()', stderr);
}

async function uncompressSFCliTar() {
    process.stdout.write(`Uncompressing SF CLI tar at ${SF_TAR}\n`);
    const {_, stderr} = await exec(`tar -xf ${SF_TAR} -C ${SF_PATH} --strip-components 1`);
    if(stderr) fatal('uncompressSFCliTar()', stderr);
}

async function authorize() {
    const AUTH_SECRETS = await getSecret('warehouse/authSecrets');
    let stderr;
    try {
        fs.writeFileSync(path.join('/tmp', 'server.key'), Buffer.from(AUTH_SECRETS.SERVER_KEY, 'base64').toString('utf8'));
    } catch(err) {
        fatal('authorize()', err);
    }

    try{
        process.stdout.write(`Path is ${process.env.PATH}\n`);
        ({_, stderr} = await exec(
            `${AUTH_JWT_GRANT_COMMAND} -i ${AUTH_SECRETS.HUB_CONSUMER_KEY} -f ${path.join('/tmp', 'server.key')} -o ${AUTH_SECRETS.HUB_USERNAME} -d -a ${process.env.HUB_ALIAS}`,
            {env: {...process.env, ...SF_HOME}}
        ));
        if(stderr && !stderr.includes(CLI_SERVICE_AGREEMENT)) {
            fatal('authorize()', stderr);
        }
    } catch(err) {
        fatal('authorize()', err);
    }
}

async function getRemainingPackageNumber() {
    const {stdout, stderr} = await exec(
        `${LIMITS_API_DISPLAY_COMMAND} -o ${process.env.HUB_ALIAS} --json`,
        {env: {...process.env, ...SF_HOME}}
    );
    if(stderr) {
        fatal('getRemainingPackageNumber()', stderr);
    }
    
    let remainingPackageNumber;
    for(let limit of JSON.parse(stdout).result) {
        if(limit.name === PACKAGE_LIMIT_NAME) {
            remainingPackageNumber = limit.remaining;
        }
    }
    return remainingPackageNumber;
}

export {
    authorize,
    getRemainingPackageNumber,
    install
};
