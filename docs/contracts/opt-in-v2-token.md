# V2 capability acceptance isolation — superseding P0 candidate

The outer capability envelope remains schemaVersion1 for SDK transport compatibility.
The TOKEN IS NOT V1. It is signed, not encrypted. Its minimal claims contain no
internal scope; the opaque random handle is resolved only inside trusted online authority.
No token mode is inferred from outer envelope, HTTP route/header, unverified claim,
or whether a ledger row happens to exist.

## Authenticated discriminator and exact claims

Compact JWS header exact `{alg:"ES256",kid,typ:"bugdrop-managed-capability-v2"}`.
kid matches `^cap-v2-[A-Za-z0-9_-]{1,57}$`. Use NEW purpose-separated P-256 capability
keys; no key material or kid may be shared with V1 capability or confirmation keys.
V1 key rings must NEVER contain V2 keys, including aliases with another kid. Key
publication must enforce this invariant before enabling V2 issuance.

Payload exact keys: `protocolVersion,iss,aud,publicApplicationId,jti,iat,exp`.
protocolVersion=2; iss=`bugdrop-managed-<realm>-v2`,
aud=`bugdrop-managed-<realm>-ingress-v2`; realm is a trusted configured literal
local, staging or production, with separate key rings. No wildcard/dynamic realm. publicApplicationId is the already-public app_ identifier,
matched to trusted key registration and configured application scope before routing.
jti is a NEW cryptographically random UUIDv4 capability handle allocated once in the
original reservation, unrelated to attempt/submission/tenant/application/destination/
credential/generation IDs. Never derive it from scope, payload or a user identifier.
Its authorization lasts at most five minutes, but its private handle/public-alias→scope
mapping remains linkable through the original issuer reservation retention window and
any separately disclosed backup retention. Browser/recipient copies may remain
correlatable after expiry; expiry promises neither unlinkability nor erasure of external
copies. It is not a reporter pseudonym.
A reservation handle collision fails closed without overwriting or selecting another
handle; no replacement handle after timeout, lost response, restart or UNKNOWN.
iat=floor(genuine issuer signing clock/1000), exp=iat+300; neither derives from client
issuedAt. Envelope expiry equals exp as canonical UTC milliseconds. No internal operational
UUID, attempt/submission ID, digest, origin, version metadata,
configuration or authorization counter enters token claims.

P5 stores the immutable handle→original intent/scope/binding mapping in the existing
app-scoped authority reservation. Authenticate signature/type/realm/expiry first using
trusted purpose-specific key registration; require signed publicApplicationId in that
key/endpoint's configured application allowlist. Only then route by the signed public
app identifier to its existing trusted app-scoped authority and lookup the signed handle.
Unsigned request app/tenant/path does not select scope or override this binding. A handle
from another application is unknown and rejected. Do not create a global handle→tenant
directory. The trusted public-alias export is NEW: existing staging selects internal authority
from configured STAGING_APPLICATION_ID. Its mapping to signed publicApplicationId must
be authenticated, immutable and qualified for every enabled binding; unknown/unavailable mapping disables admission and verification. No publicly
supplied internal scope, current provider mapping or error-driven discovery is allowed.

Issuer clock must still satisfy request admission limits before signing/commit/release.
Verifier requires iat*1000<=current issuer clock<exp*1000, exp-iat=300, active key
validity and current authority; no V1 envelope-skew grace authorizes a token.
The raw JWS token must fit the existing managed8192-byte bound (stricter than the
SDK envelope's generic16384-byte limit). Reject unknown fields, mode, key purpose,
issuer/audience, algorithms, duplicate keys, malformed bytes and unsupported realm.

Verify signature and exact mode against trusted deployment authority BEFORE selecting
a ledger record by signed random jti. Scope, attempt and submission binding are read
from that original immutable record, never from client claims or current provider mapping.
Require state admitted, immutable original intent scope/binding, current authority,
unexpired token and matching capabilityDigest of the exact token+envelope expiry.
Check submitted raw bytes/digest/origin before any external attempt. Missing, purged,
UNKNOWN, reserved, failed, mismatched or unavailable ledger fails closed. No V1 fallback. Recheck after async ledger/digest work and immediately before every
external attempt, including receipt/adapter final preflight. A replaced/disappeared
public-alias mapping fails closed rather than resolving current provider scope.
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
