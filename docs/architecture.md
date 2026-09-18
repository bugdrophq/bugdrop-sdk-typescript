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
calling the customer's provider and proxies the widget's public controller methods after its own
script loads or emits `bugdrop:ready` while executing. Other scripts' ready events cannot initialize
the SDK controller. It contains no widget UI, submission implementation, repository selection,
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

## Managed production endpoints

The server package defaults to
`https://api.bugdrop.dev/v1/submission-capabilities`. The browser package defaults to the versioned
managed widget at `https://widget.bugdrop.dev/widget.v1.js`. Tests inject a `fetch` implementation
and never depend on either deployed service. Explicit URL overrides permit staging, loopback
development, customer-controlled proxies, and future supported self-hosting without changing the
public operation. The SDK never retries against the current public Worker. Do not publish the
packages until both managed endpoints exist and the authoritative service repository passes the
shared contract fixtures against them.

The existing hosted widget is authoritative, and direct script-tag installation remains a
first-class supported method. The SDK is an additional installation and controller method. The
current direct configuration accepts `data-repo`; authenticated SDK mode instead requires the
future `data-application-id` input. This SDK deliberately does not send `data-repo` as a
compatibility workaround because doing so would return repository authority to the untrusted
browser.

## Direct script-tag installation

The current simple system remains supported. Moving an integration to Application-based
authentication is optional and manual. Creating an account or importing the SDK does not claim or
enroll an existing integration, associate its reports with an Application, or backfill managed
identity or telemetry. Existing simple integrations can continue on other pages or applications.

When deliberately migrating a page, first configure the Application and its backend token endpoint
with the customer's access controls. Then replace that page's old widget script with the chosen
managed installation and reload the page. Do not initialize both installations on the same page:
the SDK rejects an existing widget or script carrying repository/token-provider configuration,
including one that has not finished loading. The SDK does not remove the old installation for you.
Test the managed flow before completing the manual change; a managed failure never retries through
the current public system. The production-readiness gates above still apply.

Direct authenticated installation keeps the same capability boundary as `@bugdrop/browser`. The
customer's authenticated token endpoint returns the complete versioned capability response:

```json
{
  "schemaVersion": 1,
  "token": "<opaque short-lived capability>",
  "expiresAt": "2026-09-13T20:05:00.000Z"
}
```

The named global identified by `data-auth-token-provider` accepts the hosted widget's submission
binding, fetches that response, extracts it, and returns only its opaque `token` string to the
widget. The widget does not receive the API key, a customer user identifier, or the complete
capability response object. The endpoint must remain authenticated, same-origin, and
CSRF-protected when the customer application requires a signed-in reporter. Anonymous customer
applications still own their own access and abuse policy and must enforce the origin, no-cache,
payload-binding, and rate-limit requirements in the security contract.
