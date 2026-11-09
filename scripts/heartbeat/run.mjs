import { profileEnvironment } from './config.mjs';
import { runBrowser } from './browser.mjs';
import { verifyIssue } from './verify.mjs';

const result = (outcome, reasonCode, observedAt = new Date().toISOString()) => ({
  schemaVersion: 1,
  outcome,
  reasonCode,
  observedAt,
});

export async function runHeartbeat(
  target,
  env,
  helpers,
  browserRun = runBrowser,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
) {
  const profile = profileEnvironment(target);
  const options = {
    token: env.GH_MONITOR_TOKEN,
    repo: target.repository,
    profile: 'production',
    profileEnvironment: profile,
  };
  const evidence = { postValidated: false };
  let report;
  let cleanupOkay = true;
  let verifiedIssueNumber;
  try {
    // Do not sweep any old marker or another application's reports.
    const old = await helpers.listMatchingIssues({
      ...options,
      prefix: '[BugDrop production heartbeat]',
      state: 'open',
    });
    if (old.length) throw new Error('cleanup_failed');
    try {
      await browserRun(target, env.BUGDROP_SDK_FIXTURE_PASSWORD, evidence);
    } catch {
      /* A lost browser response cannot establish that delivery failed. */
    }
    let issues = [];
    let previous = null;
    let stable = false;
    let sawMatch = false;
    for (let attempt = 0; attempt < 6; attempt++) {
      issues = await helpers.listMatchingIssues({ ...options, marker: target.marker });
      const signature = JSON.stringify(issues.map((issue) => issue.number).sort());
      sawMatch ||= issues.length > 0;
      if (issues.length && signature === previous) {
        stable = true;
        break;
      }
      previous = signature;
      if (attempt < 5) await sleep(2000);
    }
    const code = !stable && sawMatch ? 'inconclusive' : verifyIssue(issues, target, evidence);
    if (code === 'issue_verified') verifiedIssueNumber = issues[0].number;
    report =
      code === 'issue_verified'
        ? result('verified', code)
        : code === 'inconclusive'
          ? result('inconclusive', 'browser_inconclusive')
          : result('delivery_failed', code);
  } catch {
    report = result('inconclusive', 'setup_failed');
  } finally {
    if (evidence.postValidated) {
      try {
        const cleanup = await helpers.closeMatchingIssues({ ...options, marker: target.marker });
        if (report.outcome === 'verified') {
          if (cleanup.matchedNumbers.length > 1) {
            report = result('delivery_failed', 'issue_duplicate');
          } else if (
            cleanup.matchedNumbers.length !== 1 ||
            cleanup.matchedNumbers[0] !== verifiedIssueNumber ||
            cleanup.openNumbers.length !== 0
          ) {
            cleanupOkay = false;
          }
        }
      } catch {
        cleanupOkay = false;
      }
    }
  }
  // Delivery evidence and monitor lifecycle are separate: cleanup cannot erase a confirmed failure.
  // A cleanup failure never publishes green or resolves the SDK incident.
  const lifecycleReport =
    cleanupOkay || report.outcome === 'delivery_failed'
      ? report
      : result('inconclusive', 'cleanup_failed', report.observedAt);
  let incidentOkay = true;
  try {
    await helpers.transitionHeartbeatIncident({
      token: env.GITHUB_TOKEN,
      repo: 'bugdrophq/bugdrop-sdk-typescript',
      outcome:
        lifecycleReport.outcome === 'verified'
          ? 'recovery'
          : lifecycleReport.outcome === 'delivery_failed'
            ? 'failure'
            : 'inconclusive',
      reasonCode: lifecycleReport.reasonCode,
    });
  } catch {
    incidentOkay = false;
  }
  const finalReport =
    incidentOkay || lifecycleReport.outcome === 'delivery_failed'
      ? lifecycleReport
      : result('inconclusive', 'incident_failed', lifecycleReport.observedAt);
  await helpers.sendHeartbeatOutcome({
    endpoint: 'https://bugdrop.dev/api/monitor/sdk-heartbeat',
    secret: env.MONITOR_SDK_HEARTBEAT_SECRET,
    heartbeatId: `${env.GITHUB_RUN_ID}:${env.GITHUB_RUN_ATTEMPT}`,
    report: finalReport,
  });
  return {
    report: finalReport,
    passed: report.outcome === 'verified' && cleanupOkay && incidentOkay,
  };
}
