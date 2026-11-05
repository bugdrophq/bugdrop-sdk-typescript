# Managed capability adapters

The additive `@bugdrop/server/adapter` and `@bugdrop/server/node` entries support Node20+.
The SDK still uses Node crypto. The Web Request/Response interface can support future hosting
adapters; edge runtimes have not been qualified. Existing clients, defaults, and examples are unchanged.

```ts
import { createCapabilityHandler } from '@bugdrop/server/adapter';

export const POST = createCapabilityHandler({
  enabled: process.env.BUGDROP_ENABLED === '1',
  mode: 'anonymous',
  origin: 'https://app.example.com',
  apiKey: process.env.BUGDROP_API_KEY,
});
```

Mount this handler at exactly `/api/bugdrop-capability/v1/`. A custom `path` is used exactly,
including its trailing slash. Do not let a body parser consume the request. The configured origin
must be a canonical HTTPS origin (HTTP loopback is supported locally). Requests must match the
origin, path, POST method, `Origin`, `Content-Type: application/json`, and
`Sec-Fetch-Site: same-origin`. Encoded bodies are rejected. No CORS access is granted.

Native Node servers use the same options:

```ts
import { createServer } from 'node:http';
import { createNodeCapabilityHandler } from '@bugdrop/server/node';

createServer(
  createNodeCapabilityHandler({
    enabled: true,
    mode: 'anonymous',
    origin: 'http://bugdrop.localhost:3000',
    apiKey: process.env.BUGDROP_API_KEY,
  })
).listen(3000);
```

Mount before body middleware. The wrapper rejects duplicate raw headers, mismatched Host,
consumed streams, and ambiguous envelopes. Forwarded headers never select authority. A client
disconnect cancels the Web request; no response is written after disconnect.

For a Vercel Node API function, the route file can export the wrapper directly:

```ts
import { createNodeCapabilityHandler } from '@bugdrop/server/node';

export const config = { api: { bodyParser: false } };
export default createNodeCapabilityHandler({
  enabled: process.env.BUGDROP_ENABLED === '1',
  mode: 'anonymous',
  origin: 'https://app.example.com',
  apiKey: process.env.BUGDROP_API_KEY,
});
```

Configure routing to preserve the exact selected path, including its trailing slash. Verify that
the deployed runtime passes the raw, unread request: a framework's body-parser option alone does
not establish this for every platform helper or runtime version. Foil's current Vercel setup also
uses `NODEJS_HELPERS=0` in its build and runtime configuration. The adapter rejects an already
consumed stream; it cannot recover the original bytes. Keep reporting disabled while qualifying
a new host's request boundary.

Other hosts should delegate to the same Web handler or Node wrapper. A future host adapter owns
only request/response translation, raw-byte preservation and disconnect signals. It must not
duplicate authorization policy, service endpoints, deadlines or capability parsing. Hosting
support requires testing that boundary; a Web-shaped interface alone does not qualify an edge
runtime or a provider-specific routing layer.

Anonymous mode deliberately has no session or CSRF requirement. Managed durable admission still
applies. For authenticated applications select `mode: 'customer-policy'` and supply
`policy(request, binding)`. Only literal `true` authorizes. Enforce your session, CSRF, access,
rate limits, and atomic submission-ID/digest reuse there. The binding is frozen and contains only
`submissionId` and `payloadDigest`; the request body has already been consumed. Policies should
honor `request.signal`. Cancellation cannot undo external side effects performed by a policy.

```ts
import { createAnonymousTokenProvider, createCustomerPolicyTokenProvider } from '@bugdrop/browser';

const anonymous = createAnonymousTokenProvider();
const authenticated = createCustomerPolicyTokenProvider(() => readCustomerCsrfToken());
// Pass the selected function to BugDrop.init({ applicationId, tokenProvider }).
```

The CSRF source is required for the customer provider; its value must be 1–256 printable ASCII
characters without spaces. Anonymous requests use `credentials: 'omit'`; customer requests use
`'same-origin'` and `X-BugDrop-CSRF-Token`. Both accept `{ path, signal }` options. The signal
cancels provider requests; use a fresh controller for a new lifecycle. No cookies or tokens are
stored by these providers. Browser fetches reject redirects.

The server requires `enabled === true` and otherwise returns 404/no-store before body reads or
client initialization. It always requests and requires confirmation of `managed-v1` admission.
Its endpoint defaults to `https://managed.bugdrop.dev/v1/submission-capabilities`.
The optional `environment` constraint is omitted unless explicitly configured. Supply it only
when it exactly matches the environment assigned by the capability service; a production
deployment does not imply a `production` authorization environment. A null authority environment
requires omission. It makes one exchange, with no retries.
The total server deadline is 18 seconds, covering body, policy, client authentication, exchange and
response reading, even if asynchronous dependencies ignore abort. A final transport guard prevents
late issuer contact after cancellation. JavaScript must yield for timers to run.

Binding input is limited to 1024 raw bytes, strict UTF8, two exact fields, valid nonempty UTF8
submission IDs up to 200 bytes, and a canonical SHA 256 base64url digest. Duplicate names,
including escaped aliases, unknown fields, malformed lengths and invalid UTF8 are rejected.
Browser requests are limited to 1024 bytes; response bodies to 32768 bytes, including response
reading within the 25-second deadline. Existing SDK capability validation remains authoritative.

Failures return a generic 502/no-store without upstream details. An optional `observeFailure`
receives one frozen allowlisted diagnostic per failed invocation: enumerated phase/reason,
issuer-contact boolean, optional valid HTTP status and boolean checks. No default logger is
installed. Observer exceptions and rejected promises do not affect authorization. Never add keys,
bindings, bodies, header values, URLs or error text to diagnostics.
