import fixture from '../packages/contracts/fixtures/api-key-credential.v1.json';
import { describe, expect, it } from 'vitest';
import { createApiKeyStrategy } from '../packages/server/src/api-key.js';

const request = {
  method: 'POST' as const,
  url: 'https://bugdrop.example/v1/submission-capabilities',
  body: '{"schemaVersion":1}',
};
const rotatedApiKey =
  'bd_api_v1.AAECAwQFBgcICQoLDA0ODw.MDEyMzQ1Njc4OTo7PD0-P0BBQkNERUZHSElKS0xNTk8';

describe('V1 API-key strategy', () => {
  it('matches the shared authentication and subject vector', async () => {
    const identity = createApiKeyStrategy(fixture.apiKey).prepareIdentity(fixture.subject);
    expect(identity.wireSubject).toBe(fixture.pseudonym);
    await expect(identity.authenticateRequest(request)).resolves.toEqual({
      Authorization: fixture.authorization,
    });
  });

  it('keeps a subject stable within one key epoch and resets it on rotation', () => {
    const strategy = createApiKeyStrategy(fixture.apiKey);
    expect(strategy.prepareIdentity(fixture.subject).wireSubject).toBe(
      strategy.prepareIdentity(fixture.subject).wireSubject
    );
    expect(strategy.prepareIdentity('another-user').wireSubject).not.toBe(fixture.pseudonym);
    expect(
      createApiKeyStrategy(rotatedApiKey).prepareIdentity(fixture.subject).wireSubject
    ).not.toBe(fixture.pseudonym);
  });

  it.each([
    undefined,
    '',
    ` ${fixture.apiKey}`,
    fixture.apiKey.replace('bd_api_v1', 'bd_api_v2'),
    `${fixture.apiKey}.extra`,
    fixture.apiKey.replace('AAECAwQFBgcICQoLDA0ODw', 'AAECAwQFBgcICQoLDA0OD!'),
    fixture.apiKey.slice(0, -1),
  ])('rejects malformed API key %# without echoing it', (apiKey) => {
    expect(() => createApiKeyStrategy(apiKey)).toThrow('valid API key');
    try {
      createApiKeyStrategy(apiKey);
    } catch (error) {
      if (apiKey) expect(String(error)).not.toContain(apiKey);
    }
  });

  it('enforces exact UTF-8 byte limits without normalization', () => {
    const strategy = createApiKeyStrategy(fixture.apiKey);
    expect(strategy.prepareIdentity('é'.repeat(512)).wireSubject).toMatch(/^bdsub_v1_/);
    expect(() => strategy.prepareIdentity('é'.repeat(512) + 'a')).toThrow('subject');
    expect(() => strategy.prepareIdentity('')).toThrow('subject');
    expect(() => strategy.prepareIdentity('\ud800')).toThrow('subject');
    expect(strategy.prepareIdentity('é').wireSubject).not.toBe(
      strategy.prepareIdentity('e\u0301').wireSubject
    );
  });
});
