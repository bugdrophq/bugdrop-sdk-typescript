import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Compile in the isolated packed consumer, without workspace/test ambient declarations.
export async function checkBrowserTypes(directory, repository) {
  const source = `
import { BugDrop } from '@bugdrop/browser';
import { BugDropOptIn } from '@bugdrop/browser/opt-in';
declare global {
  interface Window {
    BugDrop?: { open(): void; registerFlow(name: string): void };
  }
}
window.BugDrop?.registerFlow('customer-owned');
void BugDrop.init;
void BugDropOptIn.init;
`;
  await writeFile(join(directory, 'browser-types.mts'), source);
  await writeFile(
    join(directory, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        skipLibCheck: false,
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        lib: ['ES2022', 'DOM'],
        types: [],
      },
      files: ['browser-types.mts'],
    })
  );
  execFileSync(
    process.execPath,
    [join(repository, 'node_modules/typescript/bin/tsc'), '-p', directory],
    {
      cwd: directory,
      stdio: 'pipe',
    }
  );
}
