# V2 admission, catalogs and package ownership — P0 candidate

Companion to opt-in-v2.md. Approved decisions do not approve this exact implementation.

## D3 catalog agreement

Catalog exact JSON keys: schemaVersion=1, normalizationVersion=1, server, browser,
widget. Each list<=128 unique lexicographically sorted stable versions using V2 grammar.
Current widget list empty because no source path exists. Catalog bytes canonical array
`[1,1,server,browser,widget]`, digest SHA256(domain "bugdrop:version-catalog:v1\0" || UTF8 JSON).
SDK release owner owns server/browser entries; hosted-widget release owner owns widget.
Entries require published/approved release provenance; no customer registration or raw
unknown logging. Fixture catalog is explicitly TEST ONLY; 0.1.0 is not a publication claim.

Backend carries the configured full catalog snapshot and digest; issuer uses matching
active snapshot. Known syntax-valid claim maps to itself if listed, else null. Backend
computes normalizedVersions before intent; issuer recomputes and compares exactly.
Wrong digest/result fails BEFORE mint with catalog_mismatch/binding_conflict. No online
refresh/retry in a failed issuance call. A new catalog needs explicit deployment/config
rotation. Signed confirmation of a null result confirms admitted absence of known version,
not full both-SDK publication evidence. Full qualification requires both expected claims.

Store accepted snapshot/normalization identity with immutable admission. Keep old
snapshot verification and confirmation keys through original admitted-work retention
(30 days) plus5min clock margin. New admission accepts ONLY active snapshot. Internal historical verification reads
the original snapshot without renormalizing; duplicate requests never return a capability. Max128 retained
snapshots and128 keys; if rotation would evict live history, block rotation, never evict
live work or extend TTL. Historical catalogs never authorize new unsupported claims.
Keys must be purpose-separated confirmation keys; verify-only retired keys may remain.
Compromise/revocation overrides availability: fail confirmation, do not remint/rewrite.

## D4 NEW durable admission ledger and replay

Runtime inventory /tmp/bugdrop-p4-p5-p6-runtime-inventory-v1.md SHA256
`d22d51abafd3fbad6d0dcf1b64e76c5c6ff561d5723d2b087e915a3f3ff493fa`
was read for this candidate. Current local/capability.ts signs statelessly; the later
local/receipt.ts ledger governs delivery, not minting. Observer finish can fail AFTER
signing. No implemented outcome adapter exists. NONE is assumed to supply this ledger.

Add a NEW P5-owned per-attempt table/API inside the existing app-scoped
StagingAuthorization authority, with modules at CF `src/managed/opt-in/admission.ts`,
`admission-store.ts` and `protocol.ts`. Reuse its reviewed app routing; installation
generation is an immutable row binding, not a new independently routed authority.
P5 owns tables, alarm, recovery and pending-marker transitions; P6 MUST NOT edit them
concurrently. Capacity/throughput and async revocation tests remain prerequisites;
if they fail, stop for review rather than silently shard or add a new DO resource.

Single serialized owner transaction validates active V2 credential/application/origin,
full intent/catalog/current clock, and uniqueness of submission + attempt, then creates
one immutable reservation and consumes its ONE signing permit. Scope includes original
installationGeneration; never resolve it anew from a provider ID. Attempt uniqueness
is credential-scoped; submission uniqueness application+original-generation-scoped.
Both last30days from original reservation, without TTL renewal.

Only after this durable permit commits may that live invocation sign ONE capability
candidate in memory. It must never log/persist token/API key/root/authSecret. Then a
second serialized transaction rechecks authority/time/generation and persists the
signed confirmation (containing capability commitment), immutable normalized result
and content-free pending metadata marker atomically with state=admitted. No capability
or confirmation may leave the invocation BEFORE that commit. Capability byte custody
is only in that live call; after response or failure it is discarded. This replaces a
naive persist-token retry cache. The capability commitment is private protocol evidence,
not a log/SQL/analytics field; it expires with its attempt evidence.

States: reserved/signing (permit spent), admitted (confirmation+pending marker durable),
or failed-unconfirmed (terminal). Restart finding reserved/signing marks failed-unconfirmed;
NEVER signs again. Duplicate request, including identical intent, returns409
attempt_already_seen with NO capability and NO new signing, even if first response was
lost. Different attempt for same reserved submission or any changed immutable fact
returns409 binding_conflict. Client may not remint a nonce or submission to repair this.
This sacrifices retry availability, deliberately avoiding durable bearer storage.

Counters distinguish R=reserved permits, S=known completed signatures, U=possible
signatures where crash left reserved/signing, A=durably admitted/releasable capabilities,
C=client verified confirmations, D=delivery. S may be UNKNOWN after crash between signing
and second commit: retain U<=1 per spent permit, not a fabricated0 or exact signed count.
Invalid intent MUST yield R=S=A=0 before signing. After admission A=1 even when C=0.
No state removal hides a signing attempt; report bounds/unknown rather than calling a
reservation or observation a mint. Qualification needing an exact unavailable count
is BLOCKED. Deterministic crash tests instrument actual signer invocations separately.
No optimistic renaming of signature generation as a database commit is permitted.

Recheck current time after blocking acquisition and at both transition decisions; no
signing begins after request expiry. Late signing result after deadline cannot be
admitted/released; record failed-unconfirmed with its known signature completion if
available. Authority revoked between reserve/sign/admit prevents release without erasing
signing evidence. Existing issuer freshness and revocation guarantees still apply.
Cryptographic work is not transactionally atomic with storage; the spent-permit rule
makes this a bounded recoverable state machine rather than a false distributed transaction.

Capability verification/submission ingress must consult this NEW ledger: require state
admitted, exact original scope/submission/digest and matching capability commitment before
calling delivery. Existing token signature verification alone is insufficient. This
prevents precommit candidates from becoming usable after a failure or memory exposure.
The lookup contains no raw report body and does not replace existing delivery receipt
at-most-once enforcement. P5 owns this verifier gate as well as issuer logic.

Expired intent returns410 before signing, even after purge. A different attempt cannot
reuse a retained submission; beyond30day retention same-ID reuse is outside the guarantee
and SDKs must never replay retired work. No new recovery/status/mint endpoint is selected.
Ledger/marker contains no user identity, raw bearer or feedback; SQL is not synchronous
issuance dependency. Retention Option A applies only separate uninstall evidence.

The issuance marker retains metadata for a later qualified delivery join (see
opt-in-v2-outcomes.md); it is not itself a delivery outcome. Queue dispatch repeats
SAME delivery event identity and normalized quadruple;
SQL ingest deduplicates. Loss after send/before ack can replay telemetry only. No GitHub
submission/delivery from telemetry recovery. SQL not synchronous issuance dependency.
Outcome TTL=original outcome acceptedAt+720h (a distinct qualified event clock), no user pseudonyms or arbitrary content. On expiration
or missing accounting, report incomplete, never reconstruct from current build.

Ambiguous sent request: stop caller success, no capability use, automatic retry, downgrade,
replacement nonce or replacement mint. Retain private original attempt context; operator
must drain/seal observations for the8s exchange +5s grace and account independently for
late work. If observer incomplete, remain unconfirmed. Capability may remain usable until
its original <=5min expiry; wait expiry or use separately approved existing revocation,
without claiming abort rolled back issuance. No new status/recovery route in this contract.
Caller must not retry same logical report merely to get a confirmation. This availability
cost is deliberate; review must accept it before runtime code.

## P1/P2/P3 concrete future surfaces (not implemented)

P1 SDK owns `packages/server/src/opt-in.ts`, exported only by a separately reviewed
`@bugdrop/server/opt-in` server-only entry; API `new BugDropOptIn(serverConfig)` and
`createSubmissionCapability(binding, browserMetadata)` returning V1 capability ONLY
AFTER V2 confirmation verification. Existing BugDrop class/method/exports unchanged.
Config contains trusted scope/catalog/keyset, V2 key and endpoint. No arbitrary headers.
P2 owns `packages/browser/src/opt-in.ts`, proposed `@bugdrop/browser/opt-in` entry with
`BugDropOptIn.init({applicationId,tokenProviderWithMetadata,...presentationOptions})`.
No V1 callback accepted here. Existing import/init remains supported. Browser metadata
exact `{metadataVersion:1,browserSdkVersion:<imported package version>}`, immutable
fresh object; binding unchanged. No server scope/keys/internal IDs in browser API.
New entrypoint work must preserve M1/M2 duplicate installation/readiness guards.

P3 source inventory: SDK has only docs/examples/express-route.md and nextjs-route.md,
both customer-policy placeholders, no executable reference backend. Assign SDK/P3 owner
exclusive future paths `examples/opt-in-backend/handler.ts`, `transport.ts`, `README.md`,
`test/opt-in-backend.test.ts`. This is a framework-neutral WHATWG Request/Response
reference handler, not a new hosted bugdrop-web account route. Handler path exactly
`/api/bugdrop-capability/v2`, POST same-origin HTTPS only, request limit2,048bytes.
Body exact `{binding:{submissionId,payloadDigest},metadata:{metadataVersion:1,browserSdkVersion}}`.
Inject mandatory customer access/CSRF/rate policy hook; absent hook fails startup.
Reference browser transport uses fixed same-origin URL, redirect:error,
credentials:same-origin, cache:no-store, referrerPolicy:no-referrer. Require exact Origin
at backend; no wildcard CORS or arbitrary origin forwarding. Backend supplies configured
origin/application/scope, not browser authority. Never forward cookies/user/UA/referrer/IP.
Returns only V1 capability after P1 confirmation, otherwise fixed no-store502 error;
logs no request/capability. Hook implementation remains customer's responsibility.
Examples/tests/dependency/Knip integration owned by P3 and require separate review.

P4 CF owns dedicated V2 gateway allowlist/body bounds/media response behavior, no V1
widening. P5 CF owns issuance and durable record/mint oracle. Data/account must add
EXPLICIT V2-only credential provisioning/activation/config-export support as prerequisite;
it is separate from P7 outcomes, cannot be inferred from additive telemetry columns.
P7 four fields/order unchanged: sdk_version, browser_sdk_version, widget_version,
protocol_version; opt-in now protocol2, not1. New17-input ingest and old13-input wrapper;
old wrapper produces4NULL; accepted protocol set{1,2}, validation from actual runtime.
P8 DTO preserves separate fields/unknown/reporting labels. No automatic enrollment,
backfill, version fingerprints or longer-lived aggregates. Option A uninstall retention
approved in principle but exact F2 implementation is separate; no uninstall changes here.

## Required cross-owner signoff before implementation

SDK, runtime/gateway, data/credential, coordinator/security and P3 owners must review
exact commit/fixtures plus downgrade attempt toV1, credential prefix relabeling, all
intent/confirmation fields, catalog rotation, same/changed attempts and pre/postcommit
faults. Current fixture tests prove canonical vectors and parser constraints ONLY;
not issuer mode storage, signatures in deployed services, atomicity or zero-mint oracles.
The materialized-object helper does not qualify raw JSON duplicate keys, hidden header
multiplicity, platform budgets or production constant-time verification.
No P1–P8 runtime coding/PR until this P0 candidate and prerequisite ownership are resolved.

## Exact P6 paths and serialization

CF P6 owns NEW `src/managed/opt-in/outcome-command.ts`, `outcome-dispatcher.ts`,
`outcome-consumer.ts`, `outcome-sql.ts`, and `test/managed/opt-in-outcomes.test.ts`.
P5 exposes a private pending-work API returning exact typed original immutable command
and acknowledgement-by-event; it alone updates the same-store marker. P6 cannot receive
capability/confirmation/raw intent body. P7 maps the normalized four fields to17 typed
arguments with existing13 identity/outcome inputs. The exact command vector is in opt-in-v2-outcomes.md. SQL adapter
transport and original delivery join must be cross-reviewed with P7; no generic JSON-to-SQL bag or direct DB grant.
P5/P6 store integration is SERIALIZED until that private API is frozen. Existing scaffold
consumer.retryAll and later delivery receipt are not qualification evidence.
