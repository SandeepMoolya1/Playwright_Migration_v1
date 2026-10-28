/**
 * Runs once, in the main process, before any worker starts.
 *
 * Its job is to fix the identity of the run. Worker processes are spawned
 * after this, so the environment variable set here is inherited by all of
 * them — which is what makes the run tag consistent across parallel workers.
 */
import { getEnvironment } from './config/environments.js';
import { initRunId } from './src/data/run.js';
import { getDataset } from './src/data/dataset.js';

export default async function globalSetup(): Promise<void> {
  const env = getEnvironment();
  const id = initRunId();

  // Validate the dataset once, here, rather than letting a typo surface as a
  // confusing assertion failure inside a test twenty steps in.
  getDataset(env.name);

  const lines = [
    '',
    `  environment  ${env.label} (${env.name})`,
    `  baseURL      ${env.baseURL}`,
    env.apiURL ? `  apiURL       ${env.apiURL}` : '',
    `  writable     ${env.readOnly ? 'NO — readOnly, seeding is blocked' : 'yes'}`,
    `  run id       ${id}`,
    '',
  ].filter(Boolean);

  process.stdout.write(`${lines.join('\n')}\n`);
}
