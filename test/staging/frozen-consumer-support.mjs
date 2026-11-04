import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

// A genuine historical package, never a relabelled current candidate.
export async function installFrozenObserverConsumer() {
  const archive = fileURLToPath(new URL('./fixtures/bugdrop-server-0.1.0.tgz', import.meta.url));
  const provenance = JSON.parse(await readFile(archive.replace(/\.tgz$/, '.provenance.json')));
  assert.equal(
    provenance.sha256,
    'f1fdae6acaafa6f3bcd55a1a70d77bba5d3772b921362e66d7bd7ebceaee298a'
  );
  assert.equal(provenance.sourceCommit, '760c031035e866dbc89a4e0ab1886c67bd45fa15');
  assert.equal(
    createHash('sha256')
      .update(await readFile(archive))
      .digest('hex'),
    provenance.sha256
  );
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'bugdrop-frozen-observer-')));
  try {
    await writeFile(
      join(directory, 'package.json'),
      JSON.stringify({ private: true, type: 'module' })
    );
    execFileSync(
      'npm',
      [
        'install',
        '--offline',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--package-lock=false',
        archive,
      ],
      { cwd: directory, stdio: 'pipe' }
    );
    const require = createRequire(join(directory, 'package.json'));
    const installed = await realpath(require.resolve('@bugdrop/server'));
    assert.ok(installed.startsWith(join(directory, 'node_modules/@bugdrop/server/dist') + '/'));
    const manifest = JSON.parse(
      await readFile(join(directory, 'node_modules/@bugdrop/server/package.json'))
    );
    assert.equal(manifest.name, '@bugdrop/server');
    assert.equal(manifest.version, '0.1.0');
    const entry = join(directory, 'consumer.mjs');
    await writeFile(entry, "export { BugDrop } from '@bugdrop/server';\n");
    const { BugDrop } = await import(pathToFileURL(entry).href);
    return {
      BugDrop,
      versions: { server: manifest.version },
      close: () => rm(directory, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
