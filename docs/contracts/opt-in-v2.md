# Versioned metadata admission contract — P0 review candidate

Status: D1–D4 approved as decisions; this exact P0 protocol is a REVIEW CANDIDATE.
No runtime, gateway, database migration, credential issuance or deployment is implemented here.
SDK base: d75fc31ef626493b2927793f48983035bdbfbaed. Existing V1 remains unchanged.
Candidate fixtures: `packages/contracts/fixtures/opt-in.v2.json`, `opt-in-catalog.v2.json`,
`opt-in-token.v2.json`, `opt-in-outcome.v2.json`.
Canonical encoding and state rules below override older proposed metadata-header designs.

## Selection and downgrade boundary

Select a dedicated `POST /v2/submission-capabilities`, exact HTTPS endpoint from trusted
server configuration. No query, fragment, redirect, route alias or automatic retry.
Required headers are `Content-Type: application/json`,
`Accept: application/vnd.bugdrop.submission-capability.v2+json`,
`X-BugDrop-Contract-Version: 2`, `X-BugDrop-SDK-Version: <server package version>`,
`Authorization: Bearer bd_auth_v2.<keyId>.<authSecret>`, and
`X-BugDrop-Intent-Signature: <canonical base64url32-byte MAC>`.
Do not send the previously proposed browser metadata header pair. V2 rejects either
`X-BugDrop-Client-Metadata-Schema` or `X-BugDrop-Browser-SDK-Version` if present:
there must be only one metadata representation, in the body.

V2 requires a separately provisioned V2-only credential record and new random keyId/root.
Its API key is `bd_api_v2.<16-byte keyId>.<32-byte root>`, canonical unpadded base64url.
Derive authSecret = HMAC-SHA256(root, UTF8("bugdrop:auth:v2\0" + keyId)).
The service stores only keyId, protocolMode=2, scoped lifecycle metadata and its
peppered verifier, never root/API key/authSecret. Provisioning and activation must
explicitly support this verifier; no existing V1 record is automatically upgraded.
V1 keys/derived secrets are not accepted on V2; V2 keys never authorize V1, including
prefix relabeling, because both mode and domain-separated verifier must match.
Existing V1 rejects the V2 prefix today. This contract must retain that rejection.

Route, media/body discriminator and credential mode jointly enforce pre-mint intent.
Stripping optional headers cannot remove required body intent; removing intent/schema
or moving a V2 request to V1 fails before mint. A customer with BOTH authorized key
classes can deliberately issue a separate V1 request; preventing malicious holders
of valid V1 authority from using it is outside this promise. SDKs/proxies MUST NOT
swap credentials/modes as recovery. Arbitrary compromise of an authenticated backend
is not binary attestation or something this protocol can prevent.

## Trusted configuration and ownership

The customer SERVER is explicitly configured with endpoint, public applicationId,
internal credentialId, keyId, original installationGeneration UUID, deploymentDigest,
catalogDigest, and pinned issuer confirmation public key (kid + P-256 JWK x/y).
These values come from a reviewed account/runtime configuration export, not browser
input, request headers, a self-advertised remote key or current provider-ID lookup.
Export ownership: account/data supplies scoped IDs/catalog; runtime supplies exact
endpoint/deployment and public key; coordinator verifies matching release evidence.
No discovery endpoint or new trusted key from an error response is allowed.
Do not expose internal scope to browser: only binding and browser package claim leave it.
Configuration rotation requires an explicit server update; stale scope fails closed.

## Exact request and canonical intent

Outer JSON keys exactly: schemaVersion=2, intent. Intent keys/order and fixture types:
`attemptId, issuedAt, expiresAt, submissionId, payloadDigest, applicationId,
credentialId, keyId, installationGeneration, endpoint, deploymentDigest,
catalogDigest, origin, serverSdkVersion, browserSdkVersion, normalizedVersions`.
attemptId, credentialId and installationGeneration are lowercase UUIDv4. Application ID:
`^app_[A-Za-z0-9_-]{1,196}$`, total<=200 ASCII bytes. keyId is canonical16-byte base64url.
submissionId/payloadDigest follow unchanged V1 binding validators (1–200 UTF-8 bytes;
canonical32-byte SHA256 digest). Do not derive submission/attempt IDs from a user.
Endpoint exact configured canonical HTTPS URL ending `/v2/submission-capabilities`;
origin exact configured HTTPS application origin, with V1 canonical alias rejection.
No production loopback exception. Digests are lowercase64hex. Times are safe integer
Unix milliseconds, nonnegative; issuedAt<=now+5,000 and expiresAt=issuedAt+60,000;
now<expiresAt. Thus issuer admission clock T must satisfy issuedAt-5,000<=T<expiresAt;
the deadline remains client issuedAt+60,000, never issuer admission+60,000. This permits
ahead-clock requests without waiting or fabricating issuer time (at most65s until the
original deadline). Recheck current clock after every blocking lock and before admission.
Version claims: canonical stable `MAJOR.MINOR.PATCH`, each component0..999999,
no leading zeros except0, <=64 ASCII bytes. Header server version must equal body.
normalizedVersions keys exactly `sdkVersion,browserSdkVersion,widgetVersion,protocolVersion`;
server/browser equal catalog-normalized claims, widgetVersion=null, protocolVersion=2.
No environment, user, session, repository selector, label, arbitrary object or extension key.

Canonical intent bytes are UTF8(JSON.stringify(the ordered ARRAY of the 16 intent
field VALUES in the order above)); nested normalizedVersions is an ARRAY in its stated
four-field order. JSON strings use ECMAScript JSON.stringify escaping with no Unicode
normalization; reject unpaired surrogates and duplicate JSON keys before materialization.
No floats, exponent wire numbers, negative zero, BOM or trailing non-JSON bytes.
Object wire key order is immaterial; semantic canonicalization is defined only by
this tuple, never general object sorting. Exact raw feedback bytes/digest remain unchanged.
intentDigest = lowercasehex SHA256(UTF8("bugdrop:metadata-intent:v2\0") || intentBytes).
Request MAC = HMAC-SHA256(decoded authSecret, UTF8("bugdrop:intent-request:v2\0POST\0")
|| UTF8(endpoint) || NUL || UTF8(intentDigest)). Issuer verifies bearer/mode/peppered
verifier first, then constant-time MAC against the transient presented authSecret.
Missing/mismatched MAC rejects before reservation/signing. Strip or rewrite route,
body, scope, normalization or signature and verification fails. Gateway must preserve
this fixed header on V2 only. No raw MAC/bearer is retained in telemetry.
This digest alone is not a secret MAC, identity pseudonym or authentication.
TLS, request MAC and V2-only mode protect admission; trusted gateway may
see the bearer. A malicious bearer holder can forge claims, as with other app authority.

## Response and confirmation verification

200 body keys exactly `schemaVersion:2, capability, confirmation`.
capability uses the V1 transport shape `{schemaVersion:1,token,expiresAt}`; token remains
opaque to the SDK but MUST be the distinct V2 authenticated token defined in
opt-in-v2-token.md. This is not a V1 token or permission for V1 verifier acceptance.
Outer response media type is the V2 Accept value; Cache-Control exactly no-store.
No cookies, redirects or arbitrary response headers; gateway must explicitly permit
this V2 media type. Existing V1 parser rejects outer schema2; it otherwise ignores
unknown V1 response fields, so added confirmation on a V1 object is NOT verification.

confirmation exact keys `schemaVersion:2,kid,intentDigest,capabilityDigest,
admittedAt,expiresAt,signature`. kid=`^[A-Za-z0-9_-]{1,64}$`, pinned key only.
capabilityDigest=SHA256(UTF8("bugdrop:capability-envelope:v2\0") ||
UTF8(JSON.stringify([1, token, capability.expiresAt]))), lowercasehex.
Confirmation expiresAt=intent.expiresAt; admittedAt is the genuine issuer commit clock,
with intent.issuedAt-5,000<=admittedAt<intent.expiresAt and admittedAt<=clientNow+5,000.
This same lower bound applies to issuer admission and client verification; do not clamp
admittedAt to the client clock. No expiry grace, waiting, retry or deadline renewal.
Client now<confirmation.expiresAt and capability remaining lifetime follows V1 limits.
Signature is ES256: ECDSA P-256/SHA256, raw IEEE-P1363 r||s64bytes, canonical base64url;
verify UTF8("bugdrop:metadata-confirmation:v2\0") concatenated with canonical JSON array
`[2,kid,intentDigest,capabilityDigest,admittedAt,expiresAt]`. No algorithm negotiation.
A separate reviewed confirmation signing-key purpose is required; do not silently
reuse existing capability keys. Fixtures are synthetic data, not usable credentials.

The SDK must validate exact shapes, pinned kid/signature, both digests, all expected
intent fields including normalized result/catalog/attempt/scope, times and capability
before returning anything to customer/browser. The intent digest commits ALL fields;
a boolean, same submission, matching version strings or HTTP200 cannot substitute.
Header-only confirmation is not selected. Metadata does not enter token claims or Issue.

## Limits and errors

Request/response raw decoded bodies<=32,768/65,536 bytes; token<=16,384 UTF-8 bytes.
No content encoding/decompression. Incoming visible headers<=64 and32,768 serialized
UTF-8 bytes, forwarded<=16,384 (lowercase name+":"+value+"\r\n" per entry).
Reject visible duplicates/coalescing of protocol/auth fields; raw-hidden multiplicity
requires separately qualified platform rejection. A local Headers singleton is not proof.
Whole exchange8s, no automatic retries; confirmation parsing/signature inside budget.
Wire JSON container nesting<=4 (outer object counts as1), no generic metadata. JSON duplicate-key rejection is mandatory.

Errors exactly `{schemaVersion:2,error:<enum>}` with no-store, no raw reflection.
400 invalid_request;401 authentication_failed;403 scope_rejected;409 binding_conflict, attempt_already_seen
or catalog_mismatch;410 attempt_expired;503 temporarily_unavailable. Gateway malformed
route/transport may still yield its existing404/502; all are failures, never issuer proof.
SDK fixed categories: rejected_before_send (local); exchange_unconfirmed (ANY sent
request lacking verified confirmation); confirmed. HTTP errors/signatures alone are
not zero-mint evidence. Persist private pending attempt context before send for bounded
accounting; never return an unverified capability, log it or retry via V1.
