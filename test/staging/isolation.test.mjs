import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runIsolated } from '../../scripts/staging/runner.mjs';
import { configured } from './support.mjs';

test('CLI missing staging exits nonzero and does not disclose environment secrets', () => {
  const result = spawnSync(process.execPath, ['scripts/staging.mjs'], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, BUGDROP_STAGING_API_KEY: 'secret-canary' },
  });
  assert.equal(result.status, 2);
  assert.equal(JSON.parse(result.stdout).status, 'staging_not_configured');
  assert.ok(!`${result.stdout}${result.stderr}`.includes('secret-canary'));
});

test('provider output is suppressed and identity failure prevents scenario mutation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'staging-guard-'));
  try {
    const sentinel = join(directory, 'mutated');
    const source = `import { writeFile } from 'node:fs/promises';
      console.log(process.env.BUGDROP_STAGING_API_KEY);
      console.error(process.env.BUGDROP_STAGING_API_KEY);
      export async function inspectTarget() { return {environment:'production'}; }
      export async function startScenario() { await writeFile(${JSON.stringify(sentinel)}, 'mutated'); }
      export async function assertEvidence() { throw new Error(process.env.BUGDROP_STAGING_API_KEY); }`;
    const path = join(directory, 'provider.mjs');
    await writeFile(path, source);
    const digest = createHash('sha256').update(source).digest('hex');
    const env = {
      ...process.env,
      ...configured,
      BUGDROP_STAGING_API_KEY: 'secret-canary',
      BUGDROP_STAGING_ADAPTER: path,
      BUGDROP_STAGING_ORACLE: path,
      BUGDROP_STAGING_ADAPTER_SHA256: digest,
      BUGDROP_STAGING_ORACLE_SHA256: digest,
    };
    const result = spawnSync(process.execPath, ['scripts/staging.mjs'], {
      env,
      encoding: 'utf8',
      timeout: 10_000,
    });
    assert.equal(result.status, 1);
    assert.deepEqual(JSON.parse(result.stdout), { status: 'staging_failed' });
    assert.ok(!`${result.stdout}${result.stderr}`.includes('secret-canary'));
    await assert.rejects(access(sentinel));
    assert.deepEqual(
      await runIsolated({ ...env, BUGDROP_STAGING_ADAPTER_SHA256: '0'.repeat(64) }),
      { status: 'staging_failed' }
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
