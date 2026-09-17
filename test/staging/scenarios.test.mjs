import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { runScenarios } from '../../scripts/staging/scenarios.mjs';
import { readFixtures } from '../../scripts/integration/packed-consumer.mjs';
import { target } from './support.mjs';

const fixtures = await readFixtures(resolve(import.meta.dirname, '../..'));

function testDouble() {
  let state;
  const closed = [];
  const observed = [];
  const provider = {
    async startScenario({ name, submissionId }) {
      state = { name, submissionId, exchanges: 0, outcomes: [], blocked: false };
      return {
        endpoint: target.endpoint,
        origin: target.origin,
        // Intentionally invalid for the real SDK: this tests orchestration, never remote proof.
        resolveApiKey: async () => 'bd_api_v1.test.test',
        submit: async () => {
          const outcome = ['delivered', 'indeterminate'].includes(name) ? name : 'rejected';
          state.outcomes.push(outcome);
          return { schemaVersion: 1, outcome };
        },
        revoke() {
          state.blocked = true;
        },
        expireAuthorizationState() {
          state.blocked = true;
        },
        setDeliveryIndeterminate() {},
        evidence: async () => ({ exchanges: state.exchanges, outcomes: state.outcomes }),
        close: async () => {
          closed.push(name);
        },
      };
    },
  };
  class BugDrop {
    constructor(options) {
      assert.deepEqual(Object.keys(options).sort(), ['apiKey', 'endpoint']);
    }
    async createSubmissionToken(input) {
      if ('userId' in input) throw new TypeError('unsupported');
      if (fixtures.origin.invalid.includes(input.origin)) throw new TypeError('origin');
      state.exchanges++;
      if (state.blocked || input.origin !== target.origin) {
        throw Object.assign(new Error('rejected'), { code: 'request_failed' });
      }
      return {
        schemaVersion: 1,
        token: 'test-only-capability',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      };
    }
  }
  const oracle = {
    async assertEvidence({ evidence, expected }) {
      assert.equal(evidence.exchanges, expected.exchangeCount);
      assert.deepEqual(evidence.outcomes, expected.submissionOutcomes);
      assert.equal(expected.serviceRevision, target.serviceRevision);
      assert.equal(expected.deploymentDigest, target.deploymentDigest);
      assert.equal(expected.repositoryId, target.repositoryId);
      assert.equal(expected.runId, '12345678-1234-4234-8234-123456789abc');
      observed.push(expected.scenario);
      return true;
    },
  };
  return {
    provider,
    oracle,
    runId: '12345678-1234-4234-8234-123456789abc',
    consumer: { BugDrop, versions: { server: '0.1.0' } },
    closed,
    observed,
  };
}

test('self-test exercises seven scenarios, observed counts and cleanup; not remote proof', async () => {
  const fixture = testDouble();
  await runScenarios({ ...fixture, fixtures, target });
  assert.deepEqual(fixture.observed, [
    'delivered',
    'origin',
    'tampered',
    'binding',
    'revoked',
    'stale',
    'indeterminate',
  ]);
  assert.deepEqual(fixture.closed, fixture.observed);
});

test('false or missing safety attestation fails and closes the scenario', async () => {
  for (const result of [false, undefined]) {
    const fixture = testDouble();
    fixture.oracle.assertEvidence = async () => result;
    await assert.rejects(runScenarios({ ...fixture, fixtures, target }));
    assert.deepEqual(fixture.closed, ['delivered']);
  }
});
