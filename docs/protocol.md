# Protocol v1

The compatibility surface is versioned independently from package versions. The following V1
credential bytes and derivations are normative:

```text
API key: bd_api_v1.<16-byte-base64url-key-id>.<32-byte-base64url-root>
auth secret: HMAC-SHA-256(root, UTF8("bugdrop:auth:v1\0" + keyId))
Authorization: Bearer bd_auth_v1.<keyId>.<base64url-auth-secret>
wire subject: bdsub_v1_<base64url HMAC-SHA-256(root,
              UTF8("bugdrop:subject:v1\0" + exactSubject))>
subject size: 1-1024 valid UTF-8 bytes
```

`keyId` is the 16-byte unpadded-base64url API-key segment and `root` is the decoded 32-byte root
segment. `exactSubject` is encoded without trimming, case folding, or Unicode normalization. The
full API key, decoded root, and raw subject never cross the network.

The compatibility vector is
[`packages/contracts/fixtures/api-key-credential.v1.json`](../packages/contracts/fixtures/api-key-credential.v1.json).
It is a non-production byte-level contract fixture, not a usable credential.

## Capability exchange request

`POST /v1/submission-capabilities`

Headers:

- `Authorization: Bearer bd_auth_v1.<keyId>.<base64url-auth-secret>`
- `Content-Type: application/json`
- `Accept: application/vnd.bugdrop.submission-capability.v1+json`
- `X-BugDrop-Contract-Version: 1`

Body:

```json
{
  "schemaVersion": 1,
  "subject": "bdsub_v1_<base64url HMAC-SHA-256 digest>"
}
```

The optional `origin` and `environment` fields may narrow a capability. The client rejects
unexpected caller fields rather than forwarding them. In particular, no Application ID,
repository, installation, labels, or flow permissions are accepted by this operation.

The capability request and response bodies are independent from the authentication strategy. The
internal strategy prepares request authentication and a privacy-safe wire subject together, so a
future BYOA strategy can prepare a different bound, privacy-safe wire subject without changing
either body shape.

Pseudonyms are stable only within one API-key epoch. API-key rotation resets pseudonym-based limits
and blocks. When old and new keys are concurrently accepted during a deployment overlap, they
produce different pseudonyms for the same user and temporarily split per-user counters.

## Capability exchange response

```json
{
  "schemaVersion": 1,
  "token": "<opaque short-lived capability>",
  "expiresAt": "2026-09-13T20:05:00.000Z"
}
```

The browser treats `token` as opaque, keeps it only in the call stack, rejects an expired response
or a response with more than five minutes remaining, and passes the token to the hosted widget's
existing bearer-token provider hook. It does not decode, persist, log, or place the token in a URL.

Fixtures in `packages/contracts/fixtures` are compatibility inputs, not signing examples or usable
credentials. The authoritative service repository must consume the same vector before V1 is claimed
as end-to-end supported.
