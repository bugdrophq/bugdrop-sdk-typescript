import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { runScenarios } from '../../scripts/staging/scenarios.mjs';
import { readFixtures } from '../../scripts/integration/packed-consumer.mjs';
import { target } from './support.mjs';

const fixtures = await readFixtures(resolve(import.meta.dirname, '../..'));

function testDouble({
  failureScenario,
  denialStatus = 403,
  denialCode = 'request_failed',
  failBaseline = false,
} = {}) {
  let state;
  const closed = [];
  const observed = [];
  const exchanges = [];
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
      exchanges.push({ scenario: state.name, origin: input.origin });
      if (failBaseline && state.name === 'origin' && input.origin === target.origin) {
        throw Object.assign(new Error('unavailable'), { code: 'request_failed', status: 503 });
      }
      if (state.blocked || input.origin !== target.origin) {
        throw Object.assign(new Error('rejected'), {
          code: state.name === failureScenario ? denialCode : 'request_failed',
          status: state.name === failureScenario ? (denialStatus ?? undefined) : 403,
        });
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
      const successes = ['origin', 'revoked', 'stale'].includes(expected.scenario)
        ? [true, false]
        : [true];
      assert.deepEqual(expected.exchangeSuccesses, successes);
      assert.equal(expected.exchangeCount, successes.length);
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
    exchanges,
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

test('configured-origin failure aborts before alias testing or attestation', async () => {
  const fixture = testDouble({ failBaseline: true });
  await assert.rejects(runScenarios({ ...fixture, fixtures, target }));
  assert.deepEqual(
    fixture.exchanges.filter(({ scenario }) => scenario === 'origin'),
    [{ scenario: 'origin', origin: target.origin }]
  );
  assert.deepEqual(fixture.observed, ['delivered']);
  assert.deepEqual(fixture.closed, ['delivered', 'origin']);
});

test('only an explicit request_failed HTTP 403 proves issuance denial', async () => {
  for (const failureScenario of ['origin', 'revoked', 'stale']) {
    for (const denialStatus of [401, 429, 500, 503, null]) {
      const fixture = testDouble({ failureScenario, denialStatus });
      await assert.rejects(runScenarios({ ...fixture, fixtures, target }));
      assert.equal(fixture.observed.includes(failureScenario), false);
      assert.equal(fixture.closed.at(-1), failureScenario);
    }
    const fixture = testDouble({ failureScenario, denialCode: 'invalid_response' });
    await assert.rejects(runScenarios({ ...fixture, fixtures, target }));
    assert.equal(fixture.observed.includes(failureScenario), false);
    assert.equal(fixture.closed.at(-1), failureScenario);
  }
});
