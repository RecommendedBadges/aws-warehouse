import { promisify } from 'node:util';
import child_process from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

import { fatal } from './error.js';
import { getSecret } from './secretsManager.js';
import { AUTH_JWT_GRANT_COMMAND, CLI_SERVICE_AGREEMENT, LIMITS_API_DISPLAY_COMMAND, PACKAGE_LIMIT_NAME, SF_HOME} from '../config';

const exec = promisify(child_process.exec);

async function install() {
    let stderr;
    let stdout;

   try {
        ({stdout, stderr} = await exec(`wget https://developer.salesforce.com/media/salesforce-cli/sf/channels/stable/sf-linux-x64.tar.gz`));
        ({stdout, stderr} = await exec(`mkdir -p /tmp/cli/sf`));
        ({stdout, stderr} = await exec(`tar -xf sf-linux-x64.tar.gz -C /tmp/cli/sf --strip-components 1`));
        process.env.PATH = '/tmp/cli/sf/bin:' + process.env.PATH;
    } catch(err) {
        fatal('install()', err);
    }
}

async function authorize() {
    const certSecrets = await getSecret('warehouse/certificate');
    const HUB_CONSUMER_KEY = (await getSecret('warehouse/hubConsumerKey')).HUB_CONSUMER_KEY;
    const SERVER_KEY = (await getSecret('warehouse/serverKey')).SERVER_KEY;
    const HUB_USERNAME = (await getSecret('warehouse/hubUsername')).HUB_USERNAME;
    let stderr;
    let stdout;
    process.stdout.write('retrieved secrets\n');
    process.stdout.write(`hub consumer key is ${HUB_CONSUMER_KEY}\n`);

    try {
        fs.writeFileSync(path.join('/tmp', 'server.key'), Buffer.from(SERVER_KEY, 'base64').toString('utf8'));
    } catch(err) {
        fatal('authorize()', err);
    }
    process.stdout.write('decoded server key\n');

    /*({stderr} = await exec(
        `openssl enc -nosalt -aes-256-cbc -d -in ${path.join('/var', 'task', 'assets', 'server.key.enc')} -out ${path.join('/var', 'task', 'assets', 'server.key')} -base64 -K ${certSecrets.DECRYPTION_KEY} -iv ${certSecrets.DECRYPTION_IV}`
    ));
    if(stderr) {
        fatal('authorize()', stderr);
    }*/

    try{

        process.stdout.write('about to doctor authorize with SFDX CLI\n');
        ({stdout, stderr} = await exec(
            `sf doctor -c "${AUTH_JWT_GRANT_COMMAND} -i ${HUB_CONSUMER_KEY} -f ${path.join('/tmp', 'server.key')} -o ${HUB_USERNAME} -d -a ${process.env.HUB_ALIAS}"`,
            {env: {...process.env, ...SF_HOME}}
        ));
        process.stdout.write('after doctor auth command execution\n');
        process.stdout.write('doctor authorize stdout: ' + stdout + '\n');
        process.stdout.write('doctor authorize stderr: ' + stderr + '\n');
        
        ({stdout, stderr} = await exec('ls'));
        process.stdout.write('ls stdout: ' + stdout + '\n');
        process.stdout.write('ls stderr: ' + stderr + '\n');

        process.stdout.write('about to authorize with SFDX CLI\n');
        ({stdout, stderr} = await exec(
            `${AUTH_JWT_GRANT_COMMAND} -i ${HUB_CONSUMER_KEY} -f ${path.join('/tmp', 'server.key')} -o ${HUB_USERNAME} -d -a ${process.env.HUB_ALIAS}`,
            {env: {...process.env, ...SF_HOME}}
        ));
        process.stdout.write('after auth command execution\n');
        if(stderr && !stderr.includes(CLI_SERVICE_AGREEMENT)) {
            fatal('authorize()', stderr);
        }
        process.stdout.write('authorized with SFDX CLI (in try block)\n');
    } catch(err) {
        process.stdout.write(`Error authorizing with SFDX CLI stderr: ${stderr}\n`);
        process.stdout.write(`Error authorizing with SFDX CLI stdout: ${stdout}\n`);
        /*({ stdout, stderr} = await exec(`sf doctor -c ${AUTH_JWT_GRANT_COMMAND} -i ${HUB_CONSUMER_KEY} -f ./server.key -o ${HUB_USERNAME} -d -a ${process.env.HUB_ALIAS}`))
        process.stdout.write(`Error authorizing with SFDX CLI cat sf doctor: ${stderr}\n`);
        process.stdout.write(`Error authorizing with SFDX CLI cat sf doctor: ${stdout}\n`);*/

        fatal('authorize()', err);
    }
    process.stdout.write('authorized with SFDX CLI\n');
}

async function getRemainingPackageNumber() {
    const {stdout, stderr} = await exec(`${LIMITS_API_DISPLAY_COMMAND} -o ${process.env.HUB_ALIAS} --json`);
    if(stderr) {
        fatal('getPackageLimit()', stderr);
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
