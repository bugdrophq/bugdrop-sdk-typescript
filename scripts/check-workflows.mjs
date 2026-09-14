import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseDocument } from 'yaml';

const workflowsDirectory = resolve(import.meta.dirname, '../.github/workflows');
const workflowNames = (await readdir(workflowsDirectory)).filter((name) => /\.ya?ml$/.test(name));

if (workflowNames.length === 0) {
  throw new Error('No GitHub Actions workflows found');
}

for (const workflowName of workflowNames) {
  const contents = await readFile(resolve(workflowsDirectory, workflowName), 'utf8');
  const document = parseDocument(contents);
  if (document.errors.length > 0) {
    throw new Error(`${workflowName} is invalid YAML: ${document.errors[0]?.message}`);
  }
  const workflow = document.toJS();
  if (
    !workflow ||
    typeof workflow !== 'object' ||
    !Object.hasOwn(workflow, 'permissions') ||
    Object.keys(workflow.permissions ?? {}).length
  ) {
    throw new Error(`${workflowName} must deny permissions by default with "permissions: {}"`);
  }

  if (
    workflowName === 'ci.yml' &&
    (!workflow.on?.pull_request || !Object.hasOwn(workflow.on, 'merge_group'))
  ) {
    throw new Error('ci.yml must run for pull requests and merge queue groups');
  }

  for (const match of contents.matchAll(/^\s*uses:\s*([^\s#]+)@([^\s#]+)/gm)) {
    const action = match[1];
    const revision = match[2];
    if (!action || !revision || !/^[a-f0-9]{40}$/.test(revision)) {
      throw new Error(`${workflowName} must pin ${action ?? 'every action'} to a full commit SHA`);
    }
  }
}

globalThis.process.stdout.write(
  `Workflow policy passed: ${workflowNames.length} workflows use least privilege and immutable action pins.\n`
);
