import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const secretsClient = new SecretsManagerClient({ region: process.env.AWS_REGION });
const secrets = {};

export async function getSecret(secretId) {
    if(secrets[secretId]) {
        return secrets[secretId];
    }
    try {
        const secret = (await secretsClient.send(new GetSecretValueCommand({ SecretId: secretId }))).SecretString;
        process.stdout.write(`secret ${JSON.stringify(secret)}`);
        secrets[secretId] = secret;
        return secret;
    } catch(err) {
        process.stderr.write(`error retrieving secret ${secretId}: ${err}`);
        process.exit(1);
    }
}