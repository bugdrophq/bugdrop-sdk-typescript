import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';

const repositoryRoot = resolve(import.meta.dirname, '..');
const browserPackageRoot = resolve(repositoryRoot, 'packages/browser');
const packageJson = JSON.parse(await readFile(resolve(browserPackageRoot, 'package.json'), 'utf8'));
const distFiles = await readdir(resolve(browserPackageRoot, 'dist'));
const builtText = (
  await Promise.all(
    distFiles.map((file) => readFile(resolve(browserPackageRoot, 'dist', file), 'utf8'))
  )
).join('\n');

const forbidden = [
  '@bugdrop/server',
  'BUGDROP_API_KEY',
  'NEXT_PUBLIC_BUGDROP_API_KEY',
  'VITE_BUGDROP_API_KEY',
  'bd_api_v1',
  'bd_auth_v1',
  'bd_api_v2',
  'bd_auth_v2',
  'apiKey',
  'data-repo',
  'categoryLabels',
  'installationId',
  'reporterId',
  'userId',
  'pseudonym',
  'GITHUB_TOKEN',
  'SUPABASE_SERVICE_ROLE',
];

for (const marker of forbidden) {
  if (builtText.includes(marker)) {
    throw new Error(`Browser security boundary failed: built artifact contains ${marker}`);
  }
}

const dependencyText = JSON.stringify({
  dependencies: packageJson.dependencies,
  peerDependencies: packageJson.peerDependencies,
  optionalDependencies: packageJson.optionalDependencies,
});
if (dependencyText.includes('@bugdrop/server')) {
  throw new Error('Browser security boundary failed: @bugdrop/browser depends on @bugdrop/server');
}

for (const subpath of Object.keys(packageJson.exports)) {
  const specifier = '@bugdrop/browser' + (subpath === '.' ? '' : subpath.slice(1));
  const browserConsumer = await build({
    stdin: {
      contents: `import * as SDK from '${specifier}'; window.SDK = SDK;`,
      resolveDir: repositoryRoot,
      sourcefile: 'browser-consumer.ts',
    },
    bundle: true,
    define: {
      'process.env.NEXT_PUBLIC_BUGDROP_API_KEY': JSON.stringify('browser-build-api-key-sentinel'),
    },
    format: 'esm',
    platform: 'browser',
    write: false,
  });
  const output = browserConsumer.outputFiles[0]?.text ?? '';
  for (const marker of [...forbidden, 'browser-build-api-key-sentinel']) {
    if (output.includes(marker)) throw new Error(`${specifier} browser bundle contains ${marker}`);
  }
}
const serverManifest = JSON.parse(
  await readFile(resolve(repositoryRoot, 'packages/server/package.json'), 'utf8')
);
for (const subpath of Object.keys(serverManifest.exports)) {
  const specifier = '@bugdrop/server' + (subpath === '.' ? '' : subpath.slice(1));
  const bundled = await build({
    stdin: { contents: `import '${specifier}';`, resolveDir: repositoryRoot },
    bundle: true,
    conditions: ['browser'],
    format: 'esm',
    platform: 'browser',
    write: false,
  });
  const output = bundled.outputFiles[0]?.text ?? '';
  if (
    !output.includes('@bugdrop/server cannot be imported into browser code') ||
    /node:crypto|Authorization|bd_api_v[12]|bd_auth_v[12]/.test(output)
  ) {
    throw new Error(`${specifier} browser condition did not fail closed`);
  }
}

globalThis.process.stdout.write(
  `Browser security boundary passed: inspected ${distFiles.length} built files, package dependencies, and browser-targeted consumer bundles.\n`
);
