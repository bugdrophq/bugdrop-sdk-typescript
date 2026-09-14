# `@bugdrop/browser`

Typed loader/controller for BugDrop's hosted widget. The package does not bundle or reimplement the
widget.

```ts
import { BugDrop } from '@bugdrop/browser';

const controller = BugDrop.init({
  applicationId: 'app_public_123',
  tokenProvider: async () => {
    const response = await fetch('/api/bugdrop-token', {
      method: 'POST',
      credentials: 'include',
    });
    if (!response.ok) throw new Error('Unable to authorize BugDrop');
    return response.json();
  },
});

await controller.ready;
await controller.open();
```

Only a public Application ID is accepted. Repository and privileged flow configuration are not
browser options. Capabilities are requested on demand and are never persisted by this package.
