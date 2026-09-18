// Contract model only. Actual handler/no-external-attempt qualification belongs to runtime.
import { createPublicKey, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import tokenFixture from '../packages/contracts/fixtures/opt-in-token.v2.json';
import confirmationFixture from '../packages/contracts/fixtures/opt-in.v2.json';
import { digest } from './helpers/opt-in-contract';

const key = createPublicKey({ key: tokenFixture.publicKey, format: 'jwk' });
const now = tokenFixture.claims.iat * 1000 + 1000;

function authenticatedV2(token: string) {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) throw new Error('reject');
  if (
    !verify(
      'sha256',
      Buffer.from(`${parts[0]}.${parts[1]}`),
      {
        key,
        dsaEncoding: 'ieee-p1363',
      },
      Buffer.from(parts[2], 'base64url')
    )
  )
    throw new Error('reject');
  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  // Fixed synthetic original authority; not a production token decoder.
  if (
    JSON.stringify(header) !== JSON.stringify(tokenFixture.header) ||
    JSON.stringify(claims) !== JSON.stringify(tokenFixture.claims)
  )
    throw new Error('reject');
  return { header, claims };
}

function gate(policy: string, state: string, commitment: string, active: boolean, clock: number) {
  const { header, claims } = authenticatedV2(tokenFixture.envelope.token);
  if (policy === 'v1-only' && header.typ !== 'bugdrop-local-capability-v1') return 'reject';
  if (policy === 'reject-managed') return 'reject';
  if (
    policy !== 'v2-ledger' ||
    state !== 'admitted' ||
    !active ||
    claims.iat * 1000 > clock ||
    claims.exp * 1000 <= clock ||
    commitment !== tokenFixture.capabilityDigest
  )
    return 'reject';
  return 'allow';
}

describe('P0 authenticated token isolation and route expectations', () => {
  it('pins a real signed V2 candidate with a separate synthetic key and exact commitment', () => {
    expect(authenticatedV2(tokenFixture.envelope.token).claims.protocolVersion).toBe(2);
    expect(tokenFixture.publicKey).not.toEqual(confirmationFixture.confirmationPublicKey);
    const e = tokenFixture.envelope;
    expect(digest('bugdrop:capability-envelope:v2', [1, e.token, e.expiresAt])).toBe(
      tokenFixture.capabilityDigest
    );
    expect(Date.parse(e.expiresAt)).toBe(tokenFixture.claims.exp * 1000);
    expect(tokenFixture.claims.jti).toBe(tokenFixture.claims.attemptId);
  });

  for (const route of tokenFixture.legacyRoutes) {
    it.each(tokenFixture.ledgerStates)(`${route.id} rejects %s V2 candidate`, (state) => {
      expect(gate(route.policy, state, tokenFixture.capabilityDigest, true, now)).toBe('reject');
    });
  }

  it.each(['reserved', 'failed-unconfirmed', 'missing', 'unavailable', 'purged'])(
    'upgraded verifier cannot accept %s ledger evidence',
    (state) => {
      expect(gate('v2-ledger', state, tokenFixture.capabilityDigest, true, now)).toBe('reject');
    }
  );

  it('requires committed matching evidence, fresh authority and strict token expiry', () => {
    expect(gate('v2-ledger', 'admitted', tokenFixture.capabilityDigest, true, now)).toBe('allow');
    expect(gate('v2-ledger', 'admitted', '0'.repeat(64), true, now)).toBe('reject');
    expect(gate('v2-ledger', 'admitted', tokenFixture.capabilityDigest, false, now)).toBe('reject');
    expect(
      gate(
        'v2-ledger',
        'admitted',
        tokenFixture.capabilityDigest,
        true,
        tokenFixture.claims.exp * 1000
      )
    ).toBe('reject');
  });

  it('cannot relabel the signed type as legacy without invalidating its signature', () => {
    const parts = tokenFixture.envelope.token.split('.');
    parts[0] = Buffer.from(
      JSON.stringify({ ...tokenFixture.header, typ: 'bugdrop-local-capability-v1' })
    ).toString('base64url');
    expect(() => authenticatedV2(parts.join('.'))).toThrow();
  });
});
