import { execFileSync } from 'node:child_process';
import { resolve, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { WIDGET_HELPER_COMMIT } from './config.mjs';

export async function loadHelpers(directory) {
  if (!directory || !isAbsolute(directory)) throw new Error('Pinned helpers required');
  const git = (args) =>
    execFileSync('git', ['-C', directory, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  if (
    git(['rev-parse', 'HEAD']) !== WIDGET_HELPER_COMMIT ||
    git(['status', '--porcelain', '--untracked-files=all'])
  )
    throw new Error('Helpers must match the clean pinned checkout');
  const load = (name) => import(pathToFileURL(resolve(directory, 'scripts', name)).href);
  return {
    ...(await load('github-issue-canary.mjs')),
    ...(await load('github-heartbeat-incident.mjs')),
    ...(await load('production-heartbeat-outcome.mjs')),
  };
}
