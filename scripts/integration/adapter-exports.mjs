import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { build } from 'esbuild';

export async function checkAdapterExports(consumer) {
  const entry = join(consumer.directory, 'adapter-consumer.mjs');
  await writeFile(
    entry,
    "export * from '@bugdrop/server/adapter'; export * from '@bugdrop/server/node'; export { createAnonymousTokenProvider, createCustomerPolicyTokenProvider } from '@bugdrop/browser';"
  );
  const esm = await import(pathToFileURL(entry).href);
  const require = createRequire(entry);
  const cjs = {
    ...require('@bugdrop/server/adapter'),
    ...require('@bugdrop/server/node'),
    ...require('@bugdrop/browser'),
  };
  for (const module of [esm, cjs]) {
    assert.equal(typeof module.createCapabilityHandler, 'function');
    assert.equal(typeof module.createNodeCapabilityHandler, 'function');
    assert.equal(typeof module.createCustomerPolicyTokenProvider, 'function');
    const response = await module.createCapabilityHandler({
      mode: 'anonymous',
      origin: 'https://app.example.com',
    })(new Request('https://app.example.com'));
    assert.equal(response.status, 404);
  }
  for (const name of ['adapter', 'node']) {
    const result = await build({
      stdin: { contents: `import '@bugdrop/server/${name}';`, resolveDir: consumer.directory },
      platform: 'browser',
      bundle: true,
      write: false,
    });
    const source = result.outputFiles[0].text;
    assert.doesNotMatch(source, /node:crypto|bd_api_v1|bd_auth_v1|Authorization|OptIn/);
    assert.throws(() => new Function(source)(), /cannot be imported into browser code/);
  }
  const browser = await build({
    stdin: {
      contents:
        "import { createAnonymousTokenProvider } from '@bugdrop/browser'; globalThis.provider = createAnonymousTokenProvider;",
      resolveDir: consumer.directory,
    },
    platform: 'browser',
    bundle: true,
    write: false,
  });
  assert.doesNotMatch(
    browser.outputFiles[0].text,
    /node:crypto|bd_api_v1|bd_auth_v1|Authorization|server\/src/
  );
}
