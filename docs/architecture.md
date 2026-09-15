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
`data-application-id`, and installs a narrowly scoped global function that returns the current
short-lived capability token. It proxies the widget's public controller methods after the
`bugdrop:ready` event. It contains no widget UI, submission implementation, repository selection,
or server exchange client.

The server package owns capability issuance from the customer's perspective. Its internal
capability-identity strategy prepares two outputs together: a privacy-safe wire subject and the
request authentication headers. The V1 API-key strategy derives both from one API-key root using
separate HMAC domains, sends only the pseudonym and derived bearer to BugDrop, and validates the
versioned capability response. This two-output strategy boundary lets a future authentication
method prepare a different bound, privacy-safe wire subject without changing the capability request
or response shapes. API-key material, the root, and raw subjects remain private fields and never
appear in request bodies, errors, or serialization.

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

The named global identified by `data-auth-token-provider` fetches that response, extracts it, and
returns only its opaque `token` string to the hosted widget. The widget does not receive the API
key, a raw subject, or the complete capability response object. The endpoint must remain
authenticated, same-origin, and CSRF-protected.
