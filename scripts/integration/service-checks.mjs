import assert from 'node:assert/strict';
import { assertPrivateEvidence } from './evidence-checks.mjs';
import { loadBrowser } from './packed-consumer.mjs';

const outcomes = ['delivered', 'delivering', 'indeterminate', 'failed_before_delivery', 'rejected'];

function assertOutcome(value, expected) {
  assert.deepEqual(Object.keys(value).sort(), ['outcome', 'schemaVersion']);
  assert.equal(value.schemaVersion, 1);
  assert.ok(outcomes.includes(value.outcome));
  assert.equal(value.outcome, expected);
}

export async function checkService(consumer, fixtures, start) {
  const wireFixtures = Object.fromEntries(
    Object.entries(fixtures).map(([key, value]) => [`${key}.v1.json`, value])
  );
  async function scenario(check) {
    const service = await start({ fixtures: wireFixtures });
    const endpoint = new URL(service.endpoint);
    assert.equal(endpoint.protocol, 'http:');
    assert.ok(endpoint.hostname.endsWith('.localhost'), 'Service adapter must remain local-only');
    const client = new consumer.BugDrop({
      apiKey: fixtures['api-key-credential'].apiKey,
      endpoint: service.endpoint,
    });
    try {
      await check(service, client);
    } finally {
      await service.close();
    }
  }
  const fixture = fixtures['submission-binding'];
  const authorize = (service, client, binding = fixture.bound) =>
    client.createSubmissionToken({
      ...binding,
      origin: service.origin,
    });
  const submit = (service, capability, overrides = {}) =>
    service.submit({
      capability,
      binding: fixture.bound,
      requestBody: fixture.requestBody,
      ...overrides,
    });

  await scenario(async (service, client) => {
    let capability;
    const token = await loadBrowser(
      consumer,
      async (binding) => {
        capability = await authorize(service, client, binding);
        return capability;
      },
      fixture.bound,
      service.origin,
      fixtures['widget-public-api']
    );
    assert.equal(token, capability.token);
    assertOutcome(await submit(service, capability), 'delivered');
    assertOutcome(await submit(service, capability), 'delivered');
    const evidence = await service.evidence();
    assert.equal(evidence.attempts, 1, 'Replay caused a second delivery attempt');
    assert.deepEqual(evidence.sdkVersions, [consumer.versions.server]);
    assertPrivateEvidence(evidence, fixtures, capability, consumer.versions.server);
  });
  await scenario(async (service, client) => {
    const wrongOrigin =
      service.origin === 'https://other.example.com'
        ? 'https://example.com'
        : 'https://other.example.com';
    await assert.rejects(client.createSubmissionToken({ ...fixture.bound, origin: wrongOrigin }), {
      code: 'request_failed',
    });
    for (const origin of fixtures.origin.invalid) {
      await assert.rejects(client.createSubmissionToken({ ...fixture.bound, origin }), /origin/);
    }
    assert.equal((await service.evidence()).attempts, 0);
  });
  await scenario(async (service, client) => {
    const capability = await authorize(service, client);
    assertOutcome(
      await submit(service, { ...capability, token: capability.token + 'tampered' }),
      'rejected'
    );
    assert.equal((await service.evidence()).attempts, 0);
    assertPrivateEvidence(await service.evidence(), fixtures, capability, consumer.versions.server);
  });
  for (const vector of fixture.verificationCases.filter((value) => !value.accepted)) {
    await scenario(async (service, client) => {
      const capability = await authorize(service, client);
      assertOutcome(
        await submit(service, capability, {
          requestBody: vector.requestBody,
          binding: { ...fixture.bound, submissionId: vector.submissionId },
        }),
        'rejected'
      );
      assert.equal((await service.evidence()).attempts, 0);
      assertPrivateEvidence(
        await service.evidence(),
        fixtures,
        capability,
        consumer.versions.server
      );
    });
  }
  for (const control of ['revoke', 'expireAuthorizationState']) {
    await scenario(async (service, client) => {
      const capability = await authorize(service, client);
      await service[control]();
      await assert.rejects(authorize(service, client), { code: 'request_failed' });
      assertOutcome(await submit(service, capability), 'rejected');
      assert.equal((await service.evidence()).attempts, 0);
      assertPrivateEvidence(
        await service.evidence(),
        fixtures,
        capability,
        consumer.versions.server
      );
    });
  }
  await scenario(async (service, client) => {
    await service.setDeliveryIndeterminate();
    const capability = await authorize(service, client);
    assertOutcome(await submit(service, capability), 'indeterminate');
    assertOutcome(await submit(service, capability), 'indeterminate');
    const evidence = await service.evidence();
    assert.equal(evidence.attempts, 1, 'Indeterminate outcome retried delivery');
    assertPrivateEvidence(evidence, fixtures, capability, consumer.versions.server);
  });
}
