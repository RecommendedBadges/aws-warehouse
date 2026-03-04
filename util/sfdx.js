import { promisify } from 'node:util';
import child_process from 'node:child_process';
import { once } from 'node:events';
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
        process.env.PATH = '/tmp/cli/sf/bin/:' + process.env.PATH;
    } catch(err) {
        fatal('install()', err);
    }
}

async function authorize() {
    const AUTH_SECRETS = await getSecret('warehouse/authSecrets');
    process.stdout.write(`Auth secrets ${JSON.stringify(AUTH_SECRETS)}\n`);
    process.stdout.write(`Auth secrets SERVER_KEY ${AUTH_SECRETS.SERVER_KEY}\n`);
    process.stdout.write(`Auth secrets HUB_CONSUMER_KEY ${AUTH_SECRETS.HUB_CONSUMER_KEY}\n`);
    process.stdout.write(`Auth secrets HUB_USERNAME ${AUTH_SECRETS.HUB_USERNAME}\n`);
    let stderr;
    try {
        fs.writeFileSync(path.join('/tmp', 'server.key'), Buffer.from(AUTH_SECRETS.SERVER_KEY, 'base64').toString('utf8'));
    } catch(err) {
        fatal('authorize()', err);
    }
    //process.stdout.write(`decoded server key ${fs.readFileSync(path.join('/tmp', 'server.key'), 'utf8')}\n`);

    try{
        process.stdout.write('about to authorize with sf cli\n');
        process.stdout.write(`PATH is ${process.env.PATH}\n`);
        process.stdout.write(`Running command: ${AUTH_JWT_GRANT_COMMAND} -i ${AUTH_SECRETS.HUB_CONSUMER_KEY} -f ${path.join('/tmp', 'server.key')} -o ${AUTH_SECRETS.HUB_USERNAME} -d -a ${process.env.HUB_ALIAS}\n`);

        process.stdout.write(`env is ${JSON.stringify({...process.env, ...SF_HOME})}\n`);

        const authCommand = child_process.spawn(
            `${AUTH_JWT_GRANT_COMMAND} -i ${AUTH_SECRETS.HUB_CONSUMER_KEY} -f ${path.join('/tmp', 'server.key')} -o ${AUTH_SECRETS.HUB_USERNAME} -d -a ${process.env.HUB_ALIAS}`,
            {
                env: {...process.env, ...SF_HOME},
                shell: true
            }
        );

        authCommand.stdout.on('data', (data) => {
        process.stdout.write(`stdout: ${data}`);
        });

        authCommand.stderr.on('data', (data) => {
        process.stdout.write(`stderr: ${data}`);
        });

        const [code] = await once(authCommand, 'close');
        process.stdout.write(`child process exited with code ${code}\n`);
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
    process.stdout.write(`PATH is ${process.env.PATH}\n`);
    const {stdout, stderr} = await exec(
        `${LIMITS_API_DISPLAY_COMMAND} -o ${process.env.HUB_ALIAS} --json`,
        {env: {...process.env, ...SF_HOME}}
    );
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
