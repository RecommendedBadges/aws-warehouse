import { DurableContext, withDurableExecution } from '@aws/durable-execution-sdk-js';
import { orchestrate } from '../services';

export const handler = withDurableExecution(async (event, context: DurableContext) => {
	const pullRequestNumber = event.pullRequestNumber;
	const sortedPackagesToUpdate = event.sortedPackagesToUpdate;

	try {
		process.stdout.write('Starting durable function execution\n'); // remove later
		orchestrate({ pullRequestNumber, sortedPackagesToUpdate }, context)
		.then(() => process.stdout.write('Durable function execution completed\n')) // remove later
		.catch(err => process.stdout.write(`Durable function execution error: ${err}\n`)); // remove later
		return { statusCode: 200, body: 'ok' };
	} catch (err) {
		console.error('Lambda handler error', err);
		return { statusCode: 500, body: String(err) };
	}
});