# Unpublished packed SDK staging gate

Remote dogfood is **not configured in this repository**. The gate requires an approved target
manifest and a reviewed remote provider handoff before execution. The merged local adapter cannot
supply remote submission/control operations or independently observed remote evidence. The gate and
scenario driver alone do not establish staging proof; local/unit passes remain local evidence.

`npm run test:staging` builds and installs actual SDK tarballs and requires a remote run.
`npm run validate:dogfood` requires both normal validation and that staging run. Missing inputs exit 2
with `staging_not_configured`; malformed inputs or any failed check exit nonzero. Only a completed
scenario suite and safety attestation can emit `staging_passed` with the exact service revision.
There is no skip or local-adapter fallback. Public SDK exports and all six V1 fixtures remain intact.

Successful runs emit a sanitized gate receipt with `receiptVersion: 1`, `proofKind: 'remote'`,
the independently observed `runId`, approved `serviceRevision` and `deploymentDigest`, actual packed
server `sdkVersion`, `sdkScenarios: 7`, and `safetyScenarios: 13`. Version `0.1.0` is the only currently
supported private runner contract; it is checked against the installed package before scenario
controls run. The receipt is emitted only after both suites and consumer cleanup succeed. The parent
requires the exact receipt shape and target commitments plus successful child exit; partial,
mismatched, unsupported-version, or extra-field receipts fail closed. Raw observations, identities,
capabilities, credential markers, and provider errors never enter the receipt. Shape tests use
synthetic objects and do not count as live remote receipts. This gate receipt is not a public V1
wire/evidence schema change and does not claim hosted browser-widget coverage.

## External inputs required before execution

Supply these through environment variables or the provider's server-only secret resolver, never
command-line arguments, fixtures, PR text, or public framework prefixes:

- `BUGDROP_STAGING_TARGET`: reviewed, non-secret JSON containing exactly `environment` (`staging`),
  `accountId`, `applicationId`, `endpoint`, `origin`, `serviceRevision`, `deploymentDigest`, `githubApp`,
  `dogfoodRepository`, and numeric-string `repositoryId`. Account ID is 32 lowercase hex characters;
  source revision is 40; approved deployed-artifact digest is 64. The endpoint must be an exact HTTPS
  `/v1/submission-capabilities` URL; origin must be exact canonical HTTPS. Known production endpoint
  defaults and IP literals are rejected; approved DNS hostnames are required. Names, account, artifact, and
  dedicated repository require approval.
  `applicationId` is the approved operational application identity (1–100 letters, digits,
  underscores or hyphens; never `UNAPPROVED`), not an end-user identifier. The provider must
  independently substantiate it with the target; echoing the environment is not evidence.
- `BUGDROP_STAGING_ADAPTER` and `BUGDROP_STAGING_ADAPTER_SHA256`: absolute path and SHA-256 of the
  reviewed authoritative remote provider entry point. No such remote provider is implemented yet.
- `BUGDROP_STAGING_ORACLE` and `BUGDROP_STAGING_ORACLE_SHA256`: absolute path and SHA-256 of the reviewed
  safety oracle entry point. The safety task owns remote evidence schema/provenance.
- `BUGDROP_STAGING_SAFETY_RUNNER` and `BUGDROP_STAGING_SAFETY_RUNNER_SHA256`: absolute path and SHA-256
  of the authoritative `test/staging-safety/scenarios.mjs` runner. Its compatibility handshake must
  match the SDK bridge before any target inspection or scenario action. Missing or incompatible
  runner modules are failures; the seven SDK scenarios alone cannot satisfy this gate.
- Nonproduction scenario-scoped API credentials via `resolveApiKey()`, backed by environment or
  provider secret mechanisms. `BUGDROP_STAGING_API_KEY` is available in the protected CI environment
  for providers that consume it. A shared dogfood credential alone is insufficient to isolate the
  revocation and stale-authorization scenarios; the authoritative provider must implement that scope.
- Read-only provider identity/deployment/repository inspection and independent remote evidence
  access. Missing/unavailable sinks must block full attestation; empty local captures do not qualify.

The entry-point digests supplement review of the entire pinned provider checkout and lockfile; they
are not a sandbox or a hash of transitive imports. Provider and oracle modules must have side-effect-free
initialization. Never use unreviewed modules, monkey-patched fetch, synthetic evidence, or the local
Miniflare adapter as remote proof.

## Coordinated test-only interface

The Cloudflare provider exports `inspectTarget()` and `startScenario({ name, submissionId, runId })`.
Inspection must be read-only and return the exact approved target plus a UUID observation `runId`.
The SDK compares every target field before starting any scenario. These fields are correlation,
not independent proof; the safety oracle must verify actual deployed revisions, sink sources, and
GitHub repository observations.

`startScenario` returns `endpoint`, `origin`, `resolveApiKey()`, `submit`, `revoke`,
`expireAuthorizationState`, `setDeliveryIndeterminate`, `evidence`, and `close`. Existing local
submission argument/envelope shapes are preserved, but the implementation must be staging-owned,
authenticated, isolated, and actually remote. It must not mutate a customer repository, shared
credential, production application, or current public system. Each scenario uses a fresh random
submission ID, while retries within the scenario reuse it. No report/end-user identity is generated.
The provider owns all private transport, controls, credentials, and cleanup. The SDK defines no
submission or administrative HTTP route.

The safety oracle exports `assertEvidence({ evidence, expected, forbiddenValues })` and must return
exactly `true` or throw. Expected values include environment, service revision, deployed-artifact
digest, repository ID, run ID, scenario, SDK version, exact HTTP exchange count (including rejected
requests), ordered submission outcomes, and expected delivery-attempt count. The oracle must reject
unavailable sources, stale/wrong-deployment evidence, missing/extra observations, forbidden content,
and issue-count discrepancies. The SDK independently scans evidence for credential, capability,
report-body, and submission-ID canaries before invoking the oracle. Observer output is never printed.

`expected.exchangeSuccesses` records the required outcome of every HTTP exchange in order.
The configured origin must mint successfully before origin rejection is tested. Expected issuance
denials require `request_failed` with HTTP 403; authentication errors, rate limits, service failures,
and transport errors cannot stand in for that denial. The oracle must enforce successful 2xx or
explicit 403 observations against this array.

Scenarios require delivery/replay, exact-origin rejection, tampered tokens, every negative V1
submission-binding vector, revocation, stale authorization, and indeterminate replay with one attempt.
Capability validation and SDK-version reporting run through the installed server export. Existing
packed browser/ESM/CommonJS checks remain in normal CI; no real hosted-widget proof is claimed here.

## Packed client safety bridge

The exact private handshake is `packedSdkSafetyContract = { version: 2, sdkVersion: '0.1.0' }`.
Older, missing, extra-field, or mismatched contracts fail before provider inspection. This versions
the private runner bridge; public V1 requests and the safety evidence V1 schema do not change.

After the seven SDK scenarios, the worker invokes the separately pinned `runRemoteSafety` through
an SDK-owned test adapter. `startSafetyScenario({ scenario, runId })` is a private provider method;
it is not a public SDK API or remote route. It supplies an isolated service with the exact target
endpoint/origin, `resolveApiKey`, `submit`, `secretMarkers`, the authoritative runner's private
control/retention/observation methods, and `close`. Setup failure closes the scenario. Successful
setup binds private methods to their original service so provider state is retained.

The bridge owns `mint`: it constructs the installed tarball's `BugDrop` with only the server API key
and endpoint. It neither replaces fetch nor delegates capability issuance to a provider double.
Only `request_failed` with status 403 becomes a denied mint; every other error propagates. Submission
passes the original binding and report bytes to the existing private provider port. The observed SDK
version comes from the packed consumer; the exact target and run ID come from this same worker run's
read-only inspection and are never cached across runs. Provider secret markers remain in the isolated
process alongside SDK-derived credential canaries.

For malformed/noncanonical aliases, `rejectInvalidOrigin` calls the actual SDK and requires its
local origin `TypeError`. It reads the provider's independent `readExchangeCount` before and after;
both exact snapshots contain `{ runId, scenario: 'origin-aliases', applicationId, count,
complete: true, exclusive: true }`. Counts are safe nonnegative integers and must remain equal.
The provider must observe the approved run/application independently of the SDK process, include
all completed requests in the observation window, and report concurrent or ambiguous activity as
nonexclusive. Missing, stale, unscoped, incomplete, decreasing, or concurrent observations fail.
These are collector requirements, not values to fabricate from the environment or SDK call count.

An authority Durable Object counter observes only requests admitted to that object. A request can
fail with HTTP 503 before admission, leaving its count unchanged. That counter alone therefore cannot
establish complete network-attempt evidence. Both SDK scenario paths keep an in-memory transcript of
actual packed SDK invocations and outcomes without replacing fetch. The private exact shape is
`{ schemaVersion: 1, runId, scenario, applicationId, sdkVersion, complete, attempts }`; each attempt
is `{ sequence, outcome, status }`. No input, token, error message, header, or body is retained.
Snapshots and entries are copied and frozen. Successful SDK calls record `capability_issued` with
null status; only the independent ingress observer supplies the actual successful HTTP status.

Strict issuance HTTP 403 records `http_denied`. Expected local origin validation records
`local_origin_rejected`; the intentional unsupported `userId` negative test records
`local_input_rejected` only for its exact SDK TypeError. Other HTTP failures record `http_error`,
missing-status request failures record `transport_error`, and unknown errors record `sdk_error`.
Those failures permanently mark the transcript incomplete. Pending invocations are also incomplete.
Missing HTTP status never implies local validation. Observer read failures and mismatched snapshots
also invalidate the safety scenario; cleanup still runs and cannot make it successful.

`evidence({ sdkAttemptTranscript })` receives this private transcript for collector reconciliation.
The SDK separately compares independent `evidence.exchanges` against all issued/denied calls, requiring
exact count, order, observed SDK version and successful 2xx versus denied 403 status. Origin snapshots
require a healthy idle transcript and the matching count in addition to complete/exclusive remote
observations. Missing/extra durable entries, pre-admission 503, transport errors, unavailable observers,
or an unknown result cannot produce a complete proof, even if a later read returns zero or a plausible
count. The remote collector must obtain its exchange entries independently, never manufacture them
from the supplied transcript. This private reconciliation does not add fields to public evidence V1.

The runner records each local proof as `client_validation_rejected` with zero network attempts and
both snapshots. It separately sends a canonical wrong origin through the SDK, requires HTTP 403,
and records `http_denied` with exactly one observed network attempt. Final `originChecks` must match
the local alias checks followed by that HTTP denial, with counters advancing from the single
successful baseline exchange to two exchanges overall. The SDK does not override fetch or turn a
local exception into a fabricated HTTP response. These proof records belong only to runner version 2.

All thirteen safety scenarios must return their complete expected attestations. The authoritative
runner retains its explicit uninstall-completion block until durable edge and authoritative SQL
acknowledgements can be independently observed. Missing publisher/control receipts, unavailable
lifecycle or retention observations, partial results, and thrown attestation failures cannot produce
`staging_passed`. This bridge adds no SQL mapping, administrator authority, acknowledgement schema,
or collector implementation. Actual provider observations remain an external prerequisite.

## CI and operation

The dispatch-only `Staging dogfood conformance` workflow has an unconditional staging job. Configure
and approve the protected `bugdrop-staging` environment before dispatch. It fails on missing inputs;
normal PR CI tests the gate's behavior and does not claim a remote run. Dogfood acceptance requires
this separate workflow to pass at the intended SDK/service revisions.

In that environment, also configure the immutable 40-character `BUGDROP_STAGING_PROVIDER_REF` for
`bugdrophq/bugdrop`, plus repository-relative `BUGDROP_STAGING_ADAPTER_PATH` and
`BUGDROP_STAGING_ORACLE_PATH`. The workflow checks out that exact source, installs locked provider
dependencies without lifecycle scripts, and injects the SDK secret only into the final isolated run.
Additional provider secret access must be separately reviewed/configured when the remote provider
exists. No workflow is dispatched and no GitHub environment is provisioned by this change.

Also configure `BUGDROP_STAGING_SAFETY_RUNNER_PATH` relative to that same pinned provider checkout.
CI requires all three module paths to remain inside the checkout; runner integrity and compatibility
are checked again in the isolated child before private scenario work.

Provider output and exception details are discarded in a child process. The parent emits only
allowlisted failure status/missing variable names or the validated complete-run receipt above. A failed
oracle, wrong target, bad module digest, missing module, crash, or timeout cannot become a pass.
`close()` runs on scenario failure and the temporary consumer is removed. A hard timeout cannot
promise remote cleanup: stop execution, inspect the approved target read-only, and use the provider's
reviewed cleanup procedure for that run's isolated controls/credentials. Never retry an indeterminate
submission or delete a real Issue to conceal the outcome. Remote resource rollback and cleanup remain
an explicit prerequisite of the currently unimplemented provider.

No deployment, credential issuance, provisioning, SDK publication, or customer installation is included.
