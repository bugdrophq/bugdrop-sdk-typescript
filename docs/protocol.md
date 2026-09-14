# Protocol v1

The compatibility surface is versioned independently from package versions.

## Capability exchange request

`POST /v1/submission-capabilities`

Headers:

- `Authorization: Bearer <Application server secret>`
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

The subject digest uses a dedicated, random per-Application subject key that is distinct from the
bearer authentication secret. The subject key never appears in the capability exchange or leaves
the customer backend during normal use. Rotating the bearer secret must leave subject digests
unchanged; rotating the subject key is an explicit identity migration. BugDrop's Application
provisioning flow in `bugdrop-web` must issue and distinguish both server-only values. The
`mean-weasel/bugdrop` Worker implements the exchange and validates the authentication credential
but does not provision it.

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
credentials. The authoritative service repository must consume equivalent vectors before v1 is
claimed as supported.
