# BugDrop TypeScript SDK

Official TypeScript packages for adding authenticated BugDrop feedback to an application. The SDK
is an additional installation method; BugDrop's direct script-tag installation remains supported.

- `@bugdrop/browser` loads and controls the hosted BugDrop widget.
- `@bugdrop/server` exchanges a server-only Application credential for a short-lived submission
  capability after your application applies its own access controls.

This repository is an early, non-published foundation. The capability service and the
Application-aware hosted widget must ship before these packages are production-ready. The seams for
both are implemented and tested without embedding a mock control plane in either package.

## Security model

The Application ID is public. `BUGDROP_API_KEY` belongs only in backend code. BugDrop authenticates
the Application represented by that credential; it does not authenticate, identify, suspend, or
track the people using the customer application. Your token endpoint must apply your application's
own authentication, authorization, suspension, abuse-prevention, and user-specific rate limits,
along with its usual same-origin and CSRF protections, before calling BugDrop.

```ts
// Server-only code
import { BugDrop } from '@bugdrop/server';

const bugdrop = new BugDrop({ apiKey: process.env.BUGDROP_API_KEY });

export async function POST(request: Request): Promise<Response> {
  await requireAuthorizedUser(request); // application-owned access control
  const { submissionId, payloadDigest } = await request.json();
  const capability = await bugdrop.createSubmissionToken({ submissionId, payloadDigest });
  return Response.json(capability);
}
```

```ts
// Browser code
import { BugDrop } from '@bugdrop/browser';

BugDrop.init({
  applicationId: 'app_public_123',
  tokenProvider: async (binding) => {
    const response = await fetch('/api/bugdrop-token', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': readCsrfToken(),
      },
      body: JSON.stringify(binding),
    });
    if (!response.ok) throw new Error('Unable to authorize BugDrop');
    return response.json();
  },
});
```

Do not accept repository, installation, labels, flow permissions, or origin overrides from the
browser. Those values are resolved from the Application on BugDrop's servers.

The SDK derives an Application authentication bearer from the API key and never sends the complete
key or its root secret to BugDrop. The capability request contains no customer user identifier.
BugDrop may enforce protections at the Application, credential, network/IP, replay, payload, and
platform levels, but user-specific enforcement remains entirely with the customer application. Each
capability is bound to a per-submission ID and the SHA-256 digest of the exact submission request
bytes; neither value may identify or be derived from a customer user.

Direct script-tag installation remains supported as a first-class alternative to the SDK. Its
authenticated provider returns only the opaque token string to the widget; see the
[architecture](docs/architecture.md#direct-script-tag-installation) for the complete boundary.

## Development

Repository development requires Node.js 20.19 or newer. The published server package targets
Node.js 20 or newer.

```sh
npm ci
npm run validate
```

No command in this repository publishes or deploys packages. See [architecture](docs/architecture.md),
[protocol](docs/protocol.md), and the package-specific READMEs for details.
