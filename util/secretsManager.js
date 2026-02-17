import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const secretsClient = new SecretsManagerClient({ region: process.env.AWS_REGION });
const secrets = {};

export async function getSecret(secretId) {
    if(secrets[secretId]) {
        return secrets[secretId];
    }
    const secret = JSON.parse((await secretsClient.send(new GetSecretValueCommand({ SecretId: secretId })))).SecretString;
    secrets[secretId] = secret;
    return secret;
}