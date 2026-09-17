import assert from 'node:assert/strict';
import { credentialCanaries } from './canaries.mjs';
import { counterSnapshot } from './origin-proof.mjs';

const privateMethods = [
  'injectFault',
  'restart',
  'waitForDispatch',
  'expireAuthorization',
  'substituteTrustedContext',
  'revoke',
  'seedRetentionFixtures',
  'runNativeRetentionAlarm',
  'readRetentionFixtures',
  'uninstallApprovedInstallation',
  'waitForSignedUninstall',
  'readExchangeCount',
  'evidence',
  'close',
];

// Test-only bridge. Private provider actions never become public SDK methods.
export function safetyProvider({ consumer, provider, target, runId, fixtures }) {
  assert.equal(typeof provider.startSafetyScenario, 'function');
  return {
    // The worker independently observed this target for this run before packing the client.
    async inspectTarget() {
      return { ...target, runId, sdkVersion: consumer.versions.server };
    },
    async startScenario({ scenario, runId: requestedRunId }) {
      assert.equal(requestedRunId, runId);
      const service = await provider.startSafetyScenario({ scenario, runId });
      try {
        assert.equal(typeof service.close, 'function');
        assert.equal(service.endpoint, target.endpoint);
        assert.equal(service.origin, target.origin);
        for (const method of [...privateMethods, 'resolveApiKey', 'submit', 'secretMarkers']) {
          assert.equal(typeof service[method], 'function');
        }
        const apiKey = await service.resolveApiKey();
        assert.equal(typeof apiKey, 'string');
        assert.notEqual(apiKey, fixtures['api-key-credential'].apiKey);
        const client = new consumer.BugDrop({ apiKey, endpoint: target.endpoint });
        const markers = credentialCanaries(apiKey);
        return Object.freeze({
          ...Object.fromEntries(privateMethods.map((name) => [name, service[name].bind(service)])),
          async mint({ binding, origin }) {
            try {
              return await client.createSubmissionToken({ ...binding, origin });
            } catch (error) {
              if (error?.code === 'request_failed' && error.status === 403) return null;
              throw error;
            }
          },
          async rejectInvalidOrigin({ binding, origin }) {
            assert.equal(scenario, 'origin-aliases');
            const scope = { runId, target };
            const before = counterSnapshot(await service.readExchangeCount(), scope);
            await assert.rejects(
              client.createSubmissionToken({ ...binding, origin }),
              (error) => error instanceof TypeError && /^origin must /.test(error.message)
            );
            const after = counterSnapshot(await service.readExchangeCount(), scope);
            assert.equal(after.count, before.count);
            return { outcome: 'client_validation_rejected', networkAttempts: 0, before, after };
          },
          submit({ capability, binding, reportBody, origin }) {
            assert.equal(origin, target.origin);
            return service.submit({ capability, binding, requestBody: reportBody });
          },
          async secretMarkers() {
            const providerMarkers = await service.secretMarkers();
            assert.ok(Array.isArray(providerMarkers));
            assert.ok(
              providerMarkers.every((value) => typeof value === 'string' && value.length > 0)
            );
            return [...markers, ...providerMarkers];
          },
        });
      } catch (error) {
        await service?.close?.();
        throw error;
      }
    },
  };
}
