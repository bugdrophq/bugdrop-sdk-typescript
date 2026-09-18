import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { configuration } from '../packages/server/src/opt-in-config.js';
import { BugDropOptIn } from '../packages/server/src/opt-in.js';
import { fixture, options } from '../packages/server/test/opt-in-fixture.js';

const { root, keyId, authorization, requestSignature } = fixture.authentication;
const endpoint = fixture.request.intent.endpoint;
const intentDigest = fixture.intentDigest;

function auth(domain: string, id = keyId, key = root) {
  return createHmac('sha256', Buffer.from(key, 'base64url'))
    .update(`${domain}\0${id}`)
    .digest('base64url');
}

describe('V2 random-key derivation and purpose separation', () => {
  it('preserves the frozen authorization and complete request MAC vectors', () => {
    const config = configuration(options(vi.fn()));
    expect(config.authorization).toBe(authorization);
    expect(config.sign(endpoint, intentDigest)).toBe(requestSignature);
    expect(auth('bugdrop:auth:v2')).toBe(fixture.authentication.authSecret);
    expect(auth('bugdrop:auth:v1')).not.toBe(fixture.authentication.authSecret);
    expect(auth('bugdrop:intent-request:v2')).not.toBe(fixture.authentication.authSecret);
  });

  it.each(['keyId', 'root'] as const)('binds authorization and MAC to changed %s', (field) => {
    const changedId = field === 'keyId' ? Buffer.alloc(16, 42).toString('base64url') : keyId;
    const changedRoot = field === 'root' ? Buffer.alloc(32, 42).toString('base64url') : root;
    const config = configuration({
      ...options(vi.fn()),
      keyId: changedId,
      apiKey: `bd_api_v2.${changedId}.${changedRoot}`,
    });
    expect(config.authorization).toBe(
      `Bearer bd_auth_v2.${changedId}.${auth('bugdrop:auth:v2', changedId, changedRoot)}`
    );
    expect(config.authorization).not.toBe(authorization);
    expect(config.sign(endpoint, intentDigest)).not.toBe(requestSignature);
  });

  it('binds request MAC to endpoint and intent digest', () => {
    const config = configuration(options(vi.fn()));
    expect(config.sign(`${endpoint}/changed`, intentDigest)).not.toBe(requestSignature);
    expect(config.sign(endpoint, '0'.repeat(64))).not.toBe(requestSignature);
    const v1Secret = auth('bugdrop:auth:v1');
    expect(
      createHmac('sha256', Buffer.from(v1Secret, 'base64url'))
        .update(`bugdrop:intent-request:v2\0POST\0${endpoint}\0${intentDigest}`)
        .digest('base64url')
    ).not.toBe(requestSignature);
  });

  it.each([
    { keyId: Buffer.alloc(16, 42).toString('base64url') },
    { keyId: `${keyId}=` },
    { keyId: [keyId] },
    { apiKey: `bd_api_v1.${keyId}.${root}` },
    { apiKey: `bd_api_v2.${keyId}.${root}=` },
    { apiKey: `bd_api_v2.${keyId}.${Buffer.alloc(31).toString('base64url')}` },
    { apiKey: `bd_api_v2.${keyId}.${root}.extra` },
  ])('rejects mismatched or malformed credentials before dispatch %#', (change) => {
    const fetch = vi.fn();
    expect(() => new BugDropOptIn({ ...options(fetch), ...change } as never)).toThrow(
      expect.objectContaining({ code: 'rejected_before_send' })
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('canonical endpoint admission', () => {
  it.each(['?', '#', '?x=1', '#x'])('rejects suffix %s before authenticated dispatch', (suffix) => {
    const fetch = vi.fn();
    expect(() => new BugDropOptIn({ ...options(fetch), endpoint: endpoint + suffix })).toThrow(
      expect.objectContaining({ code: 'rejected_before_send' })
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('accepts the exact configured endpoint', () => {
    expect(configuration(options(vi.fn())).endpoint).toBe(endpoint);
  });
});
