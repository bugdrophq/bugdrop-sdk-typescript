import assert from 'node:assert/strict';
import { safetyProvider } from './safety-provider.mjs';
import { assertOriginChecks } from './origin-proof.mjs';

const requiredScenarios = [
  'duplicate-concurrent',
  'timeout-after-dispatch',
  'restart-after-dispatch',
  'stale-authorization',
  'substitute-tenantId',
  'substitute-applicationId',
  'substitute-destinationId',
  'origin-aliases',
  'revoke-credential',
  'revoke-application',
  'revoke-tenant',
  'retention-deletion',
  'uninstall',
];

export function assertSafetyRunner(runner, sdkVersion = '0.1.0') {
  assert.equal(sdkVersion, '0.1.0');
  assert.deepEqual(runner.packedSdkSafetyContract, { version: 2, sdkVersion });
  assert.equal(typeof runner.runRemoteSafety, 'function');
}

export async function runSafety({ runner, ...context }) {
  assertSafetyRunner(runner, context.consumer.versions.server);
  const results = await runner.runRemoteSafety(safetyProvider(context), {
    ...context.target,
    // This gate's target must already have external approval; no approval is created here.
    approved: true,
    sdkVersion: context.consumer.versions.server,
  });
  // An empty/partial return or unavailable lifecycle/retention attestation cannot be success.
  assert.ok(Array.isArray(results));
  assert.equal(results.length, requiredScenarios.length);
  for (const [index, scenario] of requiredScenarios.entries()) {
    if (scenario === 'origin-aliases') {
      const { originChecks, ...result } = results[index];
      assert.deepEqual(result, { scenario, passed: true });
      assert.ok(Array.isArray(originChecks));
      assertOriginChecks(originChecks, context);
    } else {
      assert.deepEqual(results[index], { scenario, passed: true });
    }
  }
}
