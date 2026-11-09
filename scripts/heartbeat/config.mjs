export const WIDGET_HELPER_COMMIT = '92dc85d8695d0c0be69af8110081ba9d48b0088a';
export const TITLE_PREFIX = '[BugDrop production heartbeat]';
const fields = [
  'fixtureOrigin',
  'applicationId',
  'widgetUrl',
  'issuerUrl',
  'submissionUrl',
  'repository',
  'author',
  'labels',
  'sdkCommit',
  'fixtureBundleSha256',
  'widgetSha256',
];

export function readConfiguration(env) {
  if (env.BUGDROP_SDK_HEARTBEAT_ENABLED !== '1') return null;
  const target = JSON.parse(env.BUGDROP_SDK_HEARTBEAT_TARGET || 'null');
  if (!target || Object.keys(target).sort().join() !== [...fields].sort().join())
    throw new Error('Invalid target');
  for (const field of ['fixtureOrigin', 'widgetUrl', 'issuerUrl', 'submissionUrl']) {
    const url = new URL(target[field]);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.href !== target[field] && field !== 'fixtureOrigin')
    )
      throw new Error('Invalid HTTPS target');
    if (field === 'fixtureOrigin' && url.origin !== target[field])
      throw new Error('Invalid fixture origin');
  }
  // Explicitly exclude real pilot apps and the historical lifecycle fixture.
  if (
    ['foil.neonwatty.com', 'debtisfun.com', 'sdk-fixture-staging.bugdrop.dev'].includes(
      new URL(target.fixtureOrigin).hostname
    )
  )
    throw new Error('Dedicated fixture required');
  if (target.issuerUrl !== 'https://managed.bugdrop.dev/v1/submission-capabilities')
    throw new Error('Public managed transport required');
  const widgetOrigin = new URL(target.widgetUrl).origin;
  if (
    !['https://widget.bugdrop.dev', 'https://delivery.bugdrop.dev'].includes(widgetOrigin) ||
    target.submissionUrl !== `${widgetOrigin}/v1/submissions`
  )
    throw new Error('Managed submission endpoint must match script origin');
  if (
    !/^[A-Za-z0-9_-]{3,100}$/.test(target.applicationId) ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(target.repository)
  )
    throw new Error('Invalid scope');
  if (
    ['usefoil/foil-web', 'grumpy-pig/debtisfun'].includes(target.repository.toLowerCase()) ||
    target.repository.toLowerCase() === 'bugdrophq/bugdrop-sdk-typescript'
  )
    throw new Error('Dedicated issue repository required');
  if (
    !/^[a-f0-9]{40}$/.test(target.sdkCommit) ||
    !/^[a-f0-9]{64}$/.test(target.fixtureBundleSha256) ||
    !/^[a-f0-9]{64}$/.test(target.widgetSha256)
  )
    throw new Error('Artifact identities required');
  if (
    !/^[A-Za-z0-9-]+(?:\[bot\])?$/.test(target.author) ||
    !Array.isArray(target.labels) ||
    !target.labels.length ||
    target.labels.some((label) => typeof label !== 'string' || !label)
  )
    throw new Error('Issue identity required');
  for (const key of ['BUGDROP_SDK_FIXTURE_PASSWORD', 'MONITOR_SDK_HEARTBEAT_SECRET']) {
    if (!env[key] || env[key].length < 32) throw new Error('Monitoring credentials missing');
  }
  if (
    !/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID || '') ||
    !/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ATTEMPT || '')
  )
    throw new Error('Run identity missing');
  return {
    ...target,
    marker: `bugdrop-production-heartbeat:${env.GITHUB_RUN_ID}:${env.GITHUB_RUN_ATTEMPT}:${target.sdkCommit}`,
  };
}

export function profileEnvironment(target) {
  return {
    BUGDROP_CANARY_REPO: target.repository,
    PLAYWRIGHT_BASE_URL: target.fixtureOrigin,
    EXPECTED_WIDGET_ORIGIN: new URL(target.widgetUrl).origin,
    BUGDROP_CANARY_EXPECTED_AUTHOR: target.author,
    BUGDROP_CANARY_EXPECTED_LABELS_JSON: JSON.stringify(target.labels),
  };
}
