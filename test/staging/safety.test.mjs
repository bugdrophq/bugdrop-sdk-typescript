import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertSafetyRunner, runSafety } from '../../scripts/staging/safety.mjs';
import { safetyProvider } from '../../scripts/staging/safety-provider.mjs';
import { context, contract, scenarios, runId, completedResults } from './safety-support.mjs';

test('runner identity and installed SDK version fail closed before private actions', async () => {
  for (const packedSdkSafetyContract of [
    undefined,
    { ...contract, version: 1 },
    { ...contract, sdkVersion: '0.1.1' },
  ]) {
    assert.throws(() => assertSafetyRunner({ packedSdkSafetyContract, runRemoteSafety() {} }));
  }
  assert.throws(() => assertSafetyRunner({ packedSdkSafetyContract: contract }));
  const input = context();
  input.consumer.versions.server = '0.1.1';
  let called = false;
  await assert.rejects(
    runSafety({
      ...input,
      runner: {
        packedSdkSafetyContract: contract,
        runRemoteSafety() {
          called = true;
        },
      },
    })
  );
  assert.equal(called, false);
});

test('partial, unavailable lifecycle and retention attestations never satisfy completion', async () => {
  const input = context();
  for (const result of [
    undefined,
    [],
    scenarios.slice(0, -1).map((scenario) => ({ scenario, passed: true })),
  ]) {
    await assert.rejects(
      runSafety({
        ...input,
        runner: {
          packedSdkSafetyContract: contract,
          runRemoteSafety: async () => result,
        },
      })
    );
  }
  for (const failure of [
    'staging_uninstall_completion_unavailable',
    'retention_observation_unavailable',
  ]) {
    await assert.rejects(
      runSafety({
        ...input,
        runner: {
          packedSdkSafetyContract: contract,
          runRemoteSafety: async () => {
            throw new Error(failure);
          },
        },
      }),
      new RegExp(failure)
    );
  }
  // Synthetic control: tests result validation only, never remote proof.
  await runSafety({
    ...input,
    runner: {
      packedSdkSafetyContract: contract,
      async runRemoteSafety(provider, target) {
        const observed = await provider.inspectTarget();
        assert.equal(observed.runId, runId);
        assert.equal(observed.sdkVersion, target.sdkVersion);
        return completedResults();
      },
    },
  });
});

test('missing private provider methods and wrong target close and fail before SDK construction', async () => {
  assert.throws(() => safetyProvider({ ...context(), provider: {} }));
  for (const mutation of [
    (service) => {
      delete service.readRetentionFixtures;
    },
    (service) => {
      service.endpoint = 'https://wrong.example/v1/submission-capabilities';
    },
    (service) => {
      service.origin = 'https://wrong.example';
    },
  ]) {
    const input = context(
      class {
        constructor() {
          assert.fail('SDK must not start');
        }
      }
    );
    mutation(input.service);
    await assert.rejects(
      safetyProvider(input).startScenario({ scenario: 'retention-deletion', runId })
    );
    assert.equal(input.service.closed, 1);
  }
});

test('bridge retains private method receivers and exact submission bytes', async () => {
  const input = context();
  const bridge = await safetyProvider(input).startScenario({
    scenario: 'duplicate-concurrent',
    runId,
  });
  const binding = { submissionId: 'test-only-id', payloadDigest: 'test-only-digest' };
  const capability = { token: 'test-only-token' };
  const reportBody = '{ "message": "canary" }';
  await bridge.submit({ capability, binding, reportBody, origin: input.target.origin });
  assert.deepEqual(input.service.input, { capability, binding, requestBody: reportBody });
  assert.ok((await bridge.secretMarkers()).includes('provider-secret-canary'));
  await bridge.close();
  assert.deepEqual(await bridge.evidence(), { closed: 1 });
});
