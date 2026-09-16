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

const browserConsumer = await build({
  stdin: {
    contents: "import { BugDrop } from '@bugdrop/browser'; void BugDrop;",
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
const browserConsumerText = browserConsumer.outputFiles[0]?.text ?? '';
if (browserConsumerText.includes('browser-build-api-key-sentinel')) {
  throw new Error('Browser security boundary failed: public environment secret entered the bundle');
}

const serverBrowserConsumer = await build({
  stdin: {
    contents: "import '@bugdrop/server';",
    resolveDir: repositoryRoot,
    sourcefile: 'server-browser-consumer.ts',
  },
  bundle: true,
  conditions: ['browser'],
  format: 'esm',
  platform: 'browser',
  write: false,
});
const serverBrowserText = serverBrowserConsumer.outputFiles[0]?.text ?? '';
if (
  !serverBrowserText.includes('@bugdrop/server cannot be imported into browser code') ||
  serverBrowserText.includes('node:crypto') ||
  serverBrowserText.includes('Authorization') ||
  serverBrowserText.includes('bd_api_v1') ||
  serverBrowserText.includes('bd_auth_v1')
) {
  throw new Error('@bugdrop/server browser condition did not fail closed');
}

globalThis.process.stdout.write(
  `Browser security boundary passed: inspected ${distFiles.length} built files, package dependencies, and browser-targeted consumer bundles.\n`
);
