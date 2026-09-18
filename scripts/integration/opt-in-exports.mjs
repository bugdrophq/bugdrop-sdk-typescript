import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createHash, createPrivateKey, sign } from 'node:crypto';
import { build } from 'esbuild';

// Runs for each implemented opt-in subpath, allowing isolated P1/P2 branches to
// share root integration checks without depending on each other's unmerged code.
export async function checkOptInExports(directory, repository) {
  const require = createRequire(join(directory, 'package.json'));
  for (const name of ['browser', 'server']) {
    const root = join(directory, 'node_modules/@bugdrop', name);
    const manifest = JSON.parse(await readFile(join(root, 'package.json')));
    if (!manifest.exports['./opt-in']) continue;
    const specifier = `@bugdrop/${name}/opt-in`;
    const entry = join(directory, `${name}-opt-in.mjs`);
    await writeFile(entry, `export { BugDropOptIn } from '${specifier}';\n`);
    const esm = (await import(pathToFileURL(entry).href)).BugDropOptIn;
    const cjs = require(specifier).BugDropOptIn;
    assert.equal(typeof esm, name === 'server' ? 'function' : typeof cjs);
    assert.equal(typeof cjs, typeof esm);
    for (const extension of ['d.ts', 'd.cts']) {
      assert.match(await readFile(join(root, `dist/opt-in.${extension}`), 'utf8'), /BugDropOptIn/);
    }
    const bundle = await build({
      stdin: {
        contents:
          name === 'server'
            ? `import '${specifier}';`
            : `import * as SDK from '${specifier}'; window.SDK = SDK;`,
        resolveDir: directory,
      },
      bundle: true,
      platform: 'browser',
      format: 'iife',
      write: false,
    });
    const text = bundle.outputFiles[0].text;
    assert.doesNotMatch(text, /node:crypto|bd_api_v[12]|bd_auth_v[12]|Authorization/);
    if (name === 'server') {
      assert.throws(() => new Function(text)(), /cannot be imported into browser code/);
      await serverExchange(repository, esm, cjs);
    } else assert.match(text, /BugDropOptIn/);
  }
}

async function serverExchange(repository, ...clients) {
  const fixtureRoot = join(repository, 'packages/contracts/fixtures');
  const fixture = JSON.parse(await readFile(join(fixtureRoot, 'opt-in.v2.json')));
  const catalog = JSON.parse(await readFile(join(fixtureRoot, 'opt-in-catalog.v2.json'))).catalog;
  const i = fixture.request.intent;
  const d = Buffer.alloc(32);
  d[31] = 1; // Public synthetic test scalar, not a service key.
  const key = createPrivateKey({
    key: { ...fixture.confirmationPublicKey, d: d.toString('base64url') },
    format: 'jwk',
  });
  const priorNow = Date.now;
  Date.now = () => i.issuedAt;
  try {
    for (const Client of clients) {
      let count = 0;
      const client = new Client({
        apiKey: `bd_api_v2.${fixture.authentication.keyId}.${fixture.authentication.root}`,
        ...Object.fromEntries(
          [
            'endpoint',
            'origin',
            'applicationId',
            'credentialId',
            'keyId',
            'installationGeneration',
            'deploymentDigest',
            'catalogDigest',
          ].map((k) => [k, i[k]])
        ),
        catalog,
        confirmationKeys: [
          { kid: fixture.response.confirmation.kid, publicKey: fixture.confirmationPublicKey },
        ],
        fetch: async (_url, init) => {
          count++;
          const intent = JSON.parse(init.body).intent;
          const tuple = Object.keys(i).map((k) =>
            k === 'normalizedVersions' ? Object.values(intent[k]) : intent[k]
          );
          const response = structuredClone(fixture.response);
          const c = response.confirmation;
          c.intentDigest = createHash('sha256')
            .update('bugdrop:metadata-intent:v2\0')
            .update(JSON.stringify(tuple))
            .digest('hex');
          const signed = [
            2,
            c.kid,
            c.intentDigest,
            c.capabilityDigest,
            c.reservedAt,
            c.retentionDeadline,
            c.admittedAt,
            c.expiresAt,
          ];
          c.signature = sign(
            'sha256',
            Buffer.from(`bugdrop:metadata-confirmation:v2\0${JSON.stringify(signed)}`),
            { key, dsaEncoding: 'ieee-p1363' }
          ).toString('base64url');
          return new Response(JSON.stringify(response), {
            headers: {
              'Content-Type': 'application/vnd.bugdrop.submission-capability.v2+json',
              'Cache-Control': 'no-store',
            },
          });
        },
      });
      assert.deepEqual(
        await client.createSubmissionCapability(
          { submissionId: i.submissionId, payloadDigest: i.payloadDigest },
          { metadataVersion: 1, browserSdkVersion: i.browserSdkVersion }
        ),
        fixture.response.capability
      );
      assert.equal(count, 1);
    }
  } finally {
    Date.now = priorNow;
  }
}
