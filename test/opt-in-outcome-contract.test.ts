import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import fixture from '../packages/contracts/fixtures/opt-in.v2.json';
import outcome from '../packages/contracts/fixtures/opt-in-outcome.v2.json';

describe('P0 synthetic projection and credential-domain vectors', () => {
  it('preserves the four admitted values in the17-input command and14-column row', () => {
    const v = fixture.request.intent.normalizedVersions;
    const tuple = [v.sdkVersion, v.browserSdkVersion, v.widgetVersion, v.protocolVersion];
    expect(outcome.command.arguments).toHaveLength(17);
    expect(outcome.command.arguments.slice(13)).toEqual(tuple);
    expect(outcome.activityColumns).toHaveLength(14);
    expect(Object.keys(outcome.activityRow)).toEqual(outcome.activityColumns);
    const row = outcome.activityRow;
    expect([
      row.sdk_version,
      row.browser_sdk_version,
      row.widget_version,
      row.protocol_version,
    ]).toEqual(tuple);
    expect(Date.parse(row.accepted_at)).toBeGreaterThan(fixture.response.confirmation.admittedAt);
    expect(Date.parse(row.occurred_at)).toBeGreaterThan(Date.parse(row.accepted_at));
    expect(outcome.command.arguments.slice(7, 9)).toEqual([row.accepted_at, row.occurred_at]);
  });

  it('does not derive the V1 secret by relabeling the V2 credential prefix', () => {
    const auth = fixture.authentication;
    const legacySecret = createHmac('sha256', Buffer.from(auth.root, 'base64url'))
      .update(`bugdrop:auth:v1\0${auth.keyId}`)
      .digest('base64url');
    expect(legacySecret).not.toBe(auth.authSecret);
    // Domain separation alone is insufficient: issuer record mode enforcement remains required.
  });
});
