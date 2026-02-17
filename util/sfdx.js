import { promisify } from 'node:util';
import child_process from 'node:child_process';

import { fatal } from './error.js';
import { getSecret } from './secretsManager.js';
import { AUTH_JWT_GRANT_COMMAND, CLI_SERVICE_AGREEMENT, LIMITS_API_DISPLAY_COMMAND, PACKAGE_LIMIT_NAME} from '../config';

const exec = promisify(child_process.exec);

async function authorize() {
    const certSecrets = await getSecret('warehouse/certificate');
    const HUB_CONSUMER_KEY = (await getSecret('warehouse/hubConsumerKey')).HUB_CONSUMER_KEY;
    let stderr;

    ({stderr} = await exec(
        `openssl enc -nosalt -aes-256-cbc -d -in ../assets/server.key.enc -out assets/server.key -base64 -K ${certSecrets.DECRYPTION_KEY} -iv ${certSecrets.DECRYPTION_IV}`
    ));
    if(stderr) {
        fatal('authorize()', stderr);
    }

    ({stderr} = await exec(
        `${AUTH_JWT_GRANT_COMMAND} -i ${HUB_CONSUMER_KEY} -f assets/server.key -o $HUB_USERNAME -d -a $HUB_ALIAS`
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
