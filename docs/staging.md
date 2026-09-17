# Unpublished packed SDK staging gate

Remote dogfood is **not configured**. No Cloudflare account, hostname, GitHub App, or dedicated dogfood
repository is approved. The staging provider is not implemented: the merged local adapter cannot
supply remote submission/control operations or independently observed remote evidence. This tranche
provides a reviewed gate and scenario driver; local/unit passes are not staging proof.

`npm run test:staging` builds and installs actual SDK tarballs and requires a remote run.
`npm run validate:dogfood` requires both normal validation and that staging run. Missing inputs exit 2
with `staging_not_configured`; malformed inputs or any failed check exit nonzero. Only a completed
scenario suite and safety attestation can emit `staging_passed` with the exact service revision.
There is no skip or local-adapter fallback. Public SDK exports and all six V1 fixtures remain intact.

## External inputs required before execution

Supply these through environment variables or the provider's server-only secret resolver, never
command-line arguments, fixtures, PR text, or public framework prefixes:

- `BUGDROP_STAGING_TARGET`: reviewed, non-secret JSON containing exactly `environment` (`staging`),
  `accountId`, `endpoint`, `origin`, `serviceRevision`, `deploymentDigest`, `githubApp`,
  `dogfoodRepository`, and numeric-string `repositoryId`. Account ID is 32 lowercase hex characters;
  source revision is 40; approved deployed-artifact digest is 64. The endpoint must be an exact HTTPS
  `/v1/submission-capabilities` URL; origin must be exact canonical HTTPS. Known production endpoint
  defaults and IP literals are rejected; approved DNS hostnames are required. Names, account, artifact, and
  dedicated repository require approval.
- `BUGDROP_STAGING_ADAPTER` and `BUGDROP_STAGING_ADAPTER_SHA256`: absolute path and SHA-256 of the
  reviewed authoritative remote provider entry point. No such remote provider is implemented yet.
- `BUGDROP_STAGING_ORACLE` and `BUGDROP_STAGING_ORACLE_SHA256`: absolute path and SHA-256 of the reviewed
  safety oracle entry point. The safety task owns remote evidence schema/provenance.
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

Scenarios require delivery/replay, exact-origin rejection, tampered tokens, every negative V1
submission-binding vector, revocation, stale authorization, and indeterminate replay with one attempt.
Capability validation and SDK-version reporting run through the installed server export. Existing
packed browser/ESM/CommonJS checks remain in normal CI; no real hosted-widget proof is claimed here.

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

Provider output and exception details are discarded in a child process. The parent emits only
allowlisted status, missing variable names, and a validated service revision on success. A failed
oracle, wrong target, bad module digest, missing module, crash, or timeout cannot become a pass.
`close()` runs on scenario failure and the temporary consumer is removed. A hard timeout cannot
promise remote cleanup: stop execution, inspect the approved target read-only, and use the provider's
reviewed cleanup procedure for that run's isolated controls/credentials. Never retry an indeterminate
submission or delete a real Issue to conceal the outcome. Remote resource rollback and cleanup remain
an explicit prerequisite of the currently unimplemented provider.

No deployment, credential issuance, provisioning, SDK publication, or customer installation is included.
