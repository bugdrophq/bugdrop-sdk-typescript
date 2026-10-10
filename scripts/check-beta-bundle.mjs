import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

if (!process.argv[2]) throw new Error('Pass the beta bundle directory');
const source = resolve(process.argv[2]);
const manifest = JSON.parse(await readFile(join(source, 'provenance.json'), 'utf8'));
assert.equal(manifest.schemaVersion, 1);
assert.match(manifest.sourceCommit, /^[a-f0-9]{40}$/);
const files = Object.keys(manifest.sha256);
const required = [
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'README.md',
  ...['browser', 'server', 'handler', 'transport'].map((name) => `src/${name}.ts`),
];
assert.equal(files.length, required.length + 2, 'Incomplete artifact manifest');
for (const file of required) assert.ok(files.includes(file), `Missing artifact: ${file}`);
for (const name of ['browser', 'server']) {
  assert.equal(
    files.filter((file) => file.startsWith(`vendor/bugdrop-${name}-`) && file.endsWith('.tgz'))
      .length,
    1
  );
}
for (const [file, expected] of Object.entries(manifest.sha256)) {
  assert.match(
    file,
    /^(vendor\/[^/]+\.tgz|src\/(browser|server|handler|transport)\.ts|package(-lock)?\.json|tsconfig\.json|README\.md)$/
  );
  const actual = createHash('sha256')
    .update(await readFile(join(source, file)))
    .digest('hex');
  assert.equal(actual, expected, `Artifact checksum mismatch: ${file}`);
}
const directory = await mkdtemp(join(tmpdir(), 'bugdrop-beta-check-'));
const run = (args) => execFileSync('npm', args, { cwd: directory, stdio: 'pipe' });
try {
  await mkdir(join(directory, 'src'));
  await mkdir(join(directory, 'vendor'));
  for (const file of files) await cp(join(source, file), join(directory, file));
  run(['ci', '--ignore-scripts', '--no-audit', '--no-fund']);
  run(['run', 'build']);
  const browser = await readFile(join(directory, 'dist/browser.js'), 'utf8');
  assert.doesNotMatch(browser, /bd_api_v1|bd_auth_v1|node:crypto|Authorization|apiKey/);
  await build({
    entryPoints: [join(directory, 'src/server.ts')],
    outfile: join(directory, 'server.mjs'),
    bundle: true,
    packages: 'external',
    platform: 'node',
    format: 'esm',
  });
  const { capabilityEndpoint } = await import(pathToFileURL(join(directory, 'server.mjs')).href);
  const repository = resolve(import.meta.dirname, '..');
  const credential = JSON.parse(
    await readFile(join(repository, 'packages/contracts/fixtures/api-key-credential.v1.json'))
  );
  const { bound } = JSON.parse(
    await readFile(join(repository, 'packages/contracts/fixtures/submission-binding.v1.json'))
  );
  let calls = 0;
  let allowed = false;
  let mode = 'ok';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    calls++;
    assert.equal(init.headers.Authorization, credential.authorization);
    assert.deepEqual(JSON.parse(init.body), {
      schemaVersion: 1,
      ...bound,
      origin: 'https://customer.example',
    });
    if (mode === 'revoked') return new Response('private upstream reason', { status: 403 });
    if (mode === 'lost') throw new Error('private network details');
    return Response.json({
      schemaVersion: 1,
      token: 'opaque-fixture-token',
      expiresAt: new Date(Date.now() + 240000).toISOString(),
    });
  };
  try {
    const handle = capabilityEndpoint(
      {
        apiKey: credential.apiKey,
        origin: 'https://customer.example',
        endpoint: 'https://issuer.example/v1/submission-capabilities',
      },
      (_request, binding) =>
        allowed &&
        binding.submissionId === bound.submissionId &&
        binding.payloadDigest === bound.payloadDigest
    );
    const request = (binding = bound, origin = 'https://customer.example') =>
      new Request('https://customer.example/api/bugdrop-capability/v1', {
        method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/json' },
        body: JSON.stringify(binding),
      });
    assert.equal((await handle(request())).status, 502);
    assert.equal(calls, 0);
    allowed = true;
    assert.equal((await handle(request(bound, 'https://attacker.example'))).status, 502);
    assert.equal((await handle(request({ ...bound, payloadDigest: 'A'.repeat(43) }))).status, 502);
    assert.equal(calls, 0);
    assert.equal((await handle(request())).status, 200);
    for (mode of ['revoked', 'lost']) {
      const before = calls;
      const response = await handle(request());
      assert.equal(response.status, 502);
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
      assert.deepEqual(await response.json(), { error: 'unable_to_authorize_bugdrop' });
      assert.equal(calls, before + 1, 'No automatic retry after uncertain response');
    }
    mode = 'ok';
    assert.equal((await handle(request())).status, 200, 'Explicit same-binding retry');
  } finally {
    globalThis.fetch = originalFetch;
  }
  process.stdout.write(
    `Fresh packed beta consumer passed for ${manifest.sourceCommit}. Hosted acceptance was not run.\n`
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
