import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const SECRETS_CLIENT = new SecretsManagerClient({ region: process.env.AWS_REGION });
const REQUEST_HEADERS = {
    github: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${await getGithubToken()}`,
        'X-GitHub-Api-Version': '2022-11-28'
    }
};
const API_BASES = {
    github: process.env.GITHUB_API_BASE
};

async function getGithubToken() {
    return JSON.parse(await SECRETS_CLIENT.send(new GetSecretValueCommand({ SecretId: 'warehouse/gitConfigVars' }))).SecretsString.GITHUB_TOKEN;
}

export {
    API_BASES,
    REQUEST_HEADERS 
};