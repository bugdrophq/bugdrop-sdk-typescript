import { isAbsolute } from 'node:path';
import { isIP } from 'node:net';

export const inputNames = [
  'BUGDROP_STAGING_TARGET',
  'BUGDROP_STAGING_ADAPTER',
  'BUGDROP_STAGING_ADAPTER_SHA256',
  'BUGDROP_STAGING_ORACLE',
  'BUGDROP_STAGING_ORACLE_SHA256',
  'BUGDROP_STAGING_SAFETY_RUNNER',
  'BUGDROP_STAGING_SAFETY_RUNNER_SHA256',
];

export function readConfiguration(env) {
  const missing = inputNames.filter((name) => !env[name]);
  if (missing.length) return { status: 'staging_not_configured', missing };
  try {
    const target = JSON.parse(env.BUGDROP_STAGING_TARGET);
    const keys = [
      'environment',
      'applicationId',
      'accountId',
      'endpoint',
      'origin',
      'serviceRevision',
      'githubApp',
      'dogfoodRepository',
      'deploymentDigest',
      'repositoryId',
    ];
    if (!target || Object.keys(target).sort().join() !== keys.sort().join()) throw new Error();
    if (
      target.environment !== 'staging' ||
      typeof target.applicationId !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,100}$/.test(target.applicationId) ||
      target.applicationId === 'UNAPPROVED' ||
      !/^[a-f0-9]{32}$/.test(target.accountId) ||
      !/^[a-f0-9]{40}$/.test(target.serviceRevision) ||
      !/^[a-f0-9]{64}$/.test(target.deploymentDigest) ||
      typeof target.repositoryId !== 'string' ||
      !/^[1-9][0-9]*$/.test(target.repositoryId)
    )
      throw new Error();
    for (const key of ['githubApp', 'dogfoodRepository']) {
      if (typeof target[key] !== 'string' || !/^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(target[key]))
        throw new Error();
    }
    const endpoint = new URL(target.endpoint);
    const origin = new URL(target.origin);
    for (const url of [endpoint, origin]) {
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        url.hostname.endsWith('.') ||
        url.hostname.endsWith('.localhost') ||
        url.hostname === 'localhost' ||
        isIP(url.hostname.replace(/^\[|\]$/g, ''))
      )
        throw new Error();
    }
    if (
      endpoint.href !== target.endpoint ||
      endpoint.pathname !== '/v1/submission-capabilities' ||
      origin.origin !== target.origin ||
      ['api.bugdrop.dev', 'widget.bugdrop.dev'].includes(endpoint.hostname)
    )
      throw new Error();
    for (const kind of ['ADAPTER', 'ORACLE', 'SAFETY_RUNNER']) {
      if (
        !isAbsolute(env[`BUGDROP_STAGING_${kind}`]) ||
        !/^[a-f0-9]{64}$/.test(env[`BUGDROP_STAGING_${kind}_SHA256`])
      )
        throw new Error();
    }
    return {
      status: 'configured',
      target,
      adapter: env.BUGDROP_STAGING_ADAPTER,
      adapterDigest: env.BUGDROP_STAGING_ADAPTER_SHA256,
      oracle: env.BUGDROP_STAGING_ORACLE,
      oracleDigest: env.BUGDROP_STAGING_ORACLE_SHA256,
      safetyRunner: env.BUGDROP_STAGING_SAFETY_RUNNER,
      safetyRunnerDigest: env.BUGDROP_STAGING_SAFETY_RUNNER_SHA256,
    };
  } catch {
    return { status: 'staging_invalid_configuration' };
  }
}
