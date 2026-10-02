import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const index = process.argv.indexOf('--state-dir');
if (index < 0 || !process.argv[index + 1]) {
  throw new Error('Pass --state-dir /absolute/private/directory');
}
const directory = resolve(process.argv[index + 1]);
const output = resolve('examples/v1-backend/dist');
await mkdir(output, { recursive: true });
const browser = await build({
  entryPoints: [
    'examples/v1-backend/loopback-browser.ts',
    'examples/v1-backend/loopback-widget.ts',
  ],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  outdir: output,
  write: false,
});
const browserScript = browser.outputFiles.find((file) =>
  file.path.endsWith('/loopback-browser.js')
)?.text;
const widgetScript = browser.outputFiles.find((file) =>
  file.path.endsWith('/loopback-widget.js')
)?.text;
if (!browserScript || !widgetScript) throw new Error('local browser fixture build failed');
await build({
  entryPoints: ['examples/v1-backend/loopback-server.ts'],
  outfile: `${output}/loopback-server.mjs`,
  bundle: true,
  packages: 'external',
  platform: 'node',
  format: 'esm',
});
const { startLoopback } = await import(pathToFileURL(`${output}/loopback-server.mjs`).href);
const fixture = await startLoopback(directory, browserScript, widgetScript);
process.stdout.write(`BugDrop local fixture: ${fixture.origin}/\n`);
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => void fixture.close().then(() => process.exit(0)));
}
