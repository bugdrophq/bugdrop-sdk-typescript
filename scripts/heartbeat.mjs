import { readConfiguration } from './heartbeat/config.mjs';
import { loadHelpers } from './heartbeat/helpers.mjs';
import { runHeartbeat } from './heartbeat/run.mjs';

// No live work occurs without the explicit gate and complete dedicated target.
try {
  const target = readConfiguration(process.env);
  if (!target) {
    process.stdout.write('{"status":"disabled"}\n');
    process.exitCode = 2;
  } else {
    const helpers = await loadHelpers(process.env.BUGDROP_WIDGET_HELPERS);
    const outcome = await runHeartbeat(target, process.env, helpers);
    process.stdout.write(`${JSON.stringify(outcome)}\n`);
    process.exitCode = outcome.passed ? 0 : 1;
  }
} catch {
  process.stderr.write('[sdk-heartbeat] failed; inspect the sanitized workflow outcome\n');
  process.exitCode = 1;
}
