import { isAbsolute, relative, resolve } from 'node:path';
import { readConfiguration } from './config.mjs';

const config = readConfiguration(process.env);
const ref = process.env.BUGDROP_STAGING_PROVIDER_REF;
const insideProvider = (path) => {
  const local = relative(resolve('.staging-provider'), path);
  return local !== '' && !local.startsWith('..') && !isAbsolute(local);
};
if (
  config.status !== 'configured' ||
  !/^[a-f0-9]{40}$/.test(ref ?? '') ||
  !insideProvider(config.adapter) ||
  !insideProvider(config.oracle)
) {
  process.stdout.write(
    `${JSON.stringify(
      config.status === 'configured' ? { status: 'staging_invalid_provider_configuration' } : config
    )}\n`
  );
  process.exitCode = 2;
} else {
  process.stdout.write('{"status":"staging_inputs_validated_not_remote_proof"}\n');
}
