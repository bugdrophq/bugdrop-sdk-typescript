import assert from 'node:assert/strict';
import { startTransportFixture } from './transport-fixture.mjs';
import { loadBrowser } from './packed-consumer.mjs';

export async function checkTransport(consumer, fixtures) {
  const service = await startTransportFixture();
  const credential = fixtures['api-key-credential'];
  const binding = fixtures['submission-binding'].bound;
  const response = {
    ...fixtures['capability-response'],
    expiresAt: new Date(Date.now() + 240_000).toISOString(),
  };
  const client = new consumer.BugDrop({ apiKey: credential.apiKey, endpoint: service.endpoint });
  try {
    service.respond(response);
    for (const apiKey of credential.invalidApiKeys) {
      assert.throws(
        () => new consumer.BugDrop({ apiKey, endpoint: service.endpoint }),
        /valid API key/
      );
    }
    for (const payloadDigest of fixtures['submission-binding'].invalidPayloadDigests) {
      await assert.rejects(
        client.createSubmissionToken({ ...binding, payloadDigest }),
        /payloadDigest/
      );
    }
    assert.equal(service.requests.length, 0);
    for (const Client of [consumer.BugDrop, consumer.CommonJsBugDrop]) {
      assert.deepEqual(
        await new Client({
          apiKey: credential.apiKey,
          endpoint: service.endpoint,
        }).createSubmissionToken(binding),
        response
      );
    }
    const token = await loadBrowser(
      consumer,
      (candidate) => client.createSubmissionToken(candidate),
      binding,
      'https://app.example.com',
      fixtures['widget-public-api']
    );
    assert.equal(token, response.token);
    for (const request of service.requests) {
      assert.deepEqual(JSON.parse(request.body), { schemaVersion: 1, ...binding });
      assert.equal(request.headers.authorization, credential.authorization);
      assert.equal(request.headers['x-bugdrop-sdk-version'], consumer.versions.server);
      assert.ok(!JSON.stringify(request).includes(credential.apiKey));
      assert.ok(!JSON.stringify(request).includes(credential.rootSecret));
    }
    for (const origin of fixtures.origin.valid) {
      await client.createSubmissionToken({ ...binding, origin });
      assert.equal(JSON.parse(service.requests.at(-1).body).origin, origin);
    }
    for (const origin of fixtures.origin.invalid) {
      const before = service.requests.length;
      await assert.rejects(client.createSubmissionToken({ ...binding, origin }), /origin/);
      assert.equal(service.requests.length, before);
    }
    for (const field of ['userId', 'subject', 'reporterId', 'pseudonym', 'repo', 'labels']) {
      const before = service.requests.length;
      await assert.rejects(
        client.createSubmissionToken({ ...binding, [field]: 'identity-canary' }),
        /unsupported/
      );
      assert.equal(service.requests.length, before);
    }
    for (const payload of [
      null,
      { ...response, schemaVersion: 2 },
      { ...response, token: '' },
      { ...response, expiresAt: '2099-02-29T00:00:00.000Z' },
      { ...response, expiresAt: new Date(Date.now() + 600_000).toISOString() },
      { ...response, expiresAt: '2020-01-01T00:00:00.000Z' },
    ]) {
      service.respond(payload);
      await assert.rejects(client.createSubmissionToken(binding), { code: 'invalid_response' });
      await assert.rejects(
        loadBrowser(
          consumer,
          async () => payload,
          binding,
          'https://app.example.com',
          fixtures['widget-public-api']
        ),
        /Unable to authorize BugDrop/
      );
    }
    for (const status of [307, 401, 403, 429, 500, 503]) {
      const before = service.requests.length;
      service.respond({ secret: credential.apiKey, report: 'report-content-canary' }, status);
      await assert.rejects(client.createSubmissionToken(binding), (error) => {
        assert.equal(error.code, 'request_failed');
        assert.doesNotMatch(String(error), /report-content-canary|bd_api_v1/);
        return true;
      });
      assert.equal(service.requests.length, before + 1);
      assert.equal(service.requests.at(-1).path, '/v1/submission-capabilities');
    }
  } finally {
    await service.close();
  }
}
