import { describe, expect, it } from 'vitest';
import fixture from '../packages/contracts/fixtures/opt-in.v2.json';
import {
  requestSignature,
  signedResponse,
  validateRequest,
  validateResponse,
} from './helpers/opt-in-contract';

const issuerNow = fixture.request.intent.issuedAt;
describe('P0 genuine issuer clock with signed skew boundaries', () => {
  it.each([-5000, 5000])('uses only signed issuer retention at client skew %s', (skew) => {
    const request = structuredClone(fixture.request);
    request.intent.issuedAt = issuerNow + skew;
    request.intent.expiresAt = request.intent.issuedAt + 60_000;
    const reservedAt = issuerNow + 1000;
    const admittedAt = issuerNow + 3000;
    const response = signedResponse(request.intent, admittedAt, reservedAt);
    expect(() => validateResponse(response, request.intent, admittedAt)).not.toThrow();
    expect(response.confirmation.retentionDeadline).toBe(reservedAt + 720 * 3600_000);
    expect(response.confirmation.retentionDeadline).not.toBe(
      request.intent.issuedAt + 720 * 3600_000
    );
    expect(
      signedResponse(request.intent, admittedAt + 1000, reservedAt).confirmation.retentionDeadline
    ).toBe(response.confirmation.retentionDeadline);
  });
  it('rejects issuer clock regression before the original reservation', () => {
    const response = signedResponse(fixture.request.intent, issuerNow, issuerNow + 1000);
    expect(() => validateResponse(response, fixture.request.intent, issuerNow)).toThrow();
  });
  it.each([-5000, 5000])('accepts client issuedAt skew %s without changing issuer time', (skew) => {
    const request = structuredClone(fixture.request);
    request.intent.issuedAt = issuerNow + skew;
    request.intent.expiresAt = request.intent.issuedAt + 60_000;
    expect(() =>
      validateRequest(request, issuerNow, requestSignature(request.intent))
    ).not.toThrow();
    const response = signedResponse(request.intent, issuerNow);
    expect(response.confirmation.admittedAt).toBe(issuerNow);
    expect(() => validateResponse(response, request.intent, issuerNow)).not.toThrow();
  });

  it('rejects future client time beyond allowed skew despite a valid request MAC', () => {
    const request = structuredClone(fixture.request);
    request.intent.issuedAt = issuerNow + 5001;
    request.intent.expiresAt = request.intent.issuedAt + 60_000;
    expect(() => validateRequest(request, issuerNow, requestSignature(request.intent))).toThrow();
    const response = signedResponse(request.intent, issuerNow);
    expect(() => validateResponse(response, request.intent, issuerNow)).toThrow();
  });

  it.each([-5001, 60_000])(
    'rejects correctly signed admission outside intent interval %s',
    (offset) => {
      const response = signedResponse(fixture.request.intent, issuerNow + offset);
      expect(() => validateResponse(response, fixture.request.intent, issuerNow)).toThrow();
    }
  );

  it('rejects a valid signed response at the original deadline without grace renewal', () => {
    const response = signedResponse(fixture.request.intent, issuerNow);
    expect(() => validateResponse(response, fixture.request.intent, issuerNow + 60_000)).toThrow();
  });

  it('allows a delayed genuine commit before expiry and rejects the same delay at expiry', () => {
    const request = structuredClone(fixture.request);
    const signature = requestSignature(request.intent);
    expect(() => validateRequest(request, issuerNow + 59_999, signature)).not.toThrow();
    const response = signedResponse(request.intent, issuerNow + 59_999);
    expect(() => validateResponse(response, request.intent, issuerNow + 59_999)).not.toThrow();
    expect(() => validateRequest(request, issuerNow + 60_000, signature)).toThrow();
    expect(() =>
      validateResponse(
        signedResponse(request.intent, issuerNow + 60_000),
        request.intent,
        issuerNow + 60_000
      )
    ).toThrow();
  });
});
