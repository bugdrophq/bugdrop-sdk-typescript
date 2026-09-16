import fixture from '../packages/contracts/fixtures/api-key-credential.v1.json';
import { describe, expect, it } from 'vitest';
import { createApiKeyAuthenticator } from '../packages/server/src/api-key.js';

const request = {
  method: 'POST' as const,
  url: 'https://bugdrop.example/v1/submission-capabilities',
  body: '{"schemaVersion":1}',
};
describe('V1 API-key authenticator', () => {
  it('matches the shared application authentication vector', async () => {
    const authentication = createApiKeyAuthenticator(fixture.apiKey);
    await expect(authentication.authenticateRequest(request)).resolves.toEqual({
      Authorization: fixture.authorization,
    });
  });

  it('sends only the derived authentication secret, never the root API key', async () => {
    const authentication = createApiKeyAuthenticator(fixture.apiKey);
    const headers = await authentication.authenticateRequest(request);

    expect(headers.Authorization).toBe(`Bearer bd_auth_v1.${fixture.keyId}.${fixture.authSecret}`);
    expect(headers.Authorization).not.toContain(fixture.rootSecret);
    expect(headers.Authorization).not.toContain(fixture.apiKey);
  });

  it.each([
    ...fixture.invalidApiKeys,
    undefined,
    '',
    ` ${fixture.apiKey}`,
    fixture.apiKey.replace('bd_api_v1', 'bd_api_v2'),
    `${fixture.apiKey}.extra`,
    fixture.apiKey.replace('AAECAwQFBgcICQoLDA0ODw', 'AAECAwQFBgcICQoLDA0OD!'),
    fixture.apiKey.slice(0, -1),
  ])('rejects malformed API key %# without echoing it', (apiKey) => {
    expect(() => createApiKeyAuthenticator(apiKey)).toThrow('valid API key');
    try {
      createApiKeyAuthenticator(apiKey);
    } catch (error) {
      if (apiKey) expect(String(error)).not.toContain(apiKey);
    }
  });
});
