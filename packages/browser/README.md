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
