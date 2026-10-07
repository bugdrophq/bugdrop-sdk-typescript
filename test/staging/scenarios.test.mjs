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
  faultScenario = 'delivered',
  duplicateToken = false,
  duplicateAttempt = false,
  replaySuccess = false,
  replacementReplaySuccess = false,
  leakReplacement = false,
} = {}) {
  let state;
  const closed = [];
  const observed = [];
  const exchanges = [];
  const provider = {
    async startScenario({ name, submissionId }) {
      state = {
        name,
        submissionId,
        exchanges: 0,
        outcomes: [],
        blocked: false,
        consumed: new Set(),
        attempts: 0,
      };
      return {
        endpoint: target.endpoint,
        origin: target.origin,
        // Intentionally invalid for the real SDK: this tests orchestration, never remote proof.
        resolveApiKey: async () => 'bd_api_v1.test.test',
        submit: async ({ capability }) => {
          const eligible = ['delivered', 'indeterminate'].includes(name);
          const used = state.consumed.has(capability.token);
          const poisoned = name === faultScenario;
          const outcome = eligible && (!used || (poisoned && replaySuccess)) ? name : 'rejected';
          if (eligible && !used) {
            if (!(poisoned && replacementReplaySuccess && state.attempts > 0))
              state.consumed.add(capability.token);
            if (!state.attempts || (poisoned && duplicateAttempt)) state.attempts++;
          }
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
        evidence: async () => ({
          exchanges: state.observations,
          outcomes: state.outcomes,
          attempts: state.attempts,
          ...(leakReplacement && name === faultScenario
            ? { leaked: 'test-only-capability-2' }
            : {}),
        }),
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
      if ('userId' in input)
        throw new TypeError('createSubmissionToken options contain unsupported fields');
      if (fixtures.origin.invalid.includes(input.origin))
        throw new TypeError('origin must be canonical');
      state.exchanges++;
      exchanges.push({ scenario: state.name, origin: input.origin });
      state.observations ??= [];
      state.observations.push({
        sequence: state.exchanges,
        sdkVersion: '0.1.0',
        status: state.blocked || input.origin !== target.origin ? 403 : 200,
      });
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
        token: `test-only-capability-${duplicateToken && state.name === faultScenario ? 1 : state.exchanges}`,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      };
    }
  }
  const oracle = {
    async assertEvidence({ evidence, expected }) {
      assert.equal(evidence.exchanges.length, expected.exchangeCount);
      const successes = ['origin', 'revoked', 'stale'].includes(expected.scenario)
        ? [true, false]
        : ['delivered', 'indeterminate'].includes(expected.scenario)
          ? [true, true, true]
          : [true];
      assert.deepEqual(expected.exchangeSuccesses, successes);
      assert.equal(expected.exchangeCount, successes.length);
      assert.deepEqual(evidence.outcomes, expected.submissionOutcomes);
      if (['delivered', 'indeterminate'].includes(expected.scenario))
        assert.deepEqual(expected.submissionOutcomes, [
          expected.scenario,
          'rejected',
          expected.scenario,
          expected.scenario,
          'rejected',
          'rejected',
        ]);
      assert.equal(evidence.attempts, expected.attempts);
      assert.equal(expected.serviceRevision, target.serviceRevision);
      assert.equal(expected.deploymentDigest, target.deploymentDigest);
      assert.equal(expected.repositoryId, target.repositoryId);
      assert.equal(expected.runId, '12345678-1234-4234-8234-123456789abc');
      observed.push(expected.scenario);
      return true;
    },
  };
  const consumer = { BugDrop, versions: { server: '0.1.0' } };
  const runId = '12345678-1234-4234-8234-123456789abc';
  return {
    provider,
    oracle,
    runId,
    consumer,
    remoteCapability: {
      runId,
      async openScenario({ consumer: packed, service, fixtureApiKey }) {
        assert.equal(packed, consumer);
        assert.equal(service.endpoint, target.endpoint);
        assert.equal(service.origin, target.origin);
        const apiKey = await service.resolveApiKey();
        assert.notEqual(apiKey, fixtureApiKey);
        return { apiKey, client: new packed.BugDrop({ apiKey, endpoint: target.endpoint }) };
      },
    },
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

test('replay conformance rejects repeated mint tokens, second attempts, replay successes and replacement leaks', async () => {
  for (const faultScenario of ['delivered', 'indeterminate']) {
    for (const fault of [
      'duplicateToken',
      'duplicateAttempt',
      'replaySuccess',
      'replacementReplaySuccess',
      'leakReplacement',
    ]) {
      const fixture = testDouble({ [fault]: true, faultScenario });
      await assert.rejects(runScenarios({ ...fixture, fixtures, target }));
      assert.equal(fixture.observed.includes(faultScenario), false);
      assert.equal(fixture.closed.at(-1), faultScenario);
    }
  }
});
