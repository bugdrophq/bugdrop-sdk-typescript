import { describe, expect, it } from 'vitest';
import { createCapabilityHandler } from '@bugdrop/server/adapter';
import {
  body,
  denied,
  options,
  origin,
  path,
  request,
  upstream,
} from './helpers/adapter-fixture.js';

describe('strict adapter envelope', () => {
  it('rejects every altered routing/security header without exchange', async () => {
    const base = {
      Origin: origin,
      'Content-Type': 'application/json',
      'Sec-Fetch-Site': 'same-origin',
    };
    const patches = [
      { Origin: 'https://evil.example' },
      { 'Content-Type': 'application/json; charset=utf-8' },
      { 'Content-Encoding': 'identity' },
      { 'Sec-Fetch-Site': 'cross-site' },
      { Origin: origin + ', ' + origin },
      { 'Content-Length': '01' },
      { 'Content-Length': '1025' },
      { 'Content-Length': '1' },
    ];
    for (const patch of patches) {
      const fetch = upstream();
      await denied(
        await createCapabilityHandler(options(fetch))(
          request(body, { headers: { ...base, ...patch } })
        )
      );
      expect(fetch).not.toHaveBeenCalled();
    }
    for (const url of [
      origin + path.slice(0, -1),
      origin + path + '?q=1',
      origin + path + '#x',
      'https://evil.example' + path,
    ]) {
      await denied(await createCapabilityHandler(options())(request(body, {}, url)));
    }
    await denied(await createCapabilityHandler(options())(request(body, { method: 'PUT' })));
  });
  it('rejects duplicates, escaped duplicates, unknown fields, invalid IDs/digests and UTF8', async () => {
    const bodies: BodyInit[] = [
      body.replace('{', '{"submissionId":"duplicate",'),
      body.replace('{', '{"submiss\\u0069onId":"duplicate",'),
      body.replace('}', ',"userId":"secret"}'),
      '[]',
      'null',
      '{}',
      body.replace(/"submissionId":"[^"]*"/, '"submissionId":""'),
      body.replace(/"payloadDigest":"[^"]*"/, '"payloadDigest":"bad"'),
      body.replace(/"submissionId":"[^"]*"/, '"submissionId":"\\ud800"'),
      ' '.repeat(1025),
      new Uint8Array([0xff]),
      '\ufeff' + body,
    ];
    for (const content of bodies) {
      const fetch = upstream();
      await denied(await createCapabilityHandler(options(fetch))(request(content)));
      expect(fetch).not.toHaveBeenCalled();
    }
  });
  it('rejects consumed streams and pre-cancelled requests', async () => {
    const consumed = request();
    await consumed.text();
    await denied(await createCapabilityHandler(options())(consumed));
    const controller = new AbortController();
    controller.abort();
    const fetch = upstream();
    await denied(
      await createCapabilityHandler(options(fetch))(request(body, { signal: controller.signal }))
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});
