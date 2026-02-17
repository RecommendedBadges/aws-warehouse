import { secretsManager } from '../../util';

async function getRequestHeaders() {
    return {
        github: {
            'Accept': 'application/vnd.github+json',
            'Authorization': `Bearer ${await secretsManager.getSecret('warehouse/gitConfigVars').GITHUB_TOKEN}`,
            'X-GitHub-Api-Version': '2022-11-28'
        }
    };
}
const API_BASES = {
    github: process.env.GITHUB_API_BASE
};

export {
    API_BASES,
    getRequestHeaders 
};