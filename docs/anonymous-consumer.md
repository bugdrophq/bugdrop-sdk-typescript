# Anonymous SDK install for an owner app

Preparation only: packages are not published and this bundle does not activate reporting.
Visitors do not need accounts. Use the existing V1 SDK and hosted widget; do not enable V2 or
migrate existing report history for this installation.

Build a reproducible private candidate from committed source:

```sh
npm ci
npm run validate
npm run beta:bundle -- /absolute/new/anonymous-bundle --anonymous
npm run beta:check -- /absolute/new/anonymous-bundle
```

The bundle contains the regular browser/server SDK packages, lockfile, provenance and four
integration files. Verify its provenance before installing. It is a private installable preview,
not a published npm release; registry publication remains a separate approval step.

Mount `capabilityEndpoint` from `src/server.ts` at POST `/api/bugdrop-capability/v1`.
Supply `apiKey`, exact saved `origin`, approved issuer `endpoint`, and `enabled: false` until
activation approval. Keep the API key server-side. Supply the operator-provided durable `admit`
adapter: it must bind the original submission ID/digest and rate-limit exchanges. Never substitute
an in-memory map or unconditional true. Its storage and application ID are server configuration,
not browser input. Origin checks protect browser requests; they do not authenticate visitors.
Set body-read, admission and connection deadlines in your server adapter.

After approval, mount `mountFeedback({ applicationId, widgetUrl })` from `src/browser.ts`.
Only these public values reach the browser. The transport sends no session cookies or CSRF token,
never retries, and preserves the original report binding. Handle `controller.ready` failures visibly.
An authorization error is not proof that no capability was issued: do not retry automatically.

The operator registers the new app and its exact origin/destination once, connects its activity
scope, and routes attempts to the existing shared five-per-Phoenix-day owner budget. Adding an app
must not reset or replace that budget or change old report identities. API keys, admission storage,
reporting activation and SDK publication are not provisioned by this bundle.
