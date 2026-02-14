import { orchestrate, setupScheduledJob } from './services';
import { post } from './util';

async function start() {
  workQueue.process('kickoff', async (job) => {
    process.stdout.write('Kickoff job received\n');
    await orchestrate(job.data);
    await post('warehouse', '', {formationType: 'worker'});
  });

  workQueue.process('scheduled', async () => {
    await setupScheduledJob();
    await post('warehouse', '', {formationType: 'clock'});
  });
}