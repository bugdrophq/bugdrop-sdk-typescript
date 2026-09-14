# Architecture

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
Application-scoped pseudonym with HMAC-SHA-256 using the Application credential, sends only that
derived value to BugDrop, and validates the versioned capability response. The credential is kept
in a JavaScript private field and is never included in request bodies, errors, or serialization.

## Future control-plane seam

The default endpoint is a provisional `v1/submission-capabilities` URL on the current BugDrop
service origin. Tests inject a `fetch` implementation and never require that unfinished endpoint.
The `endpoint` constructor option permits staging and compatibility testing without changing the
public operation. Before release, the authoritative service repository must confirm the final URL
and run the shared fixtures against the deployed implementation.

The existing hosted widget is authoritative. Its current legacy configuration requires
`data-repo`; authenticated mode instead requires the future `data-application-id` input. This SDK
deliberately does not send `data-repo` as a compatibility workaround because doing so would return
repository authority to the untrusted browser.
