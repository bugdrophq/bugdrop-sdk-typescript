import fixture from '../packages/contracts/fixtures/capability-response.v1.json';
import { describe, expect, it } from 'vitest';
import {
  BUGDROP_CONTRACT_VERSION,
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
