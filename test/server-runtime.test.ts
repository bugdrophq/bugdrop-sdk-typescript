// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

describe('@bugdrop/server runtime boundary', () => {
  it('fails at module import in a browser runtime', async () => {
    await expect(import('../packages/server/src/index.js')).rejects.toThrow(
      '@bugdrop/server cannot be imported into browser code'
    );
  });
});
