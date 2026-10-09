# Next.js owned-application dogfood

Use this App Router integration with an existing application that already has a reporter-access
policy. It connects the browser widget to the tested [V1 backend handler](../../examples/v1-backend/README.md).
The packages are unpublished previews. This guide does not enable managed delivery or prove that a
particular Application is ready to send.

## 1. Pin and install both packages

Check out the SDK revision agreed with the dogfood operator. In that checkout:

```sh
npm ci
npm run build
mkdir -p artifacts
npm pack -w @bugdrop/browser --pack-destination artifacts
npm pack -w @bugdrop/server --pack-destination artifacts
```

In your Next.js project, install those exact tarballs and commit the resulting lockfile:

```sh
npm install /absolute/path/to/sdk/artifacts/bugdrop-browser-0.1.0.tgz \
  /absolute/path/to/sdk/artifacts/bugdrop-server-0.1.0.tgz
```

Keep the tarballs available to your build system; an absolute local dependency path alone will not
work on a remote builder. Record the source commit alongside the artifacts, since preview builds can
share a package version. The packages include their compiled contract code; no contracts package
needs to be installed separately. No command above publishes either package.

Copy `examples/v1-backend/handler.ts` and `transport.ts` from the **same revision** into
`src/lib/bugdrop/` in your application. These helpers are example source, not package exports.
Keep `handler.ts` in the server import graph and import only `transport.ts` from browser code.

## 2. Configure the existing Application

From the protected account, review the Application's saved origin, public Application ID, selected
repository and API key status. Use the **public** `app_…` identifier for browser initialization, not
the internal ID in the account page URL. A pending key cannot issue capabilities. Store an
acknowledged server key in your secret manager as `BUGDROP_API_KEY`; never use a `NEXT_PUBLIC_`
prefix for this key.

Set server-only `APPLICATION_ORIGIN` to the exact saved origin and
`BUGDROP_CAPABILITY_ENDPOINT` to the operator-provided staging issuer URL. Supply the matching
operator-provided staging widget script URL as the browser's `widgetUrl`. Do not rely on production
default endpoints for staging. The origin must match the externally visible request URL, including
its port; do not derive it from untrusted forwarding headers.

An active key or a configured Application is stored configuration evidence. The operator must
separately confirm the issuer, ingress and test-delivery window for this exact Application.

## 3. Mount the server route

Create `src/app/api/bugdrop-capability/v1/route.ts`:

```ts
import { createV1Handler } from '@/lib/bugdrop/handler';
import { verifyCustomerPolicyAndBinding } from '@/lib/feedback-policy';

export const runtime = 'nodejs';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error('Missing server configuration');
  return value;
}

export async function POST(request: Request): Promise<Response> {
  try {
    // Initialize during the request so build-time page collection needs no key.
    const handle = createV1Handler(
      {
        apiKey: required('BUGDROP_API_KEY'),
        origin: required('APPLICATION_ORIGIN'),
        endpoint: required('BUGDROP_CAPABILITY_ENDPOINT'),
        environment: 'staging',
      },
      verifyCustomerPolicyAndBinding
    );
    return await handle(request);
  } catch {
    return Response.json(
      { error: 'unable_to_authorize_bugdrop' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
```

`verifyCustomerPolicyAndBinding(request, binding)` is an application-owned implementation that must
return `true` only after all of the following succeed:

- Validate the current session, reporter authorization and suspension state.
- Compare `X-BugDrop-CSRF-Token` with the session's expected CSRF value.
- Apply per-user/session and network abuse limits.
- Atomically bind `submissionId` to `payloadDigest` in durable customer storage within the
  authorized session/user scope. Allow the same binding on an explicit retry; reject a changed digest
  or use by another session. Keep this record across processes and deployments for the applicable
  submission/replay lifetime.

There is no default allow policy. Do not deploy a placeholder returning `true` or a process-local
Map. Anonymous reporting needs its own explicit authorization/abuse policy. Customer identity,
session cookies and CSRF values stay in your application; the handler forwards only the validated
binding and configured origin/environment to the server SDK.

The handler checks the exact request URL and Origin, content type and encoding, a 1,024-byte body
limit, duplicate/extra JSON keys and binding format before calling your policy. All handler denials
and upstream failures are redacted no-store responses; it never falls back to a local token or
retries an exchange. Set body-read, policy and total request timeouts and concurrency limits at your
HTTP deployment boundary too. Do not log bodies, API keys, capabilities or upstream responses.

## 4. Connect a browser control

Create a Client Component such as `src/components/feedback-button.tsx`. Implement
`readCurrentCustomerCsrfToken` using your application's current session; it must return the same
CSRF token your server policy expects, not the BugDrop API key.

```tsx
'use client';

import { useState } from 'react';
import { BugDrop } from '@bugdrop/browser';
import { createV1TokenProvider } from '@/lib/bugdrop/transport';
import { readCurrentCustomerCsrfToken } from '@/lib/customer-csrf';

export function FeedbackButton({
  applicationId,
  widgetUrl,
}: {
  applicationId: string;
  widgetUrl: string;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function open() {
    setPending(true);
    setError('');
    try {
      const controller = BugDrop.init({
        applicationId,
        widgetUrl,
        button: false,
        tokenProvider: createV1TokenProvider(readCurrentCustomerCsrfToken),
      });
      await controller.open();
    } catch {
      setError('Feedback could not open. Please try again later.');
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <button type="button" onClick={open} disabled={pending}>
        {pending ? 'Opening feedback…' : 'Send feedback'}
      </button>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
```

Pass only the public Application ID and widget URL into this component. Initialize one Application
per page and remove any older BugDrop script from that page. The transport uses the current origin
and the exact `/api/bugdrop-capability/v1` path, with a bounded response and deadline. It forwards no
repository, labels or user identity. The hosted widget supplies the exact submission binding; do
not regenerate it in the token provider. Opening the widget is not a delivery test.

## 5. Accept one controlled delivery

Before enabling a test window, verify signed-out, foreign-origin and wrong-CSRF requests are denied
without contacting the issuer. Check that neither rendered HTML nor your browser bundle contains
the server key. Do not use real user feedback in the first test.

Once the operator enables **test** delivery for this Application, send one synthetic report from its
saved origin. Acceptance requires one labeled Issue in the selected repository, the widget's
successful receipt, and the corresponding **Delivered / Test** record in the protected account.
An empty or unavailable activity page is not success. Missing version metadata is not proof of the
software revision; retain the artifact/source revision separately.

If a response is lost, use the widget's **Check result** action for that existing report. Preserve its
submission ID and exact bytes, and permit the same binding in your customer policy. Do not create a
new report to resolve uncertainty or automatically retry an indeterminate outcome; ask the operator
to reconcile it. End the bounded test window when the agreed report is complete. Formal attempt
counting, crash/retention qualification and pilot admission are separate acceptance gates.

For a fully runnable local rehearsal without a customer policy implementation or remote service,
use `npm run example:v1:loopback -- --state-dir /absolute/private/bugdrop-loopback-state` in the SDK
checkout. That fixture uses a widget double and local issuer; it creates no GitHub Issue and does
not replace the hosted acceptance above. The [HTTPS fixture](../../examples/hosted-fixture/README.md)
is the separate controlled staging reference with a concrete session/CSRF and durable-binding policy.
