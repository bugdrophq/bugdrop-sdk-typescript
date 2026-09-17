import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  exact,
  uuid,
  observerScenarios,
  observerKey,
  observerSignature,
  verifyObserverSignature,
  validateObservation,
} from './observer-wire.mjs';

const rejected = () => new Error('staging_observation_incomplete');

// A private provider supplies transport and key. There is deliberately no URL or fetch default.
export function createObserverLease({ transport, key, ...scope }) {
  let secret;
  try {
    assert.equal(typeof transport, 'function');
    secret = observerKey(key);
    exact(scope, ['applicationId', 'installationId', 'runId', 'scenario']);
    assert.match(scope.applicationId, /^[a-zA-Z0-9_-]{1,100}$/);
    assert.notEqual(scope.applicationId, 'UNAPPROVED');
    assert.match(scope.installationId, /^[1-9][0-9]{0,19}$/);
    uuid(scope.runId);
    assert.ok(observerScenarios.includes(scope.scenario));
  } catch {
    throw rejected();
  }
  Object.freeze(scope);
  let lease, previous;
  let failed = false,
    started = false,
    closed = false,
    busy = false,
    read = false;

  async function exchange(operation) {
    const path = `/observation/${operation}`;
    const requestNonce = randomUUID();
    const raw = JSON.stringify({
      schemaVersion: 2,
      requestNonce,
      ...scope,
      ...(lease ? { leaseId: lease.leaseId } : {}),
    });
    assert.ok(Buffer.byteLength(raw) <= 1024);
    const controller = new AbortController();
    let timer, reader;
    try {
      const result = await Promise.race([
        (async () => {
          const response = await transport(path, {
            method: 'POST',
            body: raw,
            signal: controller.signal,
            headers: { 'X-BugDrop-Observation-Signature': observerSignature(secret, path, raw) },
          });
          if (controller.signal.aborted || response.status !== 200) {
            void response.body?.cancel().catch(() => {});
            throw rejected();
          }
          reader = response.body?.getReader();
          assert.ok(reader);
          const chunks = [];
          let size = 0;
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            size += part.value.byteLength;
            assert.ok(size <= 16384);
            chunks.push(part.value);
          }
          const bytes = Buffer.concat(chunks);
          verifyObserverSignature(
            secret,
            path,
            bytes,
            response.headers.get('X-BugDrop-Observation-Signature')
          );
          const value = JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(bytes));
          return validateObservation(value, {
            scope,
            operation,
            lease,
            previous,
            requestNonce,
            now: Date.now(),
          });
        })(),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            void reader?.cancel().catch(() => {});
            reject(rejected());
          }, 2000);
        }),
      ]);
      return result;
    } finally {
      clearTimeout(timer);
      void reader?.cancel().catch(() => {});
    }
  }

  async function call(operation) {
    if (busy || closed || (operation === 'start' ? started || failed : !lease)) {
      failed = true;
      throw rejected();
    }
    busy = true;
    if (operation === 'start') started = true;
    try {
      const value = await exchange(operation);
      if (operation === 'start') lease = { leaseId: value.leaseId, expiresAt: value.expiresAt };
      if (operation === 'read') {
        previous = value;
        read = true;
      }
      if (operation === 'close') {
        closed = true;
        if (!read) failed = true;
      }
      if (failed) throw rejected();
      return value;
    } catch {
      failed = true;
      throw rejected();
    } finally {
      busy = false;
    }
  }
  return Object.freeze({
    start: () => call('start'),
    read: () => call('read'),
    close: () => call('close'),
  });
}
