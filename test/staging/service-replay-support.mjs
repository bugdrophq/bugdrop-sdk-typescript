import { randomUUID } from 'node:crypto';

// Synthetic service model for testing the harness assertions, never hosted service proof.
export function serviceReplayFixture(fixtures, sdkVersion, fault, faultScenario = 'delivered') {
  let active;
  const closed = [];
  const hasFault = (name) =>
    fault === name && (active.uncertain ? 'indeterminate' : 'delivered') === faultScenario;
  class BugDrop {
    async createSubmissionToken(binding) {
      if (fixtures.origin.invalid.includes(binding.origin)) throw new Error('invalid origin');
      if (active.blocked || binding.origin !== active.origin)
        throw Object.assign(new Error('denied'), { code: 'request_failed' });
      const token = hasFault('duplicateToken') ? 'fixed-test-token' : randomUUID();
      active.tokens.add(token);
      active.minted.push(token);
      active.sdkVersions.push(sdkVersion);
      active.evidenceRequests.push({
        body: sdkVersion,
        unexpectedHeaders: false,
        unexpectedUrl: false,
        headers: {
          'content-length': String(Buffer.byteLength(sdkVersion)),
          'content-type': 'text/plain;charset=UTF-8',
          host: 'evidence.bugdrop.localhost',
        },
      });
      return { schemaVersion: 1, token, expiresAt: new Date(Date.now() + 60_000).toISOString() };
    }
  }
  async function start() {
    const state = (active = {
      origin: 'https://example.com',
      blocked: false,
      tokens: new Set(),
      consumed: new Set(),
      minted: [],
      sdkVersions: [],
      evidenceRequests: [],
      outcomes: [],
      submissionResponses: [],
      attempts: 0,
      uncertain: false,
      replacementWaiters: [],
    });
    return {
      endpoint: 'http://service.bugdrop.localhost',
      origin: state.origin,
      async submit({ capability, binding, requestBody }) {
        const fixture = fixtures['submission-binding'];
        const used = state.consumed.has(capability.token);
        const valid =
          !state.blocked &&
          state.tokens.has(capability.token) &&
          binding.submissionId === fixture.bound.submissionId &&
          binding.payloadDigest === fixture.bound.payloadDigest &&
          requestBody === fixture.requestBody;
        const replacement = valid && !used && state.attempts > 0;
        let outcome = 'rejected';
        if (valid && (!used || hasFault('replaySuccess'))) {
          if (!used) {
            if (!(replacement && hasFault('replacementReplaySuccess')))
              state.consumed.add(capability.token);
            if (!state.attempts || hasFault('duplicateAttempt')) state.attempts++;
          }
          outcome = state.uncertain ? 'indeterminate' : 'delivered';
        }
        const response = { schemaVersion: 1, outcome };
        state.outcomes.push(response);
        state.submissionResponses.push(JSON.stringify(response));
        if (replacement && state.replacementWaiters.length < 2) {
          return new Promise((resolve) => {
            state.replacementWaiters.push(() => resolve(response));
            if (state.replacementWaiters.length === 2)
              state.replacementWaiters.forEach((finish) => finish());
          });
        }
        return response;
      },
      revoke() {
        state.blocked = true;
      },
      expireAuthorizationState() {
        state.blocked = true;
      },
      setDeliveryIndeterminate() {
        state.uncertain = true;
      },
      async evidence() {
        return {
          attempts: state.attempts,
          sdkVersions: state.sdkVersions,
          evidenceRequests: state.evidenceRequests,
          outcomes: state.outcomes,
          submissionResponses: state.submissionResponses,
          ...(hasFault('leakReplacement') ? { leaked: state.minted[1] } : {}),
        };
      },
      async close() {
        closed.push(state);
      },
    };
  }
  return { start, BugDrop, closed };
}
