import { fork } from 'node:child_process';
import { resolve } from 'node:path';
import { readConfiguration } from './config.mjs';
import { readCompletionReceipt } from './receipt.mjs';

export async function runIsolated(env, timeout = 600_000) {
  const config = readConfiguration(env);
  if (config.status !== 'configured') return config;
  return new Promise((resolveResult) => {
    const child = fork(resolve(import.meta.dirname, 'worker.mjs'), [], {
      env,
      execArgv: [],
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    let receipt;
    const timer = setTimeout(() => child.kill('SIGKILL'), timeout);
    child.on('message', (value) => {
      // Never forward arbitrary module output or error details, even when the child fails.
      receipt = readCompletionReceipt(value, config.target);
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolveResult({ status: 'staging_failed' });
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolveResult(code === 0 && receipt ? receipt : { status: 'staging_failed' });
    });
  });
}
