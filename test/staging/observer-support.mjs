import assert from 'node:assert/strict';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { createObserverLease } from '../../scripts/staging/observer.mjs';
import { runId } from './safety-support.mjs';

// Synthetic private transport fixture, never a remote observation or credential.
export function observerFixture() {
  const key = randomBytes(32).toString('base64url');
  const scope = {
    applicationId: 'test-app',
    installationId: '202',
    runId,
    scenario: 'origin-aliases',
  };
  const state = {
    leaseId: randomUUID(),
    expiresAt: Date.now() + 890_000,
    exchanges: [],
    calls: [],
    mode: undefined,
  };
  const sign = (path, raw, response = true) =>
    createHmac('sha256', Buffer.from(key, 'base64url'))
      .update(
        `bugdrop:staging:observation-${response ? 'response' : 'request'}:v2\0${path}\0${raw}`
      )
      .digest('base64url');
  const respond = (path, body, overrides = {}) => {
    const raw = JSON.stringify(body);
    return new Response(raw, {
      headers: { 'X-BugDrop-Observation-Signature': sign(path, raw) },
      ...overrides,
    });
  };
  const transport = async (path, init) => {
    assert.equal(init.method, 'POST');
    assert.equal(init.headers['X-BugDrop-Observation-Signature'], sign(path, init.body, false));
    const request = JSON.parse(init.body);
    assert.equal(request.schemaVersion, 2);
    assert.deepEqual(
      Object.keys(request).sort(),
      [
        'schemaVersion',
        'requestNonce',
        ...Object.keys(scope),
        ...(path.endsWith('/start') ? [] : ['leaseId']),
      ].sort()
    );
    for (const name of Object.keys(scope)) assert.equal(request[name], scope[name]);
    if (!path.endsWith('/start')) assert.equal(request.leaseId, state.leaseId);
    assert.match(
      request.requestNonce,
      /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
    );
    assert.ok(!state.calls.some((call) => call.requestNonce === request.requestNonce));
    state.calls.push({ path, requestNonce: request.requestNonce });
    const body = {
      schemaVersion: 2,
      requestNonce: request.requestNonce,
      leaseId: state.leaseId,
      expiresAt: state.expiresAt,
      sequence: null,
      snapshot: {
        runId,
        scenario: scope.scenario,
        applicationId: scope.applicationId,
        count: state.exchanges.length,
        complete: !path.endsWith('/close'),
        exclusive: !path.endsWith('/close'),
      },
      exchanges: structuredClone(state.exchanges),
    };
    return state.mode ? state.mode({ path, init, body, respond, sign }) : respond(path, body);
  };
  return { state, key, scope, transport, lease: createObserverLease({ transport, key, ...scope }) };
}
