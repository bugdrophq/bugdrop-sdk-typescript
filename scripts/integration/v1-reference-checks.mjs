import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { startTransportFixture } from './transport-fixture.mjs';

export async function checkV1Reference(repository, consumer, fixtures) {
  const compiled = [];
  for (const name of ['handler', 'transport']) {
    const outfile = join(consumer.directory, `v1-${name}.mjs`);
    await build({
      entryPoints: [join(repository, `examples/v1-backend/${name}.ts`)],
      outfile,
      bundle: true,
      platform: name === 'handler' ? 'node' : 'browser',
      format: 'esm',
      external: name === 'handler' ? ['@bugdrop/server'] : [],
    });
    compiled.push(outfile);
  }
  const { createV1Handler } = await import(pathToFileURL(compiled[0]).href);
  const { createV1TokenProvider } = await import(pathToFileURL(compiled[1]).href);
  const service = await startTransportFixture();
  const credential = fixtures['api-key-credential'];
  const binding = fixtures['submission-binding'].bound;
  const origin = 'https://app.example.com';
  const previousFetch = globalThis.fetch;
  const previousLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
  try {
    service.respond({
      ...fixtures['capability-response'],
      expiresAt: new Date(Date.now() + 240_000).toISOString(),
    });
    const handler = createV1Handler(
      {
        apiKey: credential.apiKey,
        origin,
        endpoint: service.endpoint,
        fetch: previousFetch,
      },
      (request) => request.headers.get('X-BugDrop-CSRF-Token') === 'local-csrf'
    );
    const browserRequests = [];
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: { protocol: 'https:', origin },
    });
    globalThis.fetch = async (target, init) => {
      browserRequests.push({ target, init });
      return handler(
        new Request(target, {
          method: init.method,
          body: init.body,
          headers: { ...init.headers, Origin: origin },
        })
      );
    };
    const result = await createV1TokenProvider(() => 'local-csrf')(binding);
    assert.equal(result.token, fixtures['capability-response'].token);
    assert.equal(browserRequests.length, 1);
    assert.equal(browserRequests[0].target, `${origin}/api/bugdrop-capability/v1`);
    assert.equal(browserRequests[0].init.redirect, 'error');
    assert.equal(browserRequests[0].init.credentials, 'same-origin');
    assert.equal(service.requests.length, 1);
    assert.deepEqual(JSON.parse(service.requests[0].body), {
      schemaVersion: 1,
      ...binding,
      origin,
    });
    assert.equal(service.requests[0].headers.authorization, credential.authorization);
    assert.ok(!JSON.stringify(browserRequests).includes(credential.apiKey));
    assert.ok(!service.requests[0].body.includes(credential.apiKey));

    const before = service.requests.length;
    const invalid = new Request(`${origin}/api/bugdrop-capability/v1`, {
      method: 'POST',
      headers: { Origin: 'https://attacker.example', 'Content-Type': 'application/json' },
      body: JSON.stringify(binding),
    });
    assert.equal((await handler(invalid)).status, 502);
    assert.equal(service.requests.length, before);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousLocation) Object.defineProperty(globalThis, 'location', previousLocation);
    else Reflect.deleteProperty(globalThis, 'location');
    await service.close();
  }
}
