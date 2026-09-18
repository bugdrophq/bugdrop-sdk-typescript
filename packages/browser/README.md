# `@bugdrop/browser`

Typed loader/controller for BugDrop's hosted widget. The package does not bundle or reimplement the
widget.

The current simple installation remains supported. Migration is optional and manual; importing
this package does not claim or enroll an existing integration. After configuring the Application
and backend token endpoint, deliberately replace the old widget script and reload the migrated
page before calling `init`. Do not run both installations on one page. See the repository
[manual migration guidance](../../docs/architecture.md#direct-script-tag-installation).

```ts
import { BugDrop } from '@bugdrop/browser';

const controller = BugDrop.init({
  applicationId: 'app_public_123',
  tokenProvider: async (binding) => {
    const response = await fetch('/api/bugdrop-token', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(binding),
    });
    if (!response.ok) throw new Error('Unable to authorize BugDrop');
    return response.json();
  },
});

await controller.ready;
await controller.open();
```

Only a public Application ID is accepted. Repository and privileged flow configuration are not
browser options. The hosted widget supplies a per-submission ID and the canonical digest of its
exact request bytes to `tokenProvider`; the package validates and forwards that binding without
adding user identity. Capabilities are requested on demand and are never persisted by this package.

The default script is the versioned managed widget at
`https://widget.bugdrop.dev/widget.v1.js`. `widgetUrl` is an explicit staging, loopback,
customer-proxy, or self-hosting override. It must use HTTPS, except on a loopback development host,
and cannot contain credentials, a query string, or a fragment. The package never falls back to the
current public widget.

## Explicit metadata opt-in entrypoint

`@bugdrop/browser/opt-in` exports `BugDropOptIn.init` with the same presentation
options and a distinct `tokenProviderWithMetadata(binding, metadata)` callback.
The callback receives the unchanged validated submission binding plus a fresh frozen
`{ metadataVersion: 1, browserSdkVersion }` object. The version comes from this
installed browser package, never from caller options, a server version, or widget URL.
The callback must return the existing short-lived capability envelope only after
its trusted backend has completed the separately qualified opt-in verification.

The ordinary `@bugdrop/browser` import and its one-argument `tokenProvider` remain
unchanged. Do not supply both callbacks or mix classic and opt-in initialization on
one page. Existing direct widget installations are not adopted. An opt-in callback
failure is redacted and never triggers loader fallback or an automatic retry. A
second callback request for the same application/submission is rejected, including
reentry, concurrent requests and requests after failure; the in-memory spent-report
set lasts for this module's page lifetime and is never written to browser storage.
This guard is not a service-enforced replay guarantee and does not survive reloads.
Do not create a replacement submission merely to retry a failed exchange.

The browser loader does not verify the issuer confirmation or implement the hosted
widget's submission transport. P1/P3 backend integration and qualified V2 verifier
and hosted-fallback rollout remain separate prerequisites. Loading this entrypoint
alone does not establish usable V2 service support or authorize publication.
