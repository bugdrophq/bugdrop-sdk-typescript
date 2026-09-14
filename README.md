# BugDrop TypeScript SDK

Official TypeScript packages for adding authenticated BugDrop feedback to an application.

- `@bugdrop/browser` loads and controls the hosted BugDrop widget.
- `@bugdrop/server` exchanges a server-only Application credential for a short-lived submission
  capability after your application authenticates its user.

This repository is an early, non-published foundation. The capability service and the
Application-aware hosted widget must ship before these packages are production-ready. The seams for
both are implemented and tested without embedding a mock control plane in either package.

## Security model

The Application ID is public. The secret key belongs only in backend code. Your token endpoint must
authenticate the current user and use your usual same-origin and CSRF protections before calling
BugDrop. Send a stable opaque user ID—not an email address or name—to the server SDK; it is
pseudonymized locally before the request leaves your backend.

```ts
// Server-only code
import { BugDrop } from '@bugdrop/server';

const bugdrop = new BugDrop({
  secretKey: process.env.BUGDROP_SECRET_KEY,
});

export async function POST(request: Request): Promise<Response> {
  const user = await requireCurrentUser(request); // must reject unauthenticated requests
  const capability = await bugdrop.createSubmissionToken({ subject: user.id });
  return Response.json(capability);
}
```

```ts
// Browser code
import { BugDrop } from '@bugdrop/browser';

BugDrop.init({
  applicationId: 'app_public_123',
  tokenProvider: async () => {
    const response = await fetch('/api/bugdrop-token', {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-CSRF-Token': readCsrfToken() },
    });
    if (!response.ok) throw new Error('Unable to authorize BugDrop');
    return response.json();
  },
});
```

Do not accept repository, installation, labels, flow permissions, or origin overrides from the
browser. Those values are resolved from the Application on BugDrop's servers.

## Development

Repository development requires Node.js 20.19 or newer. The published server package targets
Node.js 20 or newer.

```sh
npm ci
npm run validate
```

No command in this repository publishes or deploys packages. See [architecture](docs/architecture.md),
[protocol](docs/protocol.md), and the package-specific READMEs for details.
