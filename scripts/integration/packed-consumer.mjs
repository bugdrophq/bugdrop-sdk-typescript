import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

export async function installConsumer(repository) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'bugdrop-consumer-')));
  try {
    const tarballs = [];
    const versions = {};
    for (const name of ['browser', 'server']) {
      const manifest = JSON.parse(
        await readFile(join(repository, `packages/${name}/package.json`))
      );
      versions[name] = manifest.version;
      const output = execFileSync(
        'npm',
        [
          'pack',
          `--workspace=@bugdrop/${name}`,
          '--json',
          '--ignore-scripts',
          '--pack-destination',
          directory,
        ],
        { cwd: repository, encoding: 'utf8' }
      );
      tarballs.push(join(directory, JSON.parse(output)[0].filename));
    }
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
        ...tarballs,
      ],
      { cwd: directory, stdio: 'pipe' }
    );
    const require = createRequire(join(directory, 'package.json'));
    for (const name of ['browser', 'server']) {
      const installed = await realpath(require.resolve(`@bugdrop/${name}`));
      assert.ok(installed.startsWith(join(directory, 'node_modules') + '/'));
      assert.ok(installed.includes('/dist/'));
    }
    // Bare public export resolution happens inside the isolated consumer, not the workspace.
    const entry = join(directory, 'consumer.mjs');
    await writeFile(entry, "export { BugDrop } from '@bugdrop/server';\n");
    const { BugDrop } = await import(pathToFileURL(entry).href);
    const CommonJsBugDrop = require('@bugdrop/server').BugDrop;
    const guard = await build({
      stdin: { contents: "import '@bugdrop/server';", resolveDir: directory },
      bundle: true,
      platform: 'browser',
      format: 'iife',
      write: false,
    });
    assert.throws(
      () => new Function(guard.outputFiles[0].text)(),
      /cannot be imported into browser code/
    );
    assert.doesNotMatch(
      guard.outputFiles[0].text,
      /node:crypto|bd_api_v1|bd_auth_v1|Authorization/
    );
    return {
      directory,
      versions,
      BugDrop,
      CommonJsBugDrop,
      close: () => rm(directory, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

export async function loadBrowser(consumer, tokenProvider, binding, origin, widgetContract) {
  const bundled = await build({
    stdin: {
      contents: "import { BugDrop } from '@bugdrop/browser'; window.SDK = BugDrop;",
      resolveDir: consumer.directory,
    },
    bundle: true,
    platform: 'browser',
    format: 'iife',
    write: false,
  });
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    url: origin,
    runScripts: 'outside-only',
  });
  const { window } = dom;
  try {
    window.eval(bundled.outputFiles[0].text);
    for (const field of ['apiKey', 'userId', 'reporterId', 'subject', 'repo', 'labels', 'flow']) {
      assert.throws(
        () =>
          window.SDK.init({
            applicationId: 'app_fixture',
            tokenProvider,
            [field]: 'forbidden-canary',
          }),
        /unsupported/
      );
      assert.equal(window.document.querySelector('script'), null);
    }
    const controller = window.SDK.init({ applicationId: 'app_fixture', tokenProvider });
    const script = window.document.querySelector('script');
    assert.equal(script.dataset.sdkVersion, consumer.versions.browser);
    assert.equal(widgetContract.authentication.providerDatasetProperty, 'authTokenProvider');
    window.BugDrop = Object.fromEntries(
      widgetContract.methods.map((method) => [method, () => false])
    );
    script.dispatchEvent(new window.Event('load'));
    await controller.ready;
    const token = await window[script.dataset.authTokenProvider](binding);
    assert.equal(window.localStorage.length, 0);
    assert.equal(window.sessionStorage.length, 0);
    assert.ok(!window.document.documentElement.outerHTML.includes(token));
    return token;
  } finally {
    window.close();
  }
}

export async function readFixtures(repository) {
  return Object.fromEntries(
    await Promise.all(
      [
        'api-key-credential',
        'origin',
        'submission-binding',
        'capability-response',
        'capability-validation',
        'widget-public-api',
      ].map(async (name) => [
        name,
        JSON.parse(
          await readFile(resolve(repository, `packages/contracts/fixtures/${name}.v1.json`), 'utf8')
        ),
      ])
    )
  );
}
