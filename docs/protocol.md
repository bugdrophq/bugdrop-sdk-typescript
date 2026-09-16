# Protocol v1

The compatibility surface is versioned independently from package versions. The following V1
credential bytes and authentication derivation are normative:

```text
API key: bd_api_v1.<16-byte-base64url-key-id>.<32-byte-base64url-root>
auth secret: HMAC-SHA-256(root, UTF8("bugdrop:auth:v1\0" + keyId))
Authorization: Bearer bd_auth_v1.<keyId>.<base64url-auth-secret>
```

Both API-key segments MUST use canonical unpadded base64url: `keyId` MUST decode to exactly 16 bytes
and `root` MUST decode to exactly 32 bytes. Non-canonical encodings and encoding aliases MUST be
rejected, not normalized. The derived authentication secret MUST also use canonical unpadded
base64url. The complete API key and decoded root never cross the network.

The credential issuer and capability service MUST use the same derivation. At issuance, the service
stores the key ID and `HMAC-SHA-256(server_pepper, auth_secret)` plus non-secret lifecycle metadata;
it MUST NOT store the root/API key, authentication secret, or complete bearer. For a request, the
service parses the canonical `bd_auth_v1` bearer, decodes the authentication secret, applies the
server-pepper HMAC, and compares the result in constant time. Verification against the root/API key
is not a valid V1 implementation because that value never crosses the network.

The compatibility vector is
[`packages/contracts/fixtures/api-key-credential.v1.json`](../packages/contracts/fixtures/api-key-credential.v1.json).
It is a non-production byte-level contract fixture, not a usable credential. Both the SDK and the
authoritative capability service MUST consume this same vector before claiming V1 compatibility.

## Capability exchange request

`POST /v1/submission-capabilities`

The managed production endpoint is
`https://api.bugdrop.dev/v1/submission-capabilities`. Clients may use an explicit override for
staging, loopback development, a customer-controlled proxy, or a supported self-hosted deployment.
They MUST NOT fall back to an anonymous or legacy endpoint after a managed request fails.

Headers:

- `Authorization: Bearer bd_auth_v1.<keyId>.<base64url-auth-secret>`
- `Content-Type: application/json`
- `Accept: application/vnd.bugdrop.submission-capability.v1+json`
- `X-BugDrop-Contract-Version: 1`
- `X-BugDrop-SDK-Version: <installed @bugdrop/server package version>`

Body:

```json
{
  "schemaVersion": 1,
  "submissionId": "018f1f2e-7b4a-7c3d-9e10-4f5a6b7c8d90",
  "payloadDigest": "sPybYsPwrJsoR8G8LbuHwYw3y-QHlqrYOfI-8lbJbEQ"
}
```

`submissionId` is an opaque, stable identifier for one logical submission. It is 1-200 valid UTF-8
bytes, is compared exactly without normalization, and MUST NOT contain or be derived from customer
user identity. Retries of the same logical submission use the same ID; a different logical
submission uses a new ID.

`payloadDigest` is the canonical base64url-without-padding encoding of SHA-256 over the exact bytes
of the managed submission request body. It is always 43 characters. It is not a digest of a parsed
object: alternate property order, whitespace, Unicode escaping, line endings, or any other byte
change produces a different binding. Standard base64, padding, aliases, and wrong-length values are
rejected rather than normalized.

The optional `origin` and `environment` fields may narrow a capability. `origin` MUST be one exact,
canonical URL origin: HTTPS in deployed environments, or HTTP only for an explicit loopback host
such as `localhost`, a `.localhost` name, `127.0.0.1`, or `[::1]`. Paths, queries, fragments,
credentials, public HTTP origins, and non-HTTP schemes are rejected. The client rejects
trailing-dot hostnames, default-port aliases, hostname case aliases, and other spellings whose
serialized origin differs from the supplied value. The shared positive and negative vectors are in
[`packages/contracts/fixtures/origin.v1.json`](../packages/contracts/fixtures/origin.v1.json); the
SDK and authoritative capability service MUST consume the same fixture. The client rejects
unexpected caller fields rather than forwarding them. In particular, no Application ID,
repository, installation, labels, flow permissions, or customer user identifiers are accepted by
this operation. Authentication identifies the Application credential only.

Customer applications authenticate, authorize, suspend, and rate-limit their own users before
requesting a capability. BugDrop does not receive an identifier that would let it distinguish those
users. The service may enforce Application-, credential-, network/IP-, replay-, payload-, and
platform-level protections.

The issued capability binds `submissionId` and `payloadDigest`. Managed ingress computes SHA-256
over the received request-body bytes before parsing or delivery and requires both the exact digest
and submission ID to match the capability. A changed byte, alternate JSON serialization, digest
encoding change, or different submission ID fails closed. The normative positive and negative
vectors are in
[`packages/contracts/fixtures/submission-binding.v1.json`](../packages/contracts/fixtures/submission-binding.v1.json).

## Capability exchange response

```json
{
  "schemaVersion": 1,
  "token": "<opaque short-lived capability>",
  "expiresAt": "2026-09-13T20:05:00.000Z"
}
```

The browser treats `token` as opaque, keeps it only in the call stack, rejects an expired response
or a response with more than five minutes remaining outside a 30-second clock-skew allowance, and
passes the token to the hosted widget's
bearer-token provider hook. The hook accepts the submission binding used to request that token. The
browser package does not decode, persist, log, or place the token in a URL.

`expiresAt` MUST use the one canonical UTC representation `YYYY-MM-DDTHH:mm:ss.sssZ`. RFC 3339
offsets, omitted millisecond precision, expanded years, and impossible calendar dates are rejected
rather than normalized.

Fixtures in `packages/contracts/fixtures` are compatibility inputs, not signing examples or usable
credentials. The authoritative service repository must consume the same vector before V1 is claimed
as end-to-end supported.
