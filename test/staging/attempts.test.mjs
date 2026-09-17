import { test } from 'node:test';
import assert from 'node:assert/strict';
import { observeAttempts } from '../../scripts/staging/attempts.mjs';
import { runId } from './safety-support.mjs';
import { target } from './support.mjs';
import { safetyProvider } from '../../scripts/staging/safety-provider.mjs';
import { context, snapshot } from './safety-support.mjs';

const scope = {
  runId,
  scenario: 'origin-aliases',
  applicationId: target.applicationId,
  sdkVersion: '0.1.0',
};
const failure = (status) =>
  Object.assign(new Error('private-secret-canary'), { code: 'request_failed', status });

test('unknown, transport and HTTP failures permanently invalidate zero-count evidence', async () => {
  for (const error of [
    failure(503),
    failure(undefined),
    failure(401),
    new TypeError('origin must be canonical'),
    new Error('unknown'),
  ]) {
    let fail = true;
    const observed = observeAttempts(
      {
        async createSubmissionToken() {
          if (fail) throw error;
          return { token: 'private-token-canary' };
        },
      },
      scope
    );
    await assert.rejects(observed.invoke({}));
    fail = false;
    await observed.invoke({});
    assert.equal(observed.snapshot().complete, false);
    assert.throws(() => observed.assertCount(0));
    assert.throws(() => observed.assertCount(1));
    assert.throws(() => observed.assertExchanges([]));
    assert.doesNotMatch(JSON.stringify(observed.snapshot()), /private-|token|message/);
  }
});

test('transcript reconciles actual statuses and versions without inventing successful HTTP status', async () => {
  let result;
  const observed = observeAttempts(
    {
      async createSubmissionToken() {
        if (result instanceof Error) throw result;
        return result;
      },
    },
    scope
  );
  result = { token: 'private-token' };
  await observed.invoke({});
  const first = observed.snapshot();
  result = new TypeError('origin must be canonical');
  await assert.rejects(observed.invoke({}, 'origin'));
  result = failure(403);
  await assert.rejects(observed.invoke({}));
  const exchanges = [
    { sequence: 1, sdkVersion: '0.1.0', status: 201 },
    { sequence: 2, sdkVersion: '0.1.0', status: 403 },
  ];
  observed.assertCount(2);
  observed.assertExchanges(exchanges);
  assert.equal(first.attempts.length, 1);
  assert.equal(first.attempts[0].status, null);
  assert.ok(Object.isFrozen(first.attempts[0]));
  for (const bad of [
    [],
    [...exchanges, exchanges[0]],
    [{ ...exchanges[0], sdkVersion: '0.2.0' }, exchanges[1]],
    [exchanges[0], { ...exchanges[1], status: 503 }],
  ])
    assert.throws(() => observed.assertExchanges(bad));
});

test('pending calls and observer failures cannot be presented as complete', async () => {
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const observed = observeAttempts({ createSubmissionToken: () => held }, scope);
  const call = observed.invoke({});
  assert.equal(observed.snapshot().complete, false);
  assert.throws(() => observed.assertCount(0));
  observed.invalidate();
  release({});
  await call;
  assert.equal(observed.snapshot().complete, false);
});

test('observer transport failure stays incomplete after its counter becomes available', async () => {
  const input = context();
  input.service.readExchangeCount = async () => {
    throw new Error('private-observer-error');
  };
  const bridge = await safetyProvider(input).startScenario({ scenario: 'origin-aliases', runId });
  await assert.rejects(bridge.readExchangeCount());
  input.service.readExchangeCount = async () => snapshot(0);
  await assert.rejects(bridge.readExchangeCount());
  await assert.rejects(bridge.evidence());
  await assert.rejects(bridge.close());
  assert.equal(input.service.closed, 1);
});

test('unsupported local rejection requires the exact SDK message and known negative input', async () => {
  for (const [options, message, complete] of [
    [{ userId: 'canary' }, 'createSubmissionToken options contain unsupported fields', true],
    [{}, 'createSubmissionToken options contain unsupported fields', false],
    [{ userId: 'canary' }, 'unsupported transport', false],
  ]) {
    const observed = observeAttempts(
      {
        async createSubmissionToken() {
          throw new TypeError(message);
        },
      },
      scope
    );
    await assert.rejects(observed.invoke(options, 'unsupported'));
    assert.equal(observed.snapshot().complete, complete);
  }
});
