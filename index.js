import { DurableContext, withDurableExecution } from '@aws/durable-execution-sdk-js';

import { orchestrate } from './services'; 

export const handler = withDurableExecution(async (event, context) => {
    const pullRequestNumber = event.pullRequestNumber;
    const jobNumber = event.jobNumber; // still needed?
    const sortedPackagesToUpdate = event.sortedPackagesToUpdate;

    await (orchestrate({pullRequestNumber, sortedPackagesToUpdate}));
});