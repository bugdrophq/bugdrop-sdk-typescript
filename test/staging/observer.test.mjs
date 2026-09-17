import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createObserverLease } from '../../scripts/staging/observer.mjs';
import { observerFixture } from './observer-support.mjs';

test('signed v2 start/read/close use fresh nonces, exact scopes and immutable snapshots', async () => {
  const { lease, state } = observerFixture();
  await lease.start();
  state.exchanges.push({ sequence: 1, sdkVersion: '0.1.0', status: 201 });
  const first = await lease.read();
  assert.ok(Object.isFrozen(first.exchanges[0]));
  state.exchanges.push({ sequence: 2, sdkVersion: '0.1.0', status: 403 });
  assert.equal(first.exchanges.length, 1);
  await lease.read();
  await lease.close();
  assert.equal(state.calls.length, 4);
  await assert.rejects(lease.read(), /staging_observation_incomplete/);
});

test('invalid signed replies fail closed without retaining secrets or allowing healthy recovery', async () => {
  const mutations = [
    (v) => {
      v.schemaVersion = 1;
    },
    (v) => {
      v.requestNonce = '12345678-1234-4234-8234-123456789abc';
    },
    (v) => {
      v.leaseId = '12345678-1234-4234-8234-123456789abc';
    },
    (v) => {
      v.expiresAt = Date.now() - 1;
    },
    (v) => {
      v.sequence = 1;
    },
    (v) => {
      v.snapshot.runId = '12345678-1234-4234-8234-123456789abc';
    },
    (v) => {
      v.snapshot.applicationId = 'other';
    },
    (v) => {
      v.snapshot.scenario = 'origin';
    },
    (v) => {
      v.snapshot.complete = false;
    },
    (v) => {
      v.snapshot.exclusive = false;
    },
    (v) => {
      v.snapshot.count = 1;
    },
    (v) => {
      v.token = 'secret-canary';
    },
    (v) => {
      v.exchanges = [{ sequence: 1, sdkVersion: null, status: null }];
      v.snapshot.count = 1;
    },
  ];
  for (const mutate of mutations) {
    const { lease, state } = observerFixture();
    await lease.start();
    state.mode = ({ path, body, respond }) => {
      mutate(body);
      return respond(path, body);
    };
    await assert.rejects(lease.read(), { message: 'staging_observation_incomplete' });
    state.mode = undefined;
    await assert.rejects(lease.read());
    await assert.rejects(lease.close());
    assert.ok(state.calls.some(({ path }) => path === '/observation/close'));
  }
});

test('same-lease stale read and wrong-path signatures cannot satisfy a fresh read', async () => {
  for (const mode of ['replay', 'path', 'forged']) {
    const { lease, state } = observerFixture();
    await lease.start();
    let captured;
    state.mode = ({ path, body, respond }) => {
      captured = respond(path, body);
      return captured.clone();
    };
    await lease.read();
    state.exchanges.push({ sequence: 1, sdkVersion: '0.1.0', status: 200 });
    state.mode = ({ body, respond }) =>
      mode === 'replay'
        ? captured.clone()
        : respond(
            '/observation/start',
            body,
            mode === 'forged' ? { headers: { 'X-BugDrop-Observation-Signature': 'bad' } } : {}
          );
    await assert.rejects(lease.read());
    state.mode = undefined;
    await assert.rejects(lease.close());
  }
});

test('count regression, mutation and extra admissions between final read and close fail', async () => {
  for (const change of ['regress', 'mutate', 'late']) {
    const { lease, state } = observerFixture();
    await lease.start();
    state.exchanges.push({ sequence: 1, sdkVersion: '0.1.0', status: 200 });
    await lease.read();
    if (change === 'regress') state.exchanges.length = 0;
    if (change === 'mutate') state.exchanges[0].status = 403;
    if (change === 'late') state.exchanges.push({ sequence: 2, sdkVersion: '0.1.0', status: 200 });
    await assert.rejects(lease.close());
  }
});

test('missing capabilities or lease, failed start/read/close never become a passing lifecycle', async () => {
  const fixture = observerFixture();
  for (const delta of [
    { transport: undefined },
    { key: undefined },
    { key: 'secret-canary' },
    { endpoint: 'https://unapproved.invalid' },
  ])
    assert.throws(
      () =>
        createObserverLease({
          ...fixture.scope,
          transport: fixture.transport,
          key: fixture.key,
          ...delta,
        }),
      { message: 'staging_observation_incomplete' }
    );
  for (const method of ['read', 'close']) {
    const { lease, state } = observerFixture();
    await assert.rejects(lease[method]());
    assert.equal(state.calls.length, 0);
    await assert.rejects(lease.start());
  }
  for (const method of ['start', 'read', 'close']) {
    const { lease, state } = observerFixture();
    if (method !== 'start') {
      await lease.start();
      await lease.read();
    }
    state.mode = () => new Response('secret-canary', { status: 403 });
    await assert.rejects(lease[method](), { message: 'staging_observation_incomplete' });
    state.mode = undefined;
    await assert.rejects(lease[method]());
    await assert.rejects(lease.close());
  }
});
