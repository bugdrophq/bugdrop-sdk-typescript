import assert from 'node:assert/strict';

// This is a sanitized gate result, not raw provider evidence or a public wire contract.
export function completionReceipt({ target, runId, sdkVersion }) {
  assert.match(runId, /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
  assert.match(target.serviceRevision, /^[a-f0-9]{40}$/);
  assert.match(target.deploymentDigest, /^[a-f0-9]{64}$/);
  assert.equal(sdkVersion, '0.1.0');
  return {
    status: 'staging_passed',
    receiptVersion: 1,
    proofKind: 'remote',
    runId,
    serviceRevision: target.serviceRevision,
    deploymentDigest: target.deploymentDigest,
    sdkVersion,
    sdkScenarios: 7,
    safetyScenarios: 13,
  };
}

export function readCompletionReceipt(value, target) {
  try {
    const expected = completionReceipt({
      target,
      runId: value.runId,
      sdkVersion: value.sdkVersion,
    });
    assert.deepEqual(value, expected);
    return expected;
  } catch {
    return undefined;
  }
}
