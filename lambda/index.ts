import { orchestrate, setupScheduledJob } from '../services/workerService';

export const handler = async (event: any = {}) => {
  // simple action-based handler so the same Lambda can run different jobs
  const action = event.action || event.type || 'orchestrate';

  try {
    if (action === 'scheduled') {
      await setupScheduledJob();
      return { statusCode: 200, body: 'scheduled' };
    }

    // default: run the orchestrator with provided payload
    await orchestrate(event.payload || event);
    return { statusCode: 200, body: 'ok' };
  } catch (err) {
    console.error('Lambda handler error', err);
    return { statusCode: 500, body: String(err) };
  }
};