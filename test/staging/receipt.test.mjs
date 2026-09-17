import { test } from 'node:test';
import assert from 'node:assert/strict';
import { completionReceipt, readCompletionReceipt } from '../../scripts/staging/receipt.mjs';
import { target } from './support.mjs';
import { runId } from './safety-support.mjs';

test('gate receipt preserves only validated run, deployment, version and suite provenance', () => {
  // Shape test only; this synthetic object does not establish a remote run.
  const receipt = completionReceipt({ target, runId, sdkVersion: '0.1.0' });
  assert.deepEqual(readCompletionReceipt(receipt, target), {
    status: 'staging_passed',
    receiptVersion: 1,
    proofKind: 'remote',
    runId,
    serviceRevision: target.serviceRevision,
    deploymentDigest: target.deploymentDigest,
    sdkVersion: '0.1.0',
    sdkScenarios: 7,
    safetyScenarios: 13,
  });
  assert.notEqual(readCompletionReceipt(receipt, target), receipt);
});

test('mismatched, partial or secret-bearing child receipts cannot become success', () => {
  const receipt = completionReceipt({ target, runId, sdkVersion: '0.1.0' });
  for (const value of [
    null,
    undefined,
    { status: 'staging_passed', serviceRevision: target.serviceRevision },
    ...Object.keys(receipt).map((key) => {
      const missing = { ...receipt };
      delete missing[key];
      return missing;
    }),
    { ...receipt, proofKind: 'local' },
    { ...receipt, runId: 'secret-canary' },
    { ...receipt, serviceRevision: 'c'.repeat(40) },
    { ...receipt, deploymentDigest: 'd'.repeat(64) },
    { ...receipt, sdkVersion: '0.2.0' },
    { ...receipt, safetyScenarios: 12 },
    { ...receipt, sdkScenarios: 6 },
    { ...receipt, token: 'secret-canary' },
  ]) {
    assert.equal(readCompletionReceipt(value, target), undefined);
  }
});
