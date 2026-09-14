import { describe, expect, it } from 'vitest';
import { BugDrop } from '../packages/browser/src/index.js';

describe('@bugdrop/browser runtime boundary', () => {
  it('cannot initialize outside a browser', () => {
    expect(() =>
      BugDrop.init({ applicationId: 'app_public_123', tokenProvider: async () => null as never })
    ).toThrow('must be initialized in a browser');
  });
});
