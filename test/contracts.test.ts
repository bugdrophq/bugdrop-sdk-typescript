import fixture from '../packages/contracts/fixtures/capability-response.v1.json';
import bindingFixture from '../packages/contracts/fixtures/submission-binding.v1.json';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  BUGDROP_CONTRACT_VERSION,
  parseSubmissionBinding,
  parseSubmissionCapability,
} from '../packages/contracts/src/index.js';

describe('capability contract v1', () => {
  it('accepts the shared compatibility fixture', () => {
    expect(parseSubmissionCapability(fixture)).toEqual(fixture);
    expect(BUGDROP_CONTRACT_VERSION).toBe(1);
  });

  it.each([
    null,
    {},
    { ...fixture, schemaVersion: 2 },
    { ...fixture, token: '' },
    { ...fixture, expiresAt: 'tomorrow' },
  ])('fails closed for malformed capabilities', (value) => {
    expect(() => parseSubmissionCapability(value)).toThrow('invalid capability response');
  });
});

describe('submission binding contract v1', () => {
  it('accepts the canonical shared binding', () => {
    expect(parseSubmissionBinding(bindingFixture.bound)).toEqual({
      submissionId: bindingFixture.bound.submissionId,
      payloadDigest: bindingFixture.bound.payloadDigest,
    });
    expect(digest(bindingFixture.requestBody)).toBe(bindingFixture.bound.payloadDigest);
  });

  it.each(bindingFixture.verificationCases)('$name', (verificationCase) => {
    const accepted =
      verificationCase.submissionId === bindingFixture.bound.submissionId &&
      digest(verificationCase.requestBody) === bindingFixture.bound.payloadDigest;
    expect(accepted).toBe(verificationCase.accepted);
  });

  it.each(bindingFixture.invalidPayloadDigests)(
    'rejects non-canonical payload digest %s',
    (payloadDigest) => {
      expect(() =>
        parseSubmissionBinding({
          submissionId: bindingFixture.bound.submissionId,
          payloadDigest,
        })
      ).toThrow('payloadDigest');
    }
  );

  it.each([undefined, '', '\ud800', 'é'.repeat(101)])(
    'rejects invalid submission ID %#',
    (submissionId) => {
      expect(() =>
        parseSubmissionBinding({
          submissionId,
          payloadDigest: bindingFixture.bound.payloadDigest,
        })
      ).toThrow('submissionId');
    }
  );

  it('rejects extra binding fields', () => {
    expect(() =>
      parseSubmissionBinding({ ...bindingFixture.bound, userId: 'customer-user-42' })
    ).toThrow('submission binding');
  });
});

function digest(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('base64url');
}
