import assert from 'node:assert/strict';
import { createHmac, timingSafeEqual } from 'node:crypto';

export const observerScenarios = Object.freeze([
  'delivered',
  'origin',
  'tampered',
  'binding',
  'revoked',
  'stale',
  'indeterminate',
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
]);
export const exact = (value, fields) => {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(), [...fields].sort());
};
export const uuid = (value) =>
  assert.match(value, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
export function observerKey(value) {
  assert.equal(typeof value, 'string');
  const key = Buffer.from(value, 'base64url');
  assert.equal(key.length, 32);
  assert.equal(key.toString('base64url'), value);
  return key;
}
export function observerSignature(key, path, raw, response = false) {
  return createHmac('sha256', key)
    .update(`bugdrop:staging:observation-${response ? 'response' : 'request'}:v2\0${path}\0`)
    .update(raw)
    .digest('base64url');
}
export function verifyObserverSignature(key, path, raw, signature) {
  assert.equal(typeof signature, 'string');
  const expected = Buffer.from(observerSignature(key, path, raw, true));
  const actual = Buffer.from(signature);
  assert.equal(actual.length, expected.length);
  assert.ok(timingSafeEqual(actual, expected));
}

export function validateObservation(
  value,
  { scope, operation, lease, previous, requestNonce, now }
) {
  exact(value, [
    'schemaVersion',
    'requestNonce',
    'leaseId',
    'expiresAt',
    'sequence',
    'snapshot',
    'exchanges',
  ]);
  assert.equal(value.schemaVersion, 2);
  uuid(value.requestNonce);
  assert.equal(value.requestNonce, requestNonce);
  uuid(value.leaseId);
  assert.equal(value.sequence, null);
  assert.ok(Number.isSafeInteger(value.expiresAt) && value.expiresAt > now);
  assert.ok(value.expiresAt <= now + 900_000);
  if (lease) {
    assert.equal(value.leaseId, lease.leaseId);
    assert.equal(value.expiresAt, lease.expiresAt);
  }
  exact(value.snapshot, ['runId', 'scenario', 'applicationId', 'count', 'complete', 'exclusive']);
  for (const name of ['runId', 'scenario', 'applicationId'])
    assert.equal(value.snapshot[name], scope[name]);
  assert.equal(value.snapshot.complete, operation !== 'close');
  assert.equal(value.snapshot.exclusive, operation !== 'close');
  assert.ok(Array.isArray(value.exchanges) && value.exchanges.length <= 64);
  assert.equal(value.snapshot.count, value.exchanges.length);
  for (const [index, entry] of value.exchanges.entries()) {
    exact(entry, ['sequence', 'sdkVersion', 'status']);
    assert.equal(entry.sequence, index + 1);
    assert.equal(entry.sdkVersion, '0.1.0');
    assert.ok(Number.isInteger(entry.status) && entry.status >= 200 && entry.status <= 599);
  }
  if (operation === 'start') assert.equal(value.exchanges.length, 0);
  if (previous) {
    assert.ok(value.exchanges.length >= previous.exchanges.length);
    assert.deepEqual(value.exchanges.slice(0, previous.exchanges.length), previous.exchanges);
    if (operation === 'close') assert.deepEqual(value.exchanges, previous.exchanges);
  }
  return Object.freeze({
    ...value,
    snapshot: Object.freeze({ ...value.snapshot }),
    exchanges: Object.freeze(value.exchanges.map((entry) => Object.freeze({ ...entry }))),
  });
}
