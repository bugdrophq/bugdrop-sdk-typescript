import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { credentialCanaries } from '../../scripts/staging/canaries.mjs';
import { observerFixture } from './observer-support.mjs';

const apiKey = () =>
  `bd_api_v1.${randomBytes(16).toString('base64url')}.${randomBytes(32).toString('base64url')}`;

function parseV1Request(request, body, record, expectedDigest) {
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (
    request.url !== '/v1/submission-capabilities' ||
    request.method !== 'POST' ||
    request.headers['content-type'] !== 'application/json' ||
    request.headers.accept !== 'application/vnd.bugdrop.submission-capability.v1+json' ||
    request.headers['x-bugdrop-contract-version'] !== '1' ||
    request.headers['x-bugdrop-sdk-version'] !== '0.1.0' ||
    !parsed ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    Object.keys(parsed).sort().join(',') !== 'origin,payloadDigest,schemaVersion,submissionId' ||
    parsed.schemaVersion !== 1 ||
    typeof parsed.submissionId !== 'string' ||
    Buffer.byteLength(parsed.submissionId) < 1 ||
    Buffer.byteLength(parsed.submissionId) > 200 ||
    (record.submissionId && parsed.submissionId !== record.submissionId) ||
    parsed.payloadDigest !== expectedDigest ||
    typeof parsed.origin !== 'string'
  )
    return null;
  return parsed;
}

// A local contract double: HTTP is real, while admission and observations are synthetic.
export async function providerObserverFixture(target, expectedDigest) {
  assert.match(expectedDigest, /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/);
  const records = [];
  let active;
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    const record = active;
    assert.ok(record, 'request must belong to an active scenario');
    record.networkRequests++;
    const reject = (status) => {
      response.writeHead(status);
      response.end();
    };
    if (request.headers.authorization !== record.expectedBearer) return reject(401);
    const parsed = parseV1Request(request, body, record, expectedDigest);
    if (!parsed) return reject(400);
    if (record.preAdmission503) {
      response.writeHead(503);
      response.end('{"error":"unavailable"}');
      return;
    }
    const denied = parsed.origin !== target.origin || record.blocked;
    const status = denied ? 403 : 200;
    record.observer.state.exchanges.push({
      sequence: record.observer.state.exchanges.length + 1,
      sdkVersion: request.headers['x-bugdrop-sdk-version'],
      status,
    });
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(
      JSON.stringify({
        schemaVersion: 1,
        token: `local-capability-canary-${record.networkRequests}`,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      })
    );
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}/v1/submission-capabilities`;

  async function start(scenario, runId, safety, submissionId) {
    assert.equal(active, undefined, 'previous scenario must be closed');
    const observer = observerFixture({
      applicationId: target.applicationId,
      installationId: target.repositoryId,
      runId,
      scenario,
    });
    const record = {
      scenario,
      submissionId,
      apiKey: apiKey(),
      observer,
      networkRequests: 0,
      blocked: false,
      preAdmission503: false,
      closed: false,
      outcomes: [],
      consumed: new Set(),
      attempts: 0,
      evidenceReads: 0,
    };
    record.expectedBearer = credentialCanaries(record.apiKey).at(-1);
    records.push(record);
    active = record;
    try {
      await observer.lease.start();
    } catch (error) {
      active = undefined;
      throw error;
    }
    const service = {
      endpoint,
      origin: target.origin,
      resolveApiKey: async () => record.apiKey,
      async submit({ capability }) {
        const eligible = ['delivered', 'indeterminate'].includes(scenario);
        const used = record.consumed.has(capability.token);
        const outcome = eligible && !used ? scenario : 'rejected';
        if (eligible && !used) {
          record.consumed.add(capability.token);
          if (!record.attempts) record.attempts++;
        }
        record.outcomes.push(outcome);
        return { schemaVersion: 1, outcome };
      },
      revoke() {
        record.blocked = true;
      },
      expireAuthorizationState() {
        record.blocked = true;
      },
      setDeliveryIndeterminate() {},
      async evidence({ sdkAttemptTranscript } = {}) {
        assert.equal(sdkAttemptTranscript?.scenario, scenario);
        record.evidenceReads++;
        const observation = await observer.lease.read();
        return {
          exchanges: observation.exchanges,
          outcomes: [...record.outcomes],
          attempts: record.attempts,
        };
      },
      async close() {
        try {
          await observer.lease.close();
        } finally {
          record.closed = true;
          active = undefined;
        }
      },
    };
    if (safety) {
      for (const method of [
        'injectFault',
        'restart',
        'waitForDispatch',
        'expireAuthorization',
        'substituteTrustedContext',
        'seedRetentionFixtures',
        'runNativeRetentionAlarm',
        'readRetentionFixtures',
        'uninstallApprovedInstallation',
        'waitForSignedUninstall',
      ])
        service[method] = () => {};
      service.secretMarkers = async () => ['local-provider-secret-canary'];
      service.readExchangeCount = async () => (await observer.lease.read()).snapshot;
    }
    return service;
  }
  return {
    endpoint,
    records,
    provider: {
      startScenario: ({ name, submissionId, runId }) => start(name, runId, false, submissionId),
      startSafetyScenario: ({ scenario, runId }) => start(scenario, runId, true),
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
