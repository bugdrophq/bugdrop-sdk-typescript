import { runIsolated } from './staging/runner.mjs';

const receipt = await runIsolated(process.env);
process.stdout.write(`${JSON.stringify(receipt)}\n`);
process.exitCode =
  receipt.status === 'staging_passed' ? 0 : receipt.status === 'staging_not_configured' ? 2 : 1;
