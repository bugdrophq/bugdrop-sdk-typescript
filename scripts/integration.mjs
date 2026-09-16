import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkService } from './integration/service-checks.mjs';
import { installConsumer, readFixtures } from './integration/packed-consumer.mjs';
import { checkTransport } from './integration/transport-checks.mjs';

const repository = resolve(import.meta.dirname, '..');
const consumer = await installConsumer(repository);
try {
  const fixtures = await readFixtures(repository);
  await checkTransport(consumer, fixtures);
  if (process.argv.includes('--service')) {
    const adapter = process.env.BUGDROP_LOCAL_SERVICE_ADAPTER;
    if (!adapter || !isAbsolute(adapter)) {
      throw new Error(
        'Set BUGDROP_LOCAL_SERVICE_ADAPTER to the authoritative local adapter absolute path'
      );
    }
    const { start } = await import(pathToFileURL(adapter).href);
    await checkService(consumer, fixtures, start);
    process.stdout.write('Authoritative local managed-service conformance passed.\n');
  }
  process.stdout.write(
    'Packed SDK public-export transport checks passed (ESM, CommonJS, browser bundle).\n'
  );
} finally {
  await consumer.close();
}
