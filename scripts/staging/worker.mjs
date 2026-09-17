import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readConfiguration } from './config.mjs';
import { installConsumer, readFixtures } from '../integration/packed-consumer.mjs';
import { runScenarios } from './scenarios.mjs';

async function pinnedModule(path, digest) {
  assert.equal(
    createHash('sha256')
      .update(await readFile(path))
      .digest('hex'),
    digest
  );
  return import(pathToFileURL(path).href);
}

let consumer;
try {
  const config = readConfiguration(process.env);
  assert.equal(config.status, 'configured');
  const provider = await pinnedModule(config.adapter, config.adapterDigest);
  const oracle = await pinnedModule(config.oracle, config.oracleDigest);
  // This provider operation must be read-only. No scenario controls run before exact target match.
  const { runId, ...inspected } = await provider.inspectTarget();
  assert.match(runId, /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
  assert.deepEqual(inspected, config.target);
  const repository = resolve(import.meta.dirname, '../..');
  consumer = await installConsumer(repository);
  const fixtures = await readFixtures(repository);
  await runScenarios({ consumer, fixtures, provider, oracle, target: config.target, runId });
  await consumer.close();
  consumer = undefined;
  process.send?.({ status: 'staging_passed', serviceRevision: config.target.serviceRevision });
} catch {
  process.exitCode = 1;
} finally {
  try {
    await consumer?.close();
  } catch {
    process.exitCode = 1;
  }
}
