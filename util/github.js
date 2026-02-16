import * as callout from './callout.js';
import { BASE_BRANCH, PACKAGES_LABEL } from '../config';

async function getOpenPullRequestDetails(parameters) {
    let pullRequests = await callout.get({
        site: 'github',
        endpoint: '/pulls'
    });

    for(let pullRequest of pullRequests) {
        if(
            (pullRequest.base.ref === BASE_BRANCH) 
            && ((parameters.pullRequestNumber && (pullRequest.number == parameters.pullRequestNumber)) || !parameters.pullRequestNumber)
        ) {
            return pullRequest;
        }
    }
}

async function deletePackageLabelFromIssue(issueNumber) {
    await callout.doDelete('github', `/issues/${issueNumber}/labels/${PACKAGES_LABEL}`);
}

async function mergeOpenPullRequest(pullRequestNumber) {
    await callout.put('github', `/pulls/${pullRequestNumber}/merge`, {merge_method: 'merge'});
}

export {
    deletePackageLabelFromIssue,
    getOpenPullRequestDetails,
    mergeOpenPullRequest
}