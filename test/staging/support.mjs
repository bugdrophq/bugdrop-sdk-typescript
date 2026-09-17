export const target = {
  environment: 'staging',
  deploymentDigest: 'e'.repeat(64),
  repositoryId: '123456',
  accountId: 'a'.repeat(32),
  endpoint: 'https://staging.example.com/v1/submission-capabilities',
  origin: 'https://dogfood.example.com',
  serviceRevision: 'b'.repeat(40),
  githubApp: 'example/test-app',
  dogfoodRepository: 'example/dogfood',
};
export const configured = {
  BUGDROP_STAGING_TARGET: JSON.stringify(target),
  BUGDROP_STAGING_ADAPTER: '/not-installed/provider.mjs',
  BUGDROP_STAGING_ADAPTER_SHA256: 'c'.repeat(64),
  BUGDROP_STAGING_ORACLE: '/not-installed/oracle.mjs',
  BUGDROP_STAGING_ORACLE_SHA256: 'd'.repeat(64),
};
