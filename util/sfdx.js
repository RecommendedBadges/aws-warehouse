import { promisify } from 'node:util';
import child_process from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

import { fatal } from './error.js';
import { getSecret } from './secretsManager.js';
import { AUTH_JWT_GRANT_COMMAND, CLI_SERVICE_AGREEMENT, LIMITS_API_DISPLAY_COMMAND, PACKAGE_LIMIT_NAME} from '../config';

const exec = promisify(child_process.exec);

async function authorize() {
    const certSecrets = await getSecret('warehouse/certificate');
    const HUB_CONSUMER_KEY = (await getSecret('warehouse/hubConsumerKey')).HUB_CONSUMER_KEY;
    const SERVER_KEY = (await getSecret('warehouse/serverKey')).SERVER_KEY;
    const HUB_USERNAME = (await getSecret('warehouse/hubUsername')).HUB_USERNAME;
    let stderr;

    process.stdout.write(`serverKey secret: ${await getSecret('warehouse/serverKey')}\n`);
        process.stdout.write(`serverKey secret: ${Object.keys(JSON.parse(await getSecret('warehouse/serverKey')))}\n`);

    process.stdout.write(`serverKey secret: ${(await getSecret('warehouse/serverKey'))["SERVER_KEY"]}\n`);


    /*process.stdout.write(`LAMBDA_TASK_ROOT ${process.env.LAMBDA_TASK_ROOT}\n`);
    let stdout;
    ({stdout, stderr} = await exec(`ls ${process.env.LAMBDA_TASK_ROOT}`));
    process.stdout.write(`LAMBDA_TASK_ROOT ${process.env.LAMBDA_RUNTIME_DIR}\n`);
    ({stdout, stderr} = await exec(`ls ${process.env.LAMBDA_RUNTIME_DIR}`));
    process.stdout.write(`stdout from ls command: ${stdout}\n`);
    ({stdout, stderr} = await exec('find server.key.enc /var/task/',  {maxBuffer: 1024 * 5000}));
    if(stderr) fatal('authorize()', stderr);
    process.stdout.write(`stdout from find command: ${stdout}\n`);*/

    try {
        fs.writeFileSync('./server.key', Buffer.from(SERVER_KEY, 'base64').toString('utf8'));
    } catch(err) {
        fatal('authorize()', err);
    }
/*// Create a buffer from the string
let bufferObj = Buffer.from(base64string, "base64");

// Encode the Buffer as a utf8 string
let decodedString = bufferObj.toString("utf8");


    ({stderr} = await exec(`echo "${SERVER_KEY}" | base64 -di > ./server.key`));
    if(stderr) fatal('authorize()', stderr);*/

    /*({stderr} = await exec(
        `openssl enc -nosalt -aes-256-cbc -d -in ${path.join('/var', 'task', 'assets', 'server.key.enc')} -out ${path.join('/var', 'task', 'assets', 'server.key')} -base64 -K ${certSecrets.DECRYPTION_KEY} -iv ${certSecrets.DECRYPTION_IV}`
    ));
    if(stderr) {
        fatal('authorize()', stderr);
    }*/

    ({stderr} = await exec(
        `${AUTH_JWT_GRANT_COMMAND} -i ${HUB_CONSUMER_KEY} -f ./server.key -o ${HUB_USERNAME} -d -a ${process.env.HUB_ALIAS}`
    ));
    if(stderr && !stderr.includes(CLI_SERVICE_AGREEMENT)) {
        fatal('authorize()', stderr);
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
    getRemainingPackageNumber
};
