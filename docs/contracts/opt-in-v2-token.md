# V2 capability acceptance isolation — superseding P0 candidate

The outer capability envelope remains schemaVersion1 for SDK transport compatibility.
The TOKEN IS NOT V1. No token mode is inferred from outer envelope, HTTP route/header,
unverified claim, or whether a ledger row happens to exist. This document supersedes
any implication that an ordinary V1 signature plus an optional ledger check is enough.

## Authenticated discriminator and exact claims

Compact JWS header exact `{alg:"ES256",kid,typ:"bugdrop-managed-capability-v2"}`.
kid matches `^cap-v2-[A-Za-z0-9_-]{1,57}$`. Use NEW purpose-separated P-256 capability
keys; no key material or kid may be shared with V1 capability or confirmation keys.
V1 key rings must NEVER contain V2 keys, including aliases with another kid. Key
publication must enforce this invariant before enabling V2 issuance.

Payload exact keys in the token fixture: `protocolVersion,iss,aud,tenantId,
applicationId,publicApplicationId,destinationId,credentialId,keyId,
installationGeneration,configurationVersion,authorizationVersion,origin,
attemptId,submissionId,payloadDigest,iat,exp,jti`.
protocolVersion=2; iss=`bugdrop-managed-<realm>-v2`,
aud=`bugdrop-managed-<realm>-ingress-v2`; realm is a trusted configured literal
local, staging or production, with separate key rings. No wildcard/dynamic realm.
Internal SQL tenant/application/destination/credential/generation IDs are UUIDs from
the NEW authenticated original-scope publication; publicApplicationId is the intent's
app_ string. keyId is the intent credential keyId, NOT credentialId. Current V1 uses
keyId as credentialId and provider ID as installationId: those are not silently reused
as these new internal fields. Published configuration/authorization versions are
positive safe integers. No provider-ID remapping or unsigned tenant lookup is allowed.
attemptId/submissionId/payloadDigest/origin match the original intent exactly.
jti=attemptId; no extra independent recovery identity. iat=floor(genuine issuer signing
clock/1000), exp=iat+300. Neither derives from future client issuedAt. Envelope expiry
must equal exp as canonical UTC milliseconds. No version metadata enters token claims.

Issuer clock must still satisfy request admission limits before signing/commit/release.
Verifier requires iat*1000<=current issuer clock<exp*1000, exp-iat=300, active key
validity and current authority; no V1 envelope-skew grace authorizes a token.
The raw JWS token must fit the existing managed8192-byte bound (stricter than the
SDK envelope's generic16384-byte limit). Reject unknown fields, mode, key purpose,
issuer/audience, algorithms, duplicate keys, malformed bytes and unsupported realm.

Verify signature and exact mode/scope against trusted authority BEFORE selecting a
ledger record using signed tenant/internal application/credential/generation/attempt.
Require state admitted, immutable original intent scope/binding, current authority,
unexpired token and matching capabilityDigest of the exact token+envelope expiry.
Check submitted raw bytes/digest/origin before any external attempt. Missing, purged,
UNKNOWN, reserved, failed, mismatched or unavailable ledger fails closed. No V1 fallback.
ADMITTED history alone never overrides current revocation or expiry.

## Every reachable gate and rollout

Source inventory pinned to runtime8db5d879dd4ecde0109a9233e4c8cdfdde1412ab:

| Gate                            | Current source / path                                   | Required V2 handling                                            |
| ------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------- |
| Local ingress                   | local/ingress.ts /_local/submit                         | Explicit reject until upgraded signature+ledger dispatch        |
| Local delivery                  | local/delivery.ts /_local/submit                        | Same, before receipt routing                                    |
| Local receipt                   | local/receipt.ts ANY POST and fresh pre-delivery check  | Same even arbitrary/direct path                                 |
| Staging submission              | staging/ingress.ts StagingSubmission /submit            | Same                                                            |
| Staging delivery                | staging/delivery.ts delegates local delivery            | Same                                                            |
| Staging receipt                 | staging/delivery.ts subclasses local receipt            | Same including direct ANY POST                                  |
| Staging GitHub adapter          | staging/github.ts /attempt and preflight callback       | Same before external GitHub call                                |
| Hosted flat/structured feedback | routes/api.ts /api/feedback                             | Reject managed V2 presentations with public auth on OR off      |
| Hosted variant/recipe fallback  | widget/variants/submission.ts public feedback transport | Never used by opt-in; endpoint rejects managed V2 presentations |

All managed gates currently call local/capability.ts's exact V1 typ/key/claim verifier;
they do not implement the new ledger gate. Root managed scaffold is closed, not an
alternate verifier. Source routes[]/disabled flags do not prove deployed inventory.
Runtime owner must enumerate actual deployed routes, bindings and direct entrypoints
before rollout; an undiscovered acceptance path blocks issuance enablement.

Freeze phased rollout: first deploy compatible readers that retain V1 behavior but
reject V2 unless fully upgraded; then publish V2-only verification keys only to upgraded
gates; finally enable V2 issuance after ALL reachable chain members qualify. Any old
member rejects V2, causing availability failure rather than bypass. Rollback disables
new issuance and keeps safe V2 rejection/verification; never put V2 keys in V1 rings.
V2-aware dispatch may support both signed types, but V2 failure cannot call V1 verifier.

Hosted bd1 HMAC is separate public authority. Add an early rejection for managed V2
bearer tokens (recognizable JWS type/kid) and bd_api_v2/bd_auth_v2 credential presentations,
even with AUTH_TOKEN_SECRET absent. Recognition is a rejection filter, never authority;
malformed managed envelopes fail closed. Cover flat and structured feedback. Current
source lacks this no-secret guard. Opt-in cannot invoke the widget's public appVersion
fallback/retry flow. Removing the token and using independently permitted public feedback
is outside the managed capability promise; do not claim a global no-delivery guarantee.

The token fixture provides a real synthetic ES256 candidate, route rejection matrix,
precommit/UNKNOWN/admitted states and distinct key purpose. Tests exercise this contract
model, NOT live handlers. Runtime suites must send these cases through every listed gate,
including direct receipt arbitrary POST, current-authority rechecks and hosted auth on/off,
and observe zero external attempts for rejects before qualification can pass.
