# Original authority and open qualification gates — P0 candidate

This companion records the required authority source without pretending it exists in
the current runtime. Read runtime design `/tmp/bugdrop-runtime-original-authority-design-v1.md`,
SHA256 `cd61923d1ae03ab83849a61dd8dd1fa4f7682d7210ebaa49573db10ccdccce61`,
against runtime `8db5d879dd4ecde0109a9233e4c8cdfdde1412ab` and data
`0c5ce62f85a88c61fa9605d54f7689f435194c04`. Fixtures below are synthetic hypothetical
provisioning, not evidence of original mapping, current publication or deployed keys.

## Scope authority

SQL `public.github_installations.tenant_id/id` is the candidate source of tenant and
original internal installation generation. The provider decimal ID is not a generation.
Verified creation and never-reuse across deletion/restore need qualification by the
data/provisioning owner: the inspected foundation currently describes synthetic fixtures.
No current provider-ID lookup can recover a missing original generation.

A NEW authenticated versioned control-plane publication must bind original SQL tenant,
internal generation, provider/GitHub-app context, application, credential and lifecycle
version under source locks. Data and runtime jointly own this producer/parser contract.
Existing publication does not carry these facts; the strict runtime projection cannot
silently accept them. Exact authentication bytes, freshness, version ordering and
rotation are an OPEN dependency: no production admission until independently frozen.
Server configuration exports must derive from that same accepted publication. Client
intent claims alone never create or override authority. Internal tenant need not appear
in client intent: the authority must bind application+credential+generation uniquely to
the original tenant and reject missing, stale, replaced or ambiguous mapping.

At first P0 reservation, capture the authenticated publication identity and complete
original scope immutably inside existing StagingAuthorization. After every async wait,
re-read current publication, lifecycle, generation and revocation before the serialized
transition. Publication and SQL are not an atomic transaction with DO admission. Recheck
authority at admission and at submission verification; no assertion that post-sign
revocation erases an already completed signature. Legacy admissions cannot be backfilled
from current mappings, provider IDs, configurationVersion or delivery receipts.

## Immutable clocks and identities

P0 client attemptId and issuer reservation time are distinct. Store one issuer clock
sample reservedAt in the first durable reservation, with retentionDeadline=reservedAt
+720 hours. Neither restart, duplicate, failed confirmation nor continuation changes it.
Store admittedAt once at the successful second transition; it must satisfy the original
intent lifetime. Confirmation and normalized versions refer to this same attempt.
No separate recovery attempt or new submission may replace the original attempt to
repair an ambiguous exchange. Client pending context contains only the original binding,
intent and status, never credential material or token; expires no later than the original
reservation evidence window, with client issuedAt+720h as its conservative upper bound.
Do not persist this context in browser storage or send it to general analytics.

F2 original workId/admittedAt/workDeadline are SEPARATE uninstall workflow facts.
First authenticated intake must store workDeadline=original admittedAt+720h atomically
with the permanent fence. A recovery attempt has another identity; continuation must
not replace original admission time with cycleStartedAt. After deadline, the candidate
permits observation/operator accounting only, not refreshed mutating cleanup. These
are F2 requirements, not claims that current runtime captures them. Provider event time
requires independent provenance; never relabel admission time as provider occurredAt.
The proposed nine-input F2 signature is not frozen by this P0 document.

## Signing and implementation gate

Mint-linearization design `/tmp/bugdrop-mint-linearization-design-v1.md`, SHA256
`fd3d2da8f90c0754c02718da946ec5cb691db4a29433aceeefcbb0430779a91c`,
was read in full. Terminal UNKNOWN/no-remint is representable by the client category
exchange_unconfirmed, but does not satisfy exact completed-signature accounting.
Owners must explicitly choose whether the required metric is actual signatures S or
durably authorized issuance A. If S, a stronger qualified signer boundary is needed.
This proposal does not silently change the approved meaning of actual mint.

Freeze one live owner epoch per spent signing permit. Timeout seals response success;
late callbacks cannot release, reset, overwrite or resurrect terminal state. A still-live
signer completion may only add known accounting under the same owner epoch. Recovery
must not mark a running owner terminal and later allow its result to finalize. Exact
epoch/drain mechanics and revocation-to-egress ordering remain runtime review gates.

Reserve authorizes at most one live signing invocation; durable admission authorizes
release, subject to current revocation and submission verification. They are different
linearization points. No distributed atomic signing claim is made. A crash between
crypto completion and accounting remains UNKNOWN and cannot be re-signed. Exact actual
mint counts remain blocked unless an independently durable signer boundary is supplied;
tests with signer instrumentation do not establish recoverable production exact counts.

The chosen app-scoped storage still requires bounded capacity/expiry handling and
qualification of async interleaving with revocation. Storage exhaustion must fail before
reservation, not evict live evidence or fall back to stateless signing. Implementation
stays closed pending cross-owner acceptance of these availability/accounting semantics,
trusted scope publication, credential provisioning and exact P6/P7 outcome transport.
This candidate may be reviewed in parts but must not be called a frozen P0 contract
while those prerequisites remain open.
