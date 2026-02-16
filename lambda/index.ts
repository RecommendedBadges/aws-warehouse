import { DurableContext, withDurableExecution } from '@aws/durable-execution-sdk-js';
import { orchestrate } from '../services';

export const handler = withDurableExecution(async (event, context: DurableContext) => {
	const pullRequestNumber = event.pullRequestNumber;
	const jobNumber = event.jobNumber; // still needed?
	const sortedPackagesToUpdate = event.sortedPackagesToUpdate;

	try {
		await orchestrate({ pullRequestNumber, sortedPackagesToUpdate }, context);
		return { statusCode: 200, body: 'ok' };
	} catch (err) {
		console.error('Lambda handler error', err);
		return { statusCode: 500, body: String(err) };
	}
});