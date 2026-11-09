# SDK production heartbeat (disabled implementation)

This monitor is additional to the completed lifecycle/Debt/Foil pilot. It does not reopen that
pilot, onboard Seatify, enable reporting, issue keys, or authorize a live report. No production
fixture, schedule, credential, database migration or public status change ships from a local build.

## Small reuse boundary

The dedicated deployment uses the existing authenticated hosted fixture and V1 browser/server
SDK path. Its separate `wrangler.heartbeat.toml` has no route, a different Worker/state namespace,
and `FIXTURE_ENABLED=false`. The historical staging fixture configuration is unchanged.
`HEARTBEAT_BUILD` identifies the reviewed SDK commit; the monitor checks the deployed fixture
browser bundle and managed widget SHA256 values as well. The build declaration is not independent
server attestation: verify server package provenance and deployment settings at rollout.

Heartbeat mode refuses an internal capability-service binding or self-service backend connection.
It must call the public `https://managed.bugdrop.dev/v1/submission-capabilities` endpoint. Existing
login, session, CSRF, rate and lease checks remain. The private `/heartbeat-identity` route requires
that same session. This is a Workers SDK integration check, not qualification of every Node adapter.

The runner reuses GitHub discovery/cleanup, incident reconciliation and sanitized outcome transport
from widget commit `92dc85d8695d0c0be69af8110081ba9d48b0088a`. The helper checkout must be clean
at that exact commit. There is no new monitoring service or shared package. Synthetic issue markers
retain the existing helper format but live in a separate dedicated issue repository; incidents
live in `bugdrophq/bugdrop-sdk-typescript`. Neither pilot issue/repository is a cleanup target.

## One transaction and outcome

`npm run heartbeat:run` is inert (exit2, disabled) without `BUGDROP_SDK_HEARTBEAT_ENABLED=1`.
With explicit configuration it opens a fresh private browser context, signs in normally, checks
fixture identity and loaded artifact hashes, and submits one known title/body through the UI.
It permits at most one capability POST and one matching submission POST. It never presses Try
again/Check result or clears recovery storage. No trace, video, HAR, token or report body is logged.

Success requires the delivered receipt plus independent, stable discovery of exactly one issue
with the expected marker, title/body, author, labels and repository. Cleanup closes only the current
run's marker. Leftover open synthetic issues block a new transaction; they are not broadly swept.
Unknown browser/delivery state is inconclusive. Missing/duplicate/invalid issues after a validated
submission and delivered receipt are confirmed delivery failures. Failed cleanup or incident
handling prevents a healthy outcome. The status receiver accepts only four normalized fields:
schemaVersion, outcome, reasonCode, observedAt. Monitoring transport retries reuse the same run ID
and report; they never repeat the feedback submission.

## Configuration and rollout boundary

The new workflow runs only on protected main in this repository. `BUGDROP_SDK_HEARTBEAT_MODE`
must explicitly be `manual` or `daily`; absence is off even for manual dispatch. Daily mode schedules
one run at03:23UTC. Configure the `sdk-heartbeat` GitHub environment's protections before activation.
Use a separate synthetic Application, exact approved origin and issue repository, plus normal
managed reporting authorization and budget. One scheduled run may spend one report attempt;
cleanup does not refund it. Account for manual runs and shared workspace quota. Never exempt or
reset the ledger to make monitoring pass.

`BUGDROP_SDK_HEARTBEAT_TARGET` is an exact JSON object with these fields:

- fixtureOrigin, applicationId, widgetUrl, issuerUrl, submissionUrl
- repository (`owner/repo`), author, labels (string array)
- sdkCommit (40 lowercase hex), fixtureBundleSha256 and widgetSha256 (64 lowercase hex)

Use the approved dedicated fixture origin; the real pilot apps and historical lifecycle hostname
are explicitly rejected. The widget must be under `https://widget.bugdrop.dev` or `https://delivery.bugdrop.dev`, and the
submission URL must be exactly that widget script origin plus `/v1/submissions`. The managed
bootstrap derives this URL from script.src; the SDK does not offer an independent delivery-host override. No fallback to the legacy service exists.

Secrets are `BUGDROP_SDK_FIXTURE_PASSWORD`, `MONITOR_SDK_HEARTBEAT_SECRET`, and the monitoring-only
GitHub App private key (`SDK_HEARTBEAT_MONITOR_PRIVATE_KEY`, ID variable
`SDK_HEARTBEAT_MONITOR_APP_ID`). The GitHub App token is scoped only to the synthetic issue repo.
The SDK root stays in the fixture's server-only deployment settings, never in Actions/browser code.

The web companion adds `/api/monitor/sdk-heartbeat`, gated by `MONITOR_SDK_HEARTBEAT_ENABLED=1`,
with a distinct secret and separate persistence. Leave both ends off until its additive monitoring
schema, receiver, fixture artifacts, exact bindings, authorization and quota are reviewed and read
back. Then separately authorize one manual acceptance run before enabling daily mode. Reuse the
existing lifecycle, isolation and pilot delivery proofs; no reset or rotation campaign is required.

Rollback is to set the workflow mode off and disable the SDK receiver/component, then normally
revoke only the synthetic Application's reporting authority. Preserve receipts/history and do not
revoke pilot keys. This document is an operating proposal, not authority to perform those actions.
