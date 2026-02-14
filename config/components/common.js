const REQUEST_HEADERS = {
    github: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
        'X-GitHub-Api-Version': '2022-11-28'
    }
};

const API_BASES = {
    github: process.env.GITHUB_API_BASE
};

export {
    API_BASES,
    REQUEST_HEADERS 
};