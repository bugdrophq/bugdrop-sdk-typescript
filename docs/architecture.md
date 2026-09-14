# Architecture

## Repository ownership

This SDK repository owns the TypeScript packages and their compatibility fixtures.
`mean-weasel/bugdrop` owns the hosted widget, Worker, and protocol implementation. `bugdrop-web`
owns the Application-management experience and provisions the credentials consumed by this SDK and
the Worker. The web application is still under development, so its provisioning contract must be
confirmed against the fixtures here before the SDK is released.

## Package boundary

`@bugdrop/browser` and `@bugdrop/server` share only the versioned capability response contract.
The private `@bugdrop/contracts` workspace is bundled into each public package, so published
artifacts have no private runtime dependency.

The browser package creates a script element for BugDrop's hosted versioned widget, supplies
`data-application-id`, and installs a narrowly scoped global function that returns the current
short-lived capability token. It proxies the widget's public controller methods after the
`bugdrop:ready` event. It contains no widget UI, submission implementation, repository selection,
or server exchange client.

The server package owns capability issuance from the customer's perspective. It derives an
Application-scoped pseudonym with HMAC-SHA-256 using a dedicated stable subject key, sends only that
derived value to BugDrop, and validates the versioned capability response. The independently
rotatable authentication secret is used only in the Authorization header. Both server-only values
are kept in JavaScript private fields and are never included in request bodies, errors, or
serialization.

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
