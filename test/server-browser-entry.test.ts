import { describe, expect, it } from 'vitest';

describe('@bugdrop/server browser condition', () => {
  it('fails clearly when the browser entry is imported', async () => {
    await expect(import('../packages/server/src/browser.js')).rejects.toThrow(
      '@bugdrop/server cannot be imported into browser code'
    );
  });
});
