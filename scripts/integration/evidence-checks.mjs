import assert from 'node:assert/strict';

export function assertPrivateEvidence(evidence, fixtures, capability, sdkVersion) {
  const serialized = JSON.stringify(evidence);
  const credential = fixtures['api-key-credential'];
  for (const canary of [
    credential.apiKey,
    credential.rootSecret,
    credential.authorization,
    credential.authSecret,
    capability.token,
    fixtures['submission-binding'].requestBody,
    fixtures['submission-binding'].bound.submissionId,
    'Save failed',
    '/settings',
    'identity-canary',
  ]) {
    assert.ok(!serialized.includes(canary), 'Service evidence leaked a private canary');
  }
  const { evidenceRequests, submissionResponses, ...telemetry } = evidence;
  assert.ok(Array.isArray(evidenceRequests), 'Missing actual telemetry request observations');
  assert.ok(Array.isArray(submissionResponses), 'Missing actual submission response observations');
  for (const request of evidenceRequests) {
    // These are test-owned observations of the actual sink request, not stored telemetry fields.
    assert.deepEqual(request, {
      body: sdkVersion,
      headers: {
        'content-length': String(Buffer.byteLength(sdkVersion)),
        'content-type': 'text/plain;charset=UTF-8',
        host: 'evidence.bugdrop.localhost',
      },
    });
  }
  assert.equal(submissionResponses.length, evidence.outcomes.length);
  for (const [index, response] of submissionResponses.entries()) {
    assert.equal(typeof response, 'string');
    const parsed = JSON.parse(response);
    assert.deepEqual(Object.keys(parsed).sort(), ['outcome', 'schemaVersion']);
    assert.equal(parsed.schemaVersion, 1);
    assert.ok(
      ['delivered', 'delivering', 'indeterminate', 'failed_before_delivery', 'rejected'].includes(
        parsed.outcome
      )
    );
    assert.deepEqual(
      parsed,
      evidence.outcomes[index],
      'Adapter normalization concealed the actual outcome'
    );
  }
  assert.doesNotMatch(
    JSON.stringify(telemetry),
    /"(?:userId|subject|reporterId|pseudonym|headers|payload|requestBody)"\s*:/
  );
}

export function checkEvidenceAssertions(fixtures, sdkVersion) {
  const capability = { token: 'private-capability-canary' };
  const safe = {
    outcomes: [{ schemaVersion: 1, outcome: 'indeterminate' }],
    submissionResponses: ['{"schemaVersion":1,"outcome":"indeterminate"}'],
    evidenceRequests: [
      {
        body: sdkVersion,
        headers: {
          'content-length': String(Buffer.byteLength(sdkVersion)),
          'content-type': 'text/plain;charset=UTF-8',
          host: 'evidence.bugdrop.localhost',
        },
      },
    ],
    logs: [],
  };
  assertPrivateEvidence(safe, fixtures, capability, sdkVersion);
  for (const mutate of [
    (value) => {
      value.evidenceRequests[0].headers.authorization = 'unknown-secret';
    },
    (value) => {
      value.evidenceRequests[0].body = 'unknown-report';
    },
    (value) => {
      value.submissionResponses[0] = '{"schemaVersion":1,"outcome":"delivered"}';
    },
    (value) => {
      value.submissionResponses[0] =
        '{"schemaVersion":1,"outcome":"indeterminate","report":"unknown-report"}';
    },
    (value) => {
      value.logs.push({ headers: { arbitrary: 'unknown-secret' } });
    },
    (value) => {
      value.logs.push(capability.token);
    },
  ]) {
    const poisoned = structuredClone(safe);
    mutate(poisoned);
    assert.throws(() => assertPrivateEvidence(poisoned, fixtures, capability, sdkVersion));
  }
}
