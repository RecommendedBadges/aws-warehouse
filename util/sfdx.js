import { promisify } from 'node:util';
import child_process from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

import { fatal } from './error.js';
import { getSecret } from './secretsManager.js';
import { AUTH_JWT_GRANT_COMMAND, CLI_SERVICE_AGREEMENT, LIMITS_API_DISPLAY_COMMAND, PACKAGE_LIMIT_NAME} from '../config';

const exec = promisify(child_process.exec);

async function install() {
    let stderr;
    let stdout;


   /* try {
        ({stdout, stderr} = await exec(`wget https://developer.salesforce.com/media/salesforce-cli/sf/channels/stable/sf-linux-x64.tar.gz`));
        ({stdout, stderr} = await exec(`mkdir -p /tmp/cli/sf`));
        ({stdout, stderr} = await exec(`tar -xf sf-linux-x64.tar.gz -C /tmp/cli/sf --strip-components 1`));
    } catch(err) {
        process.stdout.write(`Error running install CLI stderr: ${stderr}\n`);
        process.stdout.write(`Error running install CLI stdout: ${stdout}\n`);
    } */
    
    /*try {
        ({stdout, stderr} = await exec(`export PATH=/tmp/cli/sf/bin:$PATH`));
        process.stdout.write(`export command stdout: ${stdout}\n`);
    } catch(err) {
        process.stdout.write(`Error running export CLI stderr: ${stderr}\n`);
        process.stdout.write(`Error running export CLI stdout: ${stdout}\n`);
    }*/

    // manually create zshrc file?'

    /*try {
        ({stdout, stderr} = await exec(`export HOME=/tmp/`));
        process.stdout.write(`export command stdout: ${stdout}\n`);
    } catch(err) {
        process.stdout.write(`Error running export CLI stderr: ${stderr}\n`);
        process.stdout.write(`Error running export CLI stdout: ${stdout}\n`);
    }*/

        try {
        ({stdout, stderr} = await exec(`ls /var`));
        process.stdout.write(`ls /var command stdout: ${stdout}\n`);
    } catch(err) {
        process.stdout.write(`Error running ls /var CLI stderr: ${stderr}\n`);
        process.stdout.write(`Error running ls /var CLI stdout: ${stdout}\n`);
    }
        try {
        ({stdout, stderr} = await exec(`ls /var/lang`));
        process.stdout.write(`ls /var/lang command stdout: ${stdout}\n`);
    } catch(err) {
        process.stdout.write(`Error running ls /var/lang CLI stderr: ${stderr}\n`);
        process.stdout.write(`Error running ls /var/lang CLI stdout: ${stdout}\n`);
    }
        try {
        ({stdout, stderr} = await exec(`ls /var/lang/lib/`));
        process.stdout.write(`ls /var/lang/lib/ command stdout: ${stdout}\n`);
    } catch(err) {
        process.stdout.write(`Error running ls /var/lang/lib/ CLI stderr: ${stderr}\n`);
        process.stdout.write(`Error running ls /var/lang/lib/ CLI stdout: ${stdout}\n`);
    }
        try {
        ({stdout, stderr} = await exec(`ls /var/lang/lib/node_modules/`));
        process.stdout.write(`ls /var/lang/lib/node_modules/ command stdout: ${stdout}\n`);
    } catch(err) {
        process.stdout.write(`Error running ls /var/lang/lib/node_modules/ CLI stderr: ${stderr}\n`);
        process.stdout.write(`Error running ls /var/lang/lib/node_modules/ CLI stdout: ${stdout}\n`);
    }
    

    try {
        ({stdout, stderr} = await exec(`sf`));
        process.stdout.write(`sf command stdout: ${stdout}\n`);
    } catch(err) {
        process.stdout.write(`Error running sf command stderr: ${stderr}\n`);
        process.stdout.write(`Error running sf command stdout: ${stdout}\n`);
        process.stdout.write(`Error running sf command error: ${err}\n`);
        fatal('install()', err);

    }

    /*try {
        ({stdout, stderr} = await exec(`/tmp/cli/sf/bin/sf`));
        if(stderr) {
            fatal('authorize()', stderr);
        }
        process.stdout.write(`sf command stdout: ${stdout}\n`);
    } catch(err) {
        process.stdout.write(`Error running sf CLI stderr: ${stderr}\n`);
        process.stdout.write(`Error running sf CLI stdout: ${stdout}\n`);
        fatal('install()', err);
    }*/
}

async function authorize() {
    const certSecrets = await getSecret('warehouse/certificate');
    const HUB_CONSUMER_KEY = (await getSecret('warehouse/hubConsumerKey')).HUB_CONSUMER_KEY;
    const SERVER_KEY = (await getSecret('warehouse/serverKey')).SERVER_KEY;
    const HUB_USERNAME = (await getSecret('warehouse/hubUsername')).HUB_USERNAME;
    let stderr;
    let stdout;

    try {
        fs.writeFileSync(path.join('/tmp', 'server.key'), Buffer.from(SERVER_KEY, 'base64').toString('utf8'));
    } catch(err) {
        fatal('authorize()', err);
    }

    /*({stderr} = await exec(
        `openssl enc -nosalt -aes-256-cbc -d -in ${path.join('/var', 'task', 'assets', 'server.key.enc')} -out ${path.join('/var', 'task', 'assets', 'server.key')} -base64 -K ${certSecrets.DECRYPTION_KEY} -iv ${certSecrets.DECRYPTION_IV}`
    ));
    if(stderr) {
        fatal('authorize()', stderr);
    }*/

    try{
        ({stdout, stderr} = await exec(
            `npx sf`
        ));
        if(stderr) {
            fatal('authorize()', stderr);
        }
        process.stdout.write(`sf command stdout: ${stdout}\n`);
        ({stdout, stderr} = await exec(
            `${AUTH_JWT_GRANT_COMMAND} -i ${HUB_CONSUMER_KEY} -f ${path.join('/tmp', 'server.key')} -o ${HUB_USERNAME} -d -a ${process.env.HUB_ALIAS}`
        ));
        if(stderr && !stderr.includes(CLI_SERVICE_AGREEMENT)) {
            fatal('authorize()', stderr);
        }
    } catch(err) {
        process.stdout.write(`Error authorizing with SFDX CLI stderr: ${stderr}\n`);
        process.stdout.write(`Error authorizing with SFDX CLI stdout: ${stdout}\n`);
        /*({ stdout, stderr} = await exec(`sf doctor -c ${AUTH_JWT_GRANT_COMMAND} -i ${HUB_CONSUMER_KEY} -f ./server.key -o ${HUB_USERNAME} -d -a ${process.env.HUB_ALIAS}`))
        process.stdout.write(`Error authorizing with SFDX CLI cat sf doctor: ${stderr}\n`);
        process.stdout.write(`Error authorizing with SFDX CLI cat sf doctor: ${stdout}\n`);*/

        fatal('authorize()', err);
    }
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
