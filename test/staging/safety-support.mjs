import { target } from './support.mjs';

export const runId = 'ad51c858-77ce-4ba2-b806-8fbf07924ace';
export const contract = { version: 2, sdkVersion: '0.1.0' };
export const scenarios = [
  'duplicate-concurrent',
  'timeout-after-dispatch',
  'restart-after-dispatch',
  'stale-authorization',
  'substitute-tenantId',
  'substitute-applicationId',
  'substitute-destinationId',
  'origin-aliases',
  'revoke-credential',
  'revoke-application',
  'revoke-tenant',
  'retention-deletion',
  'uninstall',
];

export function context(BugDrop = class {}) {
  const service = {
    endpoint: target.endpoint,
    origin: target.origin,
    closed: 0,
    resolveApiKey: async () => 'bd_api_v1.test.test',
    secretMarkers: async () => ['provider-secret-canary'],
    readExchangeCount: async () => snapshot(),
    injectFault() {},
    restart() {},
    waitForDispatch() {},
    expireAuthorization() {},
    substituteTrustedContext() {},
    revoke() {},
    seedRetentionFixtures() {},
    runNativeRetentionAlarm() {},
    readRetentionFixtures() {},
    uninstallApprovedInstallation() {},
    waitForSignedUninstall() {},
    evidence() {
      return { closed: this.closed, exchanges: [] };
    },
    submit(input) {
      this.input = input;
      return { schemaVersion: 1, outcome: 'rejected' };
    },
    close() {
      this.closed++;
    },
  };
  return {
    service,
    target,
    runId,
    consumer: { BugDrop, versions: { server: '0.1.0' } },
    provider: {
      async startSafetyScenario() {
        return service;
      },
    },
    fixtures: { 'api-key-credential': { apiKey: 'fixture-key' } },
  };
}

export function snapshot(count = 1) {
  return {
    runId,
    scenario: 'origin-aliases',
    applicationId: target.applicationId,
    count,
    complete: true,
    exclusive: true,
  };
}

export function completedResults() {
  return scenarios.map((scenario) => ({
    scenario,
    passed: true,
    ...(scenario === 'origin-aliases'
      ? {
          originChecks: Array.from({ length: 5 }, (_, index) => ({
            index,
            outcome: index === 4 ? 'http_denied' : 'client_validation_rejected',
            networkAttempts: index === 4 ? 1 : 0,
            before: snapshot(),
            after: snapshot(index === 4 ? 2 : 1),
          })),
        }
      : {}),
  }));
}
