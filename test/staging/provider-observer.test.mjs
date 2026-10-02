import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { installConsumer, readFixtures } from '../../scripts/integration/packed-consumer.mjs';
import { runScenarios } from '../../scripts/staging/scenarios.mjs';
import { safetyProvider } from '../../scripts/staging/safety-provider.mjs';
import { credentialCanaries } from '../../scripts/staging/canaries.mjs';
import { preflightRemoteCapabilityProvider } from '../../scripts/staging/remote-capability-provider.mjs';
import { runId } from './safety-support.mjs';
import { target as baseTarget } from './support.mjs';
import { providerObserverFixture } from './provider-observer-support.mjs';

const repository = resolve(import.meta.dirname, '../..');
let consumer, fixtures;
before(async () => {
  consumer = await installConsumer(repository);
  fixtures = await readFixtures(repository);
});
after(async () => consumer?.close());

async function setup() {
  const binding = fixtures['submission-binding'];
  assert.equal(
    binding.bound.payloadDigest,
    createHash('sha256').update(binding.requestBody).digest('base64url')
  );
  const local = await providerObserverFixture(baseTarget, binding.bound.payloadDigest);
  return { local, target: { ...baseTarget, endpoint: local.endpoint } };
}

test('packed SDK and signed observer reconcile all seven provider scenarios exactly', async () => {
  const { local, target } = await setup();
  const attested = [];
  try {
    const remoteCapability = await preflightRemoteCapabilityProvider({
      target,
      inspectTarget: async () => ({ ...target, runId }),
    });
    await runScenarios({
      consumer,
      fixtures,
      provider: local.provider,
      target,
      runId,
      remoteCapability,
      oracle: {
        assertEvidence({ evidence, expected }) {
          assert.equal(expected.sdkVersion, consumer.versions.server);
          assert.equal(evidence.exchanges.length, expected.exchangeCount);
          assert.deepEqual(
            evidence.exchanges.map(({ status }) => status >= 200 && status < 300),
            expected.exchangeSuccesses
          );
          assert.deepEqual(evidence.outcomes, expected.submissionOutcomes);
          attested.push(expected.scenario);
          return true;
        },
      },
    });
    assert.deepEqual(attested, [
      'delivered',
      'origin',
      'tampered',
      'binding',
      'revoked',
      'stale',
      'indeterminate',
    ]);
    for (const record of local.records) {
      assert.equal(record.closed, true);
      assert.equal(record.evidenceReads, 1);
      assert.equal(record.observer.state.exchanges.length, record.networkRequests);
      assert.equal(record.observer.state.calls.at(-1).path, '/observation/close');
    }
  } finally {
    await local.close();
  }
});

test('safety bridge uses the same signed lease for counts and exchange evidence', async () => {
  const { local, target } = await setup();
  let bridge;
  try {
    bridge = await safetyProvider({
      consumer,
      fixtures,
      provider: local.provider,
      target,
      runId,
    }).startScenario({ scenario: 'origin-aliases', runId });
    const binding = fixtures['submission-binding'].bound;
    assert.equal((await bridge.mint({ binding, origin: target.origin })).schemaVersion, 1);
    assert.equal((await bridge.readExchangeCount()).count, 1);
    const rejected = await bridge.rejectInvalidOrigin({ binding, origin: `${target.origin}/` });
    assert.equal(rejected.networkAttempts, 0);
    assert.equal(rejected.before.count, 1);
    assert.equal(rejected.after.count, 1);
    assert.equal(await bridge.mint({ binding, origin: 'https://wrong-origin.invalid' }), null);
    assert.equal((await bridge.readExchangeCount()).count, 2);
    const evidence = await bridge.evidence();
    assert.deepEqual(
      evidence.exchanges.map(({ status }) => status),
      [200, 403]
    );
    await bridge.close();
    assert.equal(local.records[0].closed, true);
    assert.equal(local.records[0].networkRequests, 2);
  } finally {
    await local.close();
  }
});

test('signed wrong scope, nonce, lease and replay poison reconciliation and cleanup', async () => {
  for (const fault of ['scope', 'nonce', 'lease', 'replay']) {
    const { local, target } = await setup();
    try {
      const bridge = await safetyProvider({
        consumer,
        fixtures,
        provider: local.provider,
        target,
        runId,
      }).startScenario({ scenario: 'origin-aliases', runId });
      const binding = fixtures['submission-binding'].bound;
      await bridge.mint({ binding, origin: target.origin });
      const record = local.records[0];
      if (fault === 'replay') {
        let previous;
        record.observer.state.mode = ({ path, body, respond }) => {
          previous = respond(path, body);
          return previous.clone();
        };
        assert.equal((await bridge.readExchangeCount()).count, 1);
        record.observer.state.mode = () => previous.clone();
      } else {
        record.observer.state.mode = ({ path, body, respond }) => {
          if (fault === 'scope') body.snapshot.applicationId = 'wrong-app';
          if (fault === 'nonce') body.requestNonce = randomUUID();
          if (fault === 'lease') body.leaseId = randomUUID();
          return respond(path, body);
        };
      }
      await assert.rejects(bridge.readExchangeCount(), {
        message: 'staging_observation_incomplete',
      });
      record.observer.state.mode = undefined;
      await assert.rejects(bridge.evidence());
      await assert.rejects(bridge.close());
      assert.equal(record.closed, true);
      assert.equal(record.networkRequests, 1);
      assert.equal(record.observer.state.calls.at(-1).path, '/observation/close');
    } finally {
      await local.close();
    }
  }
});

test('missing or extra admitted exchanges cannot match the packed SDK transcript', async () => {
  for (const fault of ['missing', 'extra']) {
    const { local, target } = await setup();
    try {
      const bridge = await safetyProvider({
        consumer,
        fixtures,
        provider: local.provider,
        target,
        runId,
      }).startScenario({ scenario: 'origin-aliases', runId });
      await bridge.mint({
        binding: fixtures['submission-binding'].bound,
        origin: target.origin,
      });
      const record = local.records[0];
      if (fault === 'missing') record.observer.state.exchanges.length = 0;
      else
        record.observer.state.exchanges.push({
          sequence: 2,
          sdkVersion: consumer.versions.server,
          status: 200,
        });
      await assert.rejects(bridge.evidence());
      await assert.rejects(bridge.close());
      assert.equal(record.closed, true);
    } finally {
      await local.close();
    }
  }
});

test('pre-admission HTTP 503 cannot be reconciled with a zero-count observer', async () => {
  const { local, target } = await setup();
  try {
    const bridge = await safetyProvider({
      consumer,
      fixtures,
      provider: local.provider,
      target,
      runId,
    }).startScenario({ scenario: 'origin-aliases', runId });
    const record = local.records[0];
    record.preAdmission503 = true;
    await assert.rejects(
      bridge.mint({ binding: fixtures['submission-binding'].bound, origin: target.origin }),
      { code: 'request_failed', status: 503 }
    );
    assert.equal(record.networkRequests, 1);
    assert.equal(record.observer.state.exchanges.length, 0);
    await assert.rejects(bridge.readExchangeCount());
    await assert.rejects(bridge.evidence());
    await assert.rejects(bridge.close());
    assert.equal(record.closed, true);
  } finally {
    await local.close();
  }
});

test('malformed raw issuance requests never enter the signed observer lease', async () => {
  const { local, target } = await setup();
  const service = await local.provider.startSafetyScenario({ scenario: 'origin-aliases', runId });
  try {
    const key = await service.resolveApiKey();
    const authorization = credentialCanaries(key).at(-1);
    const validBody = {
      schemaVersion: 1,
      ...fixtures['submission-binding'].bound,
      origin: target.origin,
    };
    const headers = {
      Authorization: authorization,
      'Content-Type': 'application/json',
      Accept: 'application/vnd.bugdrop.submission-capability.v1+json',
      'X-BugDrop-Contract-Version': '1',
      'X-BugDrop-SDK-Version': consumer.versions.server,
    };
    for (const [changedHeaders, changedBody, expectedStatus] of [
      [{ Authorization: 'Bearer wrong-canary' }, {}, 401],
      [{}, { schemaVersion: 2 }, 400],
      [{}, { payloadDigest: undefined }, 400],
      [{ 'X-BugDrop-Contract-Version': '2' }, {}, 400],
    ]) {
      const response = await fetch(local.endpoint, {
        method: 'POST',
        headers: { ...headers, ...changedHeaders },
        body: JSON.stringify({ ...validBody, ...changedBody }),
      });
      assert.equal(response.status, expectedStatus);
      assert.equal((await service.readExchangeCount()).count, 0);
    }
    assert.deepEqual(
      (await service.evidence({ sdkAttemptTranscript: { scenario: 'origin-aliases' } })).exchanges,
      []
    );
    await service.close();
    assert.equal(local.records[0].networkRequests, 4);
    assert.equal(local.records[0].closed, true);
    assert.equal(local.records[0].observer.state.calls.at(-1).path, '/observation/close');
  } finally {
    await local.close();
  }
});
