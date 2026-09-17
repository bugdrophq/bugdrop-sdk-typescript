import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readConfiguration, inputNames } from '../../scripts/staging/config.mjs';

import { target, configured } from './support.mjs';

test('missing staging is a failure state with names only, never a pass', () => {
  assert.deepEqual(readConfiguration({}), {
    status: 'staging_not_configured',
    missing: inputNames,
  });
  assert.equal(readConfiguration(configured).status, 'configured');
});
test('reject ambiguous/production/aliased configuration without reflecting values', () => {
  for (const change of [
    { environment: 'production' },
    { endpoint: 'https://api.bugdrop.dev/v1/submission-capabilities' },
    { origin: 'https://dogfood.example.com.' },
    { origin: 'https://DOGFOOD.example.com' },
    { endpoint: 'https://user:secret@staging.example.com/v1/submission-capabilities' },
    { endpoint: 'https://staging.example.com/v1/submission-capabilities?token=secret' },
    { endpoint: 'http://staging.example.com/v1/submission-capabilities' },
    { serviceRevision: 'latest' },
    { accountId: 'unspecified' },
    { apiKey: 'secret-canary' },
  ]) {
    assert.deepEqual(
      readConfiguration({
        ...configured,
        BUGDROP_STAGING_TARGET: JSON.stringify({ ...target, ...change }),
      }),
      { status: 'staging_invalid_configuration' }
    );
  }
  assert.deepEqual(readConfiguration({ ...configured, BUGDROP_STAGING_ADAPTER: './local.mjs' }), {
    status: 'staging_invalid_configuration',
  });
});
