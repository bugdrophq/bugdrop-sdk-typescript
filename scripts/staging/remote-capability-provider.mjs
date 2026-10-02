import assert from 'node:assert/strict';

const runIdPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

// Test-only issuer handoff. The external provider still owns remote inspection,
// scenario credentials, submission, controls, and independent evidence.
export async function preflightRemoteCapabilityProvider({ target, inspectTarget }) {
  assert.equal(typeof inspectTarget, 'function');
  assert.ok(target && typeof target === 'object' && !Array.isArray(target));
  const approvedTarget = Object.freeze({ ...target });
  const inspected = await inspectTarget();
  assert.ok(inspected && typeof inspected === 'object' && !Array.isArray(inspected));
  const { runId, ...actualTarget } = inspected;
  assert.match(runId, runIdPattern);
  assert.deepEqual(actualTarget, approvedTarget, 'Remote capability target differs from approval');

  return Object.freeze({
    runId,
    async openScenario({ consumer, service, fixtureApiKey }) {
      assert.equal(
        service.endpoint,
        approvedTarget.endpoint,
        'Scenario endpoint differs from approval'
      );
      assert.equal(service.origin, approvedTarget.origin, 'Scenario origin differs from approval');
      assert.equal(typeof service.resolveApiKey, 'function');
      const apiKey = await service.resolveApiKey();
      assert.equal(typeof apiKey, 'string');
      assert.notEqual(apiKey, fixtureApiKey, 'Fixture credential cannot qualify staging');
      // The packed public server export owns V1 bytes and never receives a provider fetch double.
      const client = new consumer.BugDrop({ apiKey, endpoint: approvedTarget.endpoint });
      return Object.freeze({ apiKey, client });
    },
  });
}
