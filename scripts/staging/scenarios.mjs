import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';

function credentialCanaries(apiKey) {
  const [prefix, keyId, root] = apiKey.split('.');
  assert.equal(prefix, 'bd_api_v1');
  const secret = createHmac('sha256', Buffer.from(root, 'base64url'))
    .update(`bugdrop:auth:v1\0${keyId}`, 'utf8')
    .digest('base64url');
  return [apiKey, root, secret, `Bearer bd_auth_v1.${keyId}.${secret}`];
}

export async function runScenarios({ consumer, fixtures, provider, oracle, target, runId }) {
  const names = ['delivered', 'origin', 'tampered', 'binding', 'revoked', 'stale', 'indeterminate'];
  for (const name of names) {
    const submissionId = randomUUID();
    const service = await provider.startScenario({ name, submissionId, runId });
    try {
      assert.equal(service.endpoint, target.endpoint);
      assert.equal(service.origin, target.origin);
      const apiKey = await service.resolveApiKey();
      assert.equal(typeof apiKey, 'string');
      assert.notEqual(
        apiKey,
        fixtures['api-key-credential'].apiKey,
        'Fixture credentials are not staging credentials'
      );
      const client = new consumer.BugDrop({ apiKey, endpoint: target.endpoint });
      const binding = { ...fixtures['submission-binding'].bound, submissionId };
      const requestBody = fixtures['submission-binding'].requestBody;
      const forbiddenValues = [
        ...credentialCanaries(apiKey),
        submissionId,
        requestBody,
        'Save failed',
        '/settings',
        'identity-canary',
      ];
      const submissionOutcomes = [];
      let exchangeCount = 0;
      async function authorize(origin = target.origin) {
        exchangeCount++;
        const capability = await client.createSubmissionToken({ ...binding, origin });
        forbiddenValues.push(capability.token);
        return capability;
      }
      async function submit(capability, expected, overrides = {}) {
        const response = await service.submit({ capability, binding, requestBody, ...overrides });
        assert.deepEqual(response, { schemaVersion: 1, outcome: expected });
        submissionOutcomes.push(expected);
      }
      if (name === 'origin') {
        const wrongOrigin =
          target.origin === 'https://other.example.com'
            ? 'https://different.example.com'
            : 'https://other.example.com';
        await assert.rejects(authorize(wrongOrigin), { code: 'request_failed' });
        for (const origin of fixtures.origin.invalid) {
          await assert.rejects(client.createSubmissionToken({ ...binding, origin }), /origin/);
        }
        await assert.rejects(
          client.createSubmissionToken({ ...binding, userId: 'identity-canary' }),
          /unsupported/
        );
      } else {
        if (name === 'indeterminate') await service.setDeliveryIndeterminate();
        const capability = await authorize();
        if (name === 'delivered' || name === 'indeterminate') {
          await submit(capability, name);
          await submit(capability, name);
        } else if (name === 'tampered') {
          await submit({ ...capability, token: capability.token + 'tampered' }, 'rejected');
        } else if (name === 'binding') {
          for (const vector of fixtures['submission-binding'].verificationCases.filter(
            (value) => !value.accepted
          )) {
            const changedId =
              vector.submissionId !== fixtures['submission-binding'].bound.submissionId;
            const candidateId = changedId ? randomUUID() : submissionId;
            forbiddenValues.push(candidateId, vector.requestBody);
            await submit(capability, 'rejected', {
              requestBody: vector.requestBody,
              binding: { ...binding, submissionId: candidateId },
            });
          }
        } else {
          if (name === 'revoked') await service.revoke();
          else await service.expireAuthorizationState();
          await assert.rejects(authorize(), { code: 'request_failed' });
          await submit(capability, 'rejected');
        }
      }
      const evidence = await service.evidence();
      const serialized = JSON.stringify(evidence);
      for (const value of forbiddenValues) assert.ok(!serialized.includes(value));
      // Safety owns the remote schema and provenance checks. A missing or false result is failure.
      assert.equal(
        await oracle.assertEvidence({
          evidence,
          expected: {
            environment: 'staging',
            serviceRevision: target.serviceRevision,
            deploymentDigest: target.deploymentDigest,
            repositoryId: target.repositoryId,
            runId,
            scenario: name,
            sdkVersion: consumer.versions.server,
            exchangeCount,
            submissionOutcomes,
            attempts: ['delivered', 'indeterminate'].includes(name) ? 1 : 0,
          },
          forbiddenValues,
        }),
        true
      );
    } finally {
      await service.close();
    }
  }
}
