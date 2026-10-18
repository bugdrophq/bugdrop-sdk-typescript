# Anonymous managed SDK install

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

Mount `managedCapabilityEndpoint` from `src/server.ts` at POST `/api/bugdrop-capability/v1`:

```ts
const handle = managedCapabilityEndpoint({
  apiKey: process.env.BUGDROP_API_KEY,
  origin: 'https://your-app.example',
  endpoint: 'https://api.bugdrop.dev/v1/submission-capabilities',
  enabled: false,
});
```

Use your registered exact origin and operator-approved endpoint. Keep the app API key server-side.
No database credentials, database adapter, or visitor sign-in are required. BugDrop must support
and enable the `managed-v1` admission contract before activation: the helper rejects a missing
confirmation, including responses from an older service. It never falls back or retries.
Keep `enabled: false` until activation approval. Origin and same-origin Fetch Metadata checks
protect browser requests; they do not authenticate visitors or prevent non-browser spam.
The managed service authenticates the app, limits capability exchanges, and durably binds each
report ID to its original content. Delivery still enforces the configured report budget.
Set body-read and connection deadlines in your server adapter.

Existing installations using `capabilityEndpoint(options, admit)` retain their durable adapter.
Do not switch those installations or remove their checks as part of installing this candidate.

After approval, mount `mountFeedback({ applicationId, widgetUrl })` from `src/browser.ts`.
Only these public values reach the browser. The transport sends no session cookies or CSRF token,
never retries, and preserves the original report binding. Handle `controller.ready` failures visibly.
An authorization error is not proof that no capability was issued: do not retry automatically.

The operator registers the new app and its exact origin/destination once, connects its activity
scope, and configures its reporting budget. For the existing owner dogfood apps, preserve the
shared five-per-Phoenix-day budget. Adding an app
must not reset or replace that budget or change old report identities. API keys, admission storage,
reporting activation and SDK publication are not provisioned by this bundle.
