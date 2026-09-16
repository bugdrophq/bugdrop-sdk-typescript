# Architecture

## Repository ownership

- `bugdrop-web` owns Application provisioning and API-key creation, display, rotation, and
  revocation.
- `mean-weasel/bugdrop` owns the Worker, hosted widget, and protocol implementation.
- This repository owns the TypeScript SDK packages and compatibility fixtures.

Cross-repository implementation remains pending. The SDK fixture and canonical documentation define
the contract external implementers must consume before V1 can be considered end-to-end compatible.

## Package boundary

`@bugdrop/browser` and `@bugdrop/server` share only the versioned capability response contract.
The private `@bugdrop/contracts` workspace is bundled into each public package, so published
artifacts have no private runtime dependency.

The browser package creates a script element for BugDrop's hosted versioned widget, supplies
`data-application-id`, and installs a narrowly scoped global function that accepts the current
submission binding and returns a short-lived capability token. It validates the binding before
calling the customer's provider and proxies the widget's public controller methods after the
`bugdrop:ready` event. It contains no widget UI, submission implementation, repository selection,
or server exchange client.

The server package owns capability issuance from the customer's perspective. Its internal API-key
authenticator derives an Application bearer, attaches it to the capability request, and validates
the versioned response. API-key material and the root remain private fields and never appear in
request bodies, errors, or serialization. Capability requests contain no customer user identifier;
they contain only a stable per-submission ID, a canonical digest of the exact submission body, and
optional Application-scoped metadata. The customer application owns user authentication,
suspension, and user-specific rate limiting.

The hosted widget owns the final submission serialization. It passes `{ submissionId,
payloadDigest }` through the installed provider to customer code, which requests a capability from
its backend using `@bugdrop/server`. The managed ingress Worker later verifies that the same ID and
the SHA-256 digest of the received raw body bytes match the capability before parsing or delivery.

## Future control-plane seam

The default endpoint is a provisional `v1/submission-capabilities` URL on the current BugDrop
service origin. Tests inject a `fetch` implementation and never require that unfinished endpoint.
The `endpoint` constructor option permits staging and compatibility testing without changing the
public operation. Before release, the authoritative service repository must confirm the final URL
and run the shared fixtures against the deployed implementation.

The existing hosted widget is authoritative, and direct script-tag installation remains a
first-class supported method. The SDK is an additional installation and controller method. The
current direct configuration accepts `data-repo`; authenticated SDK mode instead requires the
future `data-application-id` input. This SDK deliberately does not send `data-repo` as a
compatibility workaround because doing so would return repository authority to the untrusted
browser.

## Direct script-tag installation

Direct authenticated installation keeps the same capability boundary as `@bugdrop/browser`. The
customer's authenticated token endpoint returns the complete versioned capability response:

```json
{
  "schemaVersion": 1,
  "token": "<opaque short-lived capability>",
  "expiresAt": "<RFC 3339 timestamp>"
}
```

The named global identified by `data-auth-token-provider` accepts the hosted widget's submission
binding, fetches that response, extracts it, and returns only its opaque `token` string to the
widget. The widget does not receive the API key, a customer user identifier, or the complete
capability response object. The endpoint must remain authenticated, same-origin, and
CSRF-protected.
