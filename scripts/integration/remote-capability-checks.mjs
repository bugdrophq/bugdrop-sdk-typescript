import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { credentialCanaries } from '../staging/canaries.mjs';
import { preflightRemoteCapabilityProvider } from '../staging/remote-capability-provider.mjs';

export async function checkRemoteCapabilityProvider(consumer, fixtures) {
  const endpoint = 'https://staging.example.test/v1/submission-capabilities';
  const origin = 'https://customer.example.test';
  const target = { endpoint, origin, applicationId: 'fixture-app' };
  const runId = randomUUID();
  const apiKey = `bd_api_v1.${randomBytes(16).toString('base64url')}.${randomBytes(32).toString('base64url')}`;
  const requests = [];
  let resolutions = 0;
  const response = {
    ...fixtures['capability-response'],
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
  class FakeHttpPackedClient extends consumer.BugDrop {
    constructor(options) {
      super({
        ...options,
        fetch: async (url, init) => {
          requests.push({ url, init });
          return new Response(JSON.stringify(response), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      });
    }
  }
  const packed = { BugDrop: FakeHttpPackedClient };
  const service = {
    endpoint,
    origin,
    async resolveApiKey() {
      resolutions++;
      return apiKey;
    },
  };
  await assert.rejects(
    preflightRemoteCapabilityProvider({
      target,
      inspectTarget: async () => ({ ...target, endpoint: 'https://other.example.test', runId }),
    }),
    /differs from approval/
  );
  assert.equal(resolutions, 0);
  assert.equal(requests.length, 0);
  const remote = await preflightRemoteCapabilityProvider({
    target,
    inspectTarget: async () => ({ ...target, runId }),
  });
  await assert.rejects(
    remote.openScenario({
      consumer: packed,
      service: { ...service, endpoint: 'https://other.example.test' },
    }),
    /Scenario endpoint differs/
  );
  await assert.rejects(
    remote.openScenario({
      consumer: packed,
      service: { ...service, origin: 'https://other.example.test' },
    }),
    /Scenario origin differs/
  );
  assert.equal(resolutions, 0);
  assert.equal(requests.length, 0);
  await assert.rejects(
    remote.openScenario({
      consumer: packed,
      service: { ...service, resolveApiKey: async () => fixtures['api-key-credential'].apiKey },
      fixtureApiKey: fixtures['api-key-credential'].apiKey,
    }),
    /Fixture credential cannot qualify staging/
  );
  assert.equal(requests.length, 0);
  const { client } = await remote.openScenario({
    consumer: packed,
    service,
    fixtureApiKey: fixtures['api-key-credential'].apiKey,
  });
  const binding = fixtures['submission-binding'].bound;
  assert.deepEqual(await client.createSubmissionToken({ ...binding, origin }), response);
  assert.equal(resolutions, 1);
  assert.equal(requests.length, 1);
  const request = requests[0];
  assert.equal(request.url, endpoint);
  assert.equal(request.init.method, 'POST');
  assert.equal(request.init.redirect, 'error');
  assert.equal(request.init.headers.Authorization, credentialCanaries(apiKey).at(-1));
  assert.equal(
    request.init.headers.Accept,
    'application/vnd.bugdrop.submission-capability.v1+json'
  );
  assert.equal(request.init.headers['X-BugDrop-Contract-Version'], '1');
  assert.equal(request.init.headers['X-BugDrop-SDK-Version'], consumer.versions.server);
  assert.deepEqual(JSON.parse(request.init.body), { schemaVersion: 1, ...binding, origin });
  assert.ok(!JSON.stringify(request).includes(apiKey));
  assert.ok(!JSON.stringify(request).includes(apiKey.split('.')[2]));
}
