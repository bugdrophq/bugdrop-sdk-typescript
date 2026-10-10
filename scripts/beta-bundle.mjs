import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';

const repository = resolve(import.meta.dirname, '..');
const run = (command, args, cwd = repository) =>
  execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
const sourceCommit = run('git', ['rev-parse', 'HEAD']).trim();
if (run('git', ['status', '--porcelain', '--untracked-files=all']).trim()) {
  throw new Error('Commit all source changes before creating a beta bundle');
}
const destination = resolve(process.argv[2] ?? join(repository, 'dist', `beta-${sourceCommit}`));
// Never replace a previously produced release candidate.
await mkdir(dirname(destination), { recursive: true });
await mkdir(destination);
await mkdir(join(destination, 'vendor'));
await mkdir(join(destination, 'src'));
run('npm', ['run', 'build']);
const files = [];
for (const name of ['browser', 'server']) {
  const packed = JSON.parse(
    run('npm', [
      'pack',
      `--workspace=@bugdrop/${name}`,
      '--json',
      '--ignore-scripts',
      '--pack-destination',
      join(destination, 'vendor'),
    ])
  )[0];
  files.push(`vendor/${packed.filename}`);
}
for (const name of ['handler', 'transport']) {
  await copyFile(
    join(repository, `examples/v1-backend/${name}.ts`),
    join(destination, `src/${name}.ts`)
  );
}
for (const name of ['browser.ts', 'server.ts']) {
  await copyFile(
    join(repository, `examples/beta-consumer/${name}`),
    join(destination, 'src', name)
  );
}
await copyFile(join(repository, 'docs/beta-consumer.md'), join(destination, 'README.md'));
const dependencies = Object.fromEntries(
  files.map((file, index) => [`@bugdrop/${index === 0 ? 'browser' : 'server'}`, `file:${file}`])
);
await writeFile(
  join(destination, 'package.json'),
  JSON.stringify(
    {
      name: 'bugdrop-private-v1-consumer',
      version: '0.0.0',
      private: true,
      type: 'module',
      scripts: {
        check: 'tsc --noEmit',
        build:
          'npm run check && esbuild src/browser.ts --bundle --format=esm --outfile=dist/browser.js',
      },
      dependencies,
      devDependencies: { typescript: '5.7.2', esbuild: '0.28.1', '@types/node': '22.20.2' },
    },
    null,
    2
  ) + '\n'
);
await writeFile(
  join(destination, 'tsconfig.json'),
  JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        strict: true,
        lib: ['ES2022', 'DOM'],
        skipLibCheck: true,
      },
      include: ['src/*.ts'],
    },
    null,
    2
  ) + '\n'
);
run(
  'npm',
  ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'],
  destination
);
const hashes = {};
for (const file of [
  ...files,
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'README.md',
  ...['handler', 'transport', 'browser', 'server'].map((name) => `src/${name}.ts`),
]) {
  hashes[file] = createHash('sha256')
    .update(await readFile(join(destination, file)))
    .digest('hex');
}
await writeFile(
  join(destination, 'provenance.json'),
  JSON.stringify(
    {
      schemaVersion: 1,
      sourceCommit,
      node: process.version,
      npm: run('npm', ['--version']).trim(),
      sha256: hashes,
    },
    null,
    2
  ) + '\n'
);
process.stdout.write(`Private V1 consumer bundle: ${destination}\n`);
