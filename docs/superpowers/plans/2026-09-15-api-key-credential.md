# Single API-Key Credential Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the unpublished two-key server SDK API with one versioned `BUGDROP_API_KEY` that produces domain-separated request authentication and key-epoch subject pseudonyms.

**Architecture:** A focused server-only module strictly parses the API key and prepares both a privacy-safe wire subject and request-authentication headers. The existing server client consumes that internal strategy, while the browser/widget capability boundary remains unchanged. Canonical protocol documentation and deterministic fixtures become the handoff contract for later `bugdrop-web` provisioning and `mean-weasel/bugdrop` Worker implementation.

**Tech Stack:** TypeScript 5.7, Node.js 20 `node:crypto`, Vitest 4, tsup, ESLint, Prettier, Knip

**Spec:** `docs/superpowers/specs/2026-09-15-api-key-credential-design.md`

## Global Constraints

- Work only in `bugdrop-sdk-typescript`; `bugdrop-web` and `mean-weasel/bugdrop` require separate implementation plans.
- Expose exactly one customer-managed server credential through `apiKey` and `BUGDROP_API_KEY`.
- Accept only `bd_api_v1.<key-id>.<root-secret>` where key ID is 16 random bytes and root secret is 32 random bytes, both canonical unpadded base64url.
- Derive authentication with HMAC-SHA-256 over `bugdrop:auth:v1\0` plus the textual key ID.
- Derive the wire subject with HMAC-SHA-256 over `bugdrop:subject:v1\0` plus the exact UTF-8 subject bytes.
- Accept subjects from 1 through 1024 UTF-8 bytes without trimming, case folding, or Unicode normalization; reject malformed Unicode.
- API-key rotation intentionally starts a new pseudonymous identity epoch.
- Never send the complete API key, root secret, or raw subject over the network or expose them through errors, serialization, or browser artifacts.
- Keep the browser and capability response authentication-method agnostic; do not implement BYOA in this plan.
- Keep production and test files at or below 300 non-blank, non-comment lines and functions at or below 150 lines.
- Add no dependency. If an unforeseen dependency becomes necessary, pin it exactly and commit `package-lock.json`.
- Finish with `npm run validate`, including `npm run test:security`, before declaring completion.

## File Structure

- Create `packages/server/src/api-key.ts`: strict key parsing, UTF-8 subject validation, domain-separated HMAC derivation, and the internal request-identity strategy.
- Create `test/api-key.test.ts`: deterministic vectors, malformed credentials, byte boundaries, rotation behavior, and redaction assertions.
- Create `packages/contracts/fixtures/api-key-credential.v1.json`: cross-repository V1 credential vector with non-production bytes and expected outputs.
- Modify `packages/server/src/index.ts`: migrate the public constructor to `apiKey` and consume the internal strategy.
- Modify `test/server.test.ts`: prove the complete capability exchange uses the derived bearer and pseudonym without leaking inputs.
- Modify `test/browser.test.ts`: reject `apiKey` as a browser option.
- Modify `packages/contracts/fixtures/widget-public-api.v1.json`: make the direct token-provider hook
  part of the cross-repository widget fixture.
- Modify `scripts/verify-browser-boundary.mjs`: detect the new credential names, prefixes, and server cryptography in browser output.
- Modify `README.md`, `packages/server/README.md`, `docs/architecture.md`, `docs/protocol.md`, and `docs/security.md`: make the one-key model canonical and document BYOA-safe boundaries.
- Delete `packages/contracts/fixtures/subject-pseudonym.v1.json`: remove the superseded two-key vector.

---

### Task 1: Build the API-Key Strategy and Compatibility Vector

**Files:**

- Create: `packages/contracts/fixtures/api-key-credential.v1.json`
- Create: `test/api-key.test.ts`
- Create: `packages/server/src/api-key.ts`

**Interfaces:**

- Consumes: Node.js `createHmac`, canonical UTF-8 strings, and the V1 credential fixture.
- Produces: `createApiKeyStrategy(apiKey: string | undefined): CapabilityIdentityStrategy`.
- Produces: `CapabilityIdentityStrategy.prepareIdentity(subject: string): PreparedCapabilityIdentity`.
- Produces: `PreparedCapabilityIdentity.wireSubject: string` and `authenticateRequest(request: CanonicalCapabilityRequest): Promise<Readonly<Record<string, string>>>`.

- [ ] **Step 1: Add the deterministic non-production fixture**

Create `packages/contracts/fixtures/api-key-credential.v1.json` with these exact bytes and outputs:

```json
{
  "schemaVersion": 1,
  "apiKey": "bd_api_v1.AAECAwQFBgcICQoLDA0ODw.EBESExQVFhcYGRobHB0eHyAhIiMkJSYnKCkqKywtLi8",
  "keyId": "AAECAwQFBgcICQoLDA0ODw",
  "rootSecret": "EBESExQVFhcYGRobHB0eHyAhIiMkJSYnKCkqKywtLi8",
  "authSecret": "mrJiVKhkJz8d7tNgPkSTl2tRDQ840gImsfUvb1q0ZPo",
  "authorization": "Bearer bd_auth_v1.AAECAwQFBgcICQoLDA0ODw.mrJiVKhkJz8d7tNgPkSTl2tRDQ840gImsfUvb1q0ZPo",
  "subject": "customer-user-42",
  "pseudonym": "bdsub_v1_08psm1IhAUrRpPrvO5cnL4DIl-zMB1-CP3nKvNFMuR4"
}
```

- [ ] **Step 2: Write failing API-key strategy tests**

Create `test/api-key.test.ts` with tests equivalent to the following complete behaviors:

```ts
import fixture from '../packages/contracts/fixtures/api-key-credential.v1.json';
import { describe, expect, it } from 'vitest';
import { createApiKeyStrategy } from '../packages/server/src/api-key.js';

const request = {
  method: 'POST' as const,
  url: 'https://bugdrop.example/v1/submission-capabilities',
  body: '{"schemaVersion":1}',
};
const rotatedApiKey =
  'bd_api_v1.AAECAwQFBgcICQoLDA0ODw.MDEyMzQ1Njc4OTo7PD0-P0BBQkNERUZHSElKS0xNTk8';

describe('V1 API-key strategy', () => {
  it('matches the shared authentication and subject vector', async () => {
    const identity = createApiKeyStrategy(fixture.apiKey).prepareIdentity(fixture.subject);
    expect(identity.wireSubject).toBe(fixture.pseudonym);
    await expect(identity.authenticateRequest(request)).resolves.toEqual({
      Authorization: fixture.authorization,
    });
  });

  it('keeps a subject stable within one key epoch and resets it on rotation', () => {
    const strategy = createApiKeyStrategy(fixture.apiKey);
    expect(strategy.prepareIdentity(fixture.subject).wireSubject).toBe(
      strategy.prepareIdentity(fixture.subject).wireSubject
    );
    expect(strategy.prepareIdentity('another-user').wireSubject).not.toBe(fixture.pseudonym);
    expect(
      createApiKeyStrategy(rotatedApiKey).prepareIdentity(fixture.subject).wireSubject
    ).not.toBe(fixture.pseudonym);
  });

  it.each([
    undefined,
    '',
    ` ${fixture.apiKey}`,
    fixture.apiKey.replace('bd_api_v1', 'bd_api_v2'),
    `${fixture.apiKey}.extra`,
    fixture.apiKey.replace('AAECAwQFBgcICQoLDA0ODw', 'AAECAwQFBgcICQoLDA0OD!'),
    fixture.apiKey.slice(0, -1),
  ])('rejects malformed API key %# without echoing it', (apiKey) => {
    expect(() => createApiKeyStrategy(apiKey)).toThrow('valid API key');
    try {
      createApiKeyStrategy(apiKey);
    } catch (error) {
      expect(String(error)).not.toContain(String(apiKey));
    }
  });

  it('enforces exact UTF-8 byte limits without normalization', () => {
    const strategy = createApiKeyStrategy(fixture.apiKey);
    expect(strategy.prepareIdentity('é'.repeat(512)).wireSubject).toMatch(/^bdsub_v1_/);
    expect(() => strategy.prepareIdentity('é'.repeat(512) + 'a')).toThrow('subject');
    expect(() => strategy.prepareIdentity('')).toThrow('subject');
    expect(() => strategy.prepareIdentity('\ud800')).toThrow('subject');
    expect(strategy.prepareIdentity('é').wireSubject).not.toBe(
      strategy.prepareIdentity('e\u0301').wireSubject
    );
  });
});
```

- [ ] **Step 3: Run the focused test and confirm the red state**

Run:

```bash
npm exec -- vitest run test/api-key.test.ts
```

Expected: FAIL because `packages/server/src/api-key.ts` does not exist.

- [ ] **Step 4: Implement strict parsing and domain-separated preparation**

Create `packages/server/src/api-key.ts` with this responsibility and API:

```ts
import { createHmac } from 'node:crypto';

const API_KEY_PREFIX = 'bd_api_v1';
const AUTH_PREFIX = 'bd_auth_v1';
const SUBJECT_PREFIX = 'bdsub_v1_';
const AUTH_DOMAIN = 'bugdrop:auth:v1\0';
const SUBJECT_DOMAIN = 'bugdrop:subject:v1\0';

export interface CanonicalCapabilityRequest {
  method: 'POST';
  url: string;
  body: string;
}

export interface PreparedCapabilityIdentity {
  wireSubject: string;
  authenticateRequest(
    request: CanonicalCapabilityRequest
  ): Promise<Readonly<Record<string, string>>>;
}

export interface CapabilityIdentityStrategy {
  prepareIdentity(subject: string): PreparedCapabilityIdentity;
}

export function createApiKeyStrategy(apiKey: string | undefined): CapabilityIdentityStrategy {
  const [prefix, keyId, encodedRoot, extra] = typeof apiKey === 'string' ? apiKey.split('.') : [];
  if (
    prefix !== API_KEY_PREFIX ||
    extra !== undefined ||
    keyId === undefined ||
    encodedRoot === undefined ||
    apiKey !== apiKey?.trim()
  ) {
    throw invalidApiKey();
  }

  decodeCanonicalBase64url(keyId, 16);
  const rootSecret = decodeCanonicalBase64url(encodedRoot, 32);
  const authSecret = createHmac('sha256', rootSecret)
    .update(AUTH_DOMAIN)
    .update(keyId, 'utf8')
    .digest('base64url');
  const authorization = `Bearer ${AUTH_PREFIX}.${keyId}.${authSecret}`;

  return Object.freeze({
    prepareIdentity(subject: string): PreparedCapabilityIdentity {
      const subjectBytes = encodeValidSubject(subject);
      const digest = createHmac('sha256', rootSecret)
        .update(SUBJECT_DOMAIN)
        .update(subjectBytes)
        .digest('base64url');
      return Object.freeze({
        wireSubject: `${SUBJECT_PREFIX}${digest}`,
        async authenticateRequest(_request: CanonicalCapabilityRequest) {
          return { Authorization: authorization };
        },
      });
    },
  });
}

function decodeCanonicalBase64url(value: string, byteLength: number): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw invalidApiKey();
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.length !== byteLength || decoded.toString('base64url') !== value) {
    throw invalidApiKey();
  }
  return decoded;
}

function encodeValidSubject(value: string): Buffer {
  if (typeof value !== 'string') throw new TypeError('subject must be a valid opaque identifier');
  const encoded = Buffer.from(value, 'utf8');
  if (encoded.length === 0 || encoded.length > 1_024 || encoded.toString('utf8') !== value) {
    throw new TypeError('subject must be 1-1024 valid UTF-8 bytes');
  }
  return encoded;
}

function invalidApiKey(): TypeError {
  return new TypeError('BugDrop requires a valid API key');
}
```

Keep `_request` in the internal method signature even though V1 static bearer authentication does
not consume it. This preserves room for future request-bound authentication without changing the
server client's request assembly.

- [ ] **Step 5: Run the focused tests and static checks**

Run:

```bash
npm exec -- vitest run test/api-key.test.ts
npm run typecheck
npm run lint
```

Expected: all API-key tests pass; TypeScript and ESLint exit 0.

- [ ] **Step 6: Commit the credential primitive**

```bash
git add packages/contracts/fixtures/api-key-credential.v1.json packages/server/src/api-key.ts test/api-key.test.ts
git commit -m "feat(server): add versioned API-key strategy"
```

---

### Task 2: Migrate the Server Client and Harden the Browser Boundary

**Files:**

- Modify: `packages/server/src/index.ts`
- Modify: `test/server.test.ts`
- Modify: `test/browser.test.ts`
- Modify: `packages/contracts/fixtures/widget-public-api.v1.json`
- Modify: `scripts/verify-browser-boundary.mjs`

**Interfaces:**

- Consumes: `createApiKeyStrategy(apiKey)` and its two-phase `prepareIdentity(subject)` /
  `authenticateRequest(request)` result from Task 1.
- Produces: `new BugDrop({ apiKey, endpoint?, timeoutMs?, fetch? })`.
- Preserves: `createSubmissionToken({ subject, origin?, environment?, signal? })` and the existing
  `SubmissionCapability` response.

- [ ] **Step 1: Rewrite the server exchange test to express the new public API**

In `test/server.test.ts`, import `api-key-credential.v1.json`, remove imports and constants for
`pseudonymizeSubject`, `secretKey`, and `subjectKey`, and make the primary exchange test assert:

```ts
const client = new BugDrop({ apiKey: fixture.apiKey, fetch });

await client.createSubmissionToken({
  subject: fixture.subject,
  origin: 'https://app.example.com',
  environment: 'production',
});

const [url, init] = fetch.mock.calls[0]!;
const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
expect(body).toEqual({
  schemaVersion: 1,
  subject: fixture.pseudonym,
  origin: 'https://app.example.com',
  environment: 'production',
});
expect(init?.headers).toMatchObject({
  Accept: 'application/vnd.bugdrop.submission-capability.v1+json',
  Authorization: fixture.authorization,
  'Content-Type': 'application/json',
  'X-BugDrop-Contract-Version': '1',
});
expect(JSON.stringify({ url, init })).not.toContain(fixture.subject);
expect(JSON.stringify({ url, init })).not.toContain(fixture.apiKey);
expect(JSON.stringify({ url, init })).not.toContain(fixture.rootSecret);
```

Replace every remaining `new BugDrop({ secretKey, subjectKey, ... })` with
`new BugDrop({ apiKey: fixture.apiKey, ... })`. Replace the old stable-across-secret-rotation test
with a test asserting two valid API keys produce different body pseudonyms for the same subject.
Replace invalid separate-key constructor cases with invalid `apiKey` cases. Leave endpoint,
authority-selector, timeout, response-validation, and redaction coverage intact.

- [ ] **Step 2: Update browser-facing tests and the security checker before implementation**

Extend `packages/contracts/fixtures/widget-public-api.v1.json` with this exact sibling to `methods`:

```json
"authentication": {
  "providerDataAttribute": "data-auth-token-provider",
  "providerDatasetProperty": "authTokenProvider",
  "providerReturnType": "opaque-token-string"
}
```

In the primary loader test in `test/browser.test.ts`, assert the actual script dataset property is
the fixture's `providerDatasetProperty`, then retain the existing assertion that invoking the named
provider resolves to `capability.token`, a string rather than the complete capability object.

```ts
const providerProperty = widgetApiFixture.authentication
  .providerDatasetProperty as 'authTokenProvider';
const providerName = script!.dataset[providerProperty]!;
expect(widgetApiFixture.authentication.providerDataAttribute).toBe('data-auth-token-provider');
expect(widgetApiFixture.authentication.providerReturnType).toBe('opaque-token-string');
const installedProvider = window[providerName as `__bugdropSdkTokenProvider_${string}`];
expect(await installedProvider!()).toBe(capability.token);
```

In `test/browser.test.ts`, change the unsupported browser configuration assertion from `secretKey`
to:

```ts
...({ apiKey: 'must-not-enter-browser-config' } as Record<string, unknown>)
```

In `scripts/verify-browser-boundary.mjs`, replace the obsolete secret markers with the complete new
set:

```js
const forbidden = [
  '@bugdrop/server',
  'BUGDROP_API_KEY',
  'NEXT_PUBLIC_BUGDROP_API_KEY',
  'VITE_BUGDROP_API_KEY',
  'bd_api_v1',
  'bd_auth_v1',
  'apiKey',
  'data-repo',
  'categoryLabels',
  'installationId',
  'GITHUB_TOKEN',
  'SUPABASE_SERVICE_ROLE',
];
```

Change the esbuild sentinel definition to:

```js
define: {
  'process.env.NEXT_PUBLIC_BUGDROP_API_KEY': JSON.stringify(
    'browser-build-api-key-sentinel'
  ),
},
```

Update both sentinel checks to use `browser-build-api-key-sentinel`. Extend the server browser
condition assertion so `serverBrowserText` must not contain `bd_api_v1` or `bd_auth_v1` in addition
to `node:crypto` and `Authorization`.

- [ ] **Step 3: Run the server test and confirm the red state**

Run:

```bash
npm exec -- vitest run test/server.test.ts test/browser.test.ts
```

Expected: FAIL because `BugDropServerOptions` still requires `secretKey` and `subjectKey`, and the
server still emits the old Authorization value and pseudonym.

- [ ] **Step 4: Migrate `BugDrop` to the internal strategy**

In `packages/server/src/index.ts`:

1. Remove `createHmac`, `SUBJECT_DOMAIN_SEPARATOR`, `pseudonymizeSubject`, and the local
   `validateSubject` function.
2. Import `createApiKeyStrategy` plus `CapabilityIdentityStrategy` from `./api-key.js`.
3. Replace the public options and private secret fields with:

```ts
export interface BugDropServerOptions {
  apiKey: string | undefined;
  endpoint?: string;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}

export class BugDrop {
  readonly #identityStrategy: CapabilityIdentityStrategy;
  readonly #endpoint: string;
  readonly #timeoutMs: number;
  readonly #fetch: typeof globalThis.fetch;
```

4. In the constructor, replace both secret validations and assignments with:

```ts
this.#identityStrategy = createApiKeyStrategy(options.apiKey);
```

5. Change request preparation to occur before `fetch`:

```ts
const identity = this.#identityStrategy.prepareIdentity(options.subject);
const requestBody = createRequestBody(options, identity.wireSubject);
const body = JSON.stringify(requestBody);
const authenticationHeaders = await identity.authenticateRequest({
  method: 'POST',
  url: this.#endpoint,
  body,
});
```

6. Replace the fixed bearer with `...authenticationHeaders`, and pass the already serialized
   `body`:

```ts
headers: {
  Accept: BUGDROP_CAPABILITY_MEDIA_TYPE,
  'Content-Type': 'application/json',
  'X-BugDrop-Contract-Version': String(BUGDROP_CONTRACT_VERSION),
  ...authenticationHeaders,
},
body,
```

7. Change `createRequestBody` to accept `wireSubject: string` and assign it directly:

```ts
function createRequestBody(
  options: CreateSubmissionTokenOptions,
  wireSubject: string
): SubmissionCapabilityRequest {
  if (!options || typeof options !== 'object') {
    throw new TypeError('createSubmissionToken requires an options object');
  }
  assertOnlyKeys(options, ['subject', 'origin', 'environment', 'signal']);
  const body: SubmissionCapabilityRequest = {
    schemaVersion: BUGDROP_CONTRACT_VERSION,
    subject: wireSubject,
  };
  if (options.origin !== undefined) body.origin = validateOrigin(options.origin);
  if (options.environment !== undefined) {
    body.environment = validateEnvironment(options.environment);
  }
  return body;
}
```

Do not publicly export the credential strategy or restore the old `pseudonymizeSubject` helper. The
packages are unpublished, so the two-key API is removed rather than deprecated.

- [ ] **Step 5: Run focused exchange and browser tests**

Run:

```bash
npm exec -- vitest run test/api-key.test.ts test/server.test.ts test/browser.test.ts
npm run typecheck
npm run lint
```

Expected: focused tests, TypeScript, and ESLint all pass. Confirm both modified TypeScript test files
remain below the enforced 300-line limit.

- [ ] **Step 6: Prove the browser artifact boundary**

Run:

```bash
npm run test:security
```

Expected: builds succeed and the checker reports that the browser security boundary passed. This is
the strongest relevant failure mode because a server API key in a browser artifact would grant
capability-issuance authority.

- [ ] **Step 7: Commit the server API migration**

```bash
git add packages/server/src/index.ts test/server.test.ts test/browser.test.ts \
  packages/contracts/fixtures/widget-public-api.v1.json scripts/verify-browser-boundary.mjs
git commit -m "feat(server): use one API key for capability identity"
```

---

### Task 3: Make the One-Key Protocol Canonical and Remove Two-Key Artifacts

**Files:**

- Modify: `README.md`
- Modify: `packages/server/README.md`
- Modify: `docs/architecture.md`
- Modify: `docs/protocol.md`
- Modify: `docs/security.md`
- Modify: `docs/superpowers/specs/2026-09-15-api-key-credential-design.md`
- Delete: `packages/contracts/fixtures/subject-pseudonym.v1.json`

**Interfaces:**

- Consumes: the exact fixture, constructor, and request behavior implemented by Tasks 1 and 2.
- Produces: the canonical SDK/protocol documentation consumed by `bugdrop-web` and
  `mean-weasel/bugdrop` implementers.
- Preserves: direct script-tag installation and the widget's string-returning
  `data-auth-token-provider` contract.

- [ ] **Step 1: Delete the superseded fixture and prove references fail**

Delete `packages/contracts/fixtures/subject-pseudonym.v1.json`, then run:

```bash
rg -n "subject-pseudonym|BUGDROP_SUBJECT_KEY|subjectKey|BUGDROP_SECRET_KEY|secretKey" \
  README.md packages test docs/architecture.md docs/protocol.md docs/security.md
```

Expected before documentation cleanup: matches only in the files listed for this task; no production
code or current tests should still reference the two-key API after Task 2.

- [ ] **Step 2: Rewrite the canonical protocol with exact V1 bytes**

Update `docs/protocol.md` to include all of these normative requirements:

```text
API key: bd_api_v1.<16-byte-base64url-key-id>.<32-byte-base64url-root>
auth secret: HMAC-SHA-256(root, UTF8("bugdrop:auth:v1\0" + keyId))
Authorization: Bearer bd_auth_v1.<keyId>.<base64url-auth-secret>
wire subject: bdsub_v1_<base64url HMAC-SHA-256(root,
              UTF8("bugdrop:subject:v1\0" + exactSubject))>
subject size: 1-1024 valid UTF-8 bytes
```

State that the full API key, root, and raw subject never cross the network. State that pseudonyms are
stable only within one API-key epoch, rotation resets pseudonym-based limits/blocks, and concurrent
old/new keys temporarily split per-user counters. Link the compatibility fixture by path. Keep the
capability request/response body independent from the authentication strategy so future BYOA can
prepare a different bound, privacy-safe wire subject without changing those shapes.

- [ ] **Step 3: Update architecture, security, and installation documentation**

Make these exact conceptual changes:

- `README.md`: show `new BugDrop({ apiKey: process.env.BUGDROP_API_KEY })`; retain
  `createSubmissionToken({ subject: user.id })`; explain that rotation begins a new identity epoch.
- `packages/server/README.md`: document the one API key, exact server-only environment variable, and
  the fact that the SDK sends only a derived bearer and pseudonym.
- `docs/architecture.md`: record repository ownership (`bugdrop-web` provisioning,
  `mean-weasel/bugdrop` Worker/widget/protocol, this repository SDK/fixtures); describe the internal
  two-output strategy boundary; retain script-tag installation as first-class.
- `docs/security.md`: require authenticated same-origin/CSRF-protected customer token endpoints;
  prohibit public framework prefixes for `BUGDROP_API_KEY`; document key-epoch resets and the need
  for customer-side per-user limits during rotation overlap.
- Design spec: change its status to
  `SDK implementation complete; cross-repository consumption pending` only after all implementation
  and canonical documentation checks pass.

Document the direct authenticated script flow precisely: the customer endpoint returns
`{ schemaVersion, token, expiresAt }`, while the named `data-auth-token-provider` global extracts and
returns only the opaque `token` string to the widget.

- [ ] **Step 4: Verify obsolete terminology is gone from active surfaces**

Run:

```bash
rg -n "subject-pseudonym|BUGDROP_SUBJECT_KEY|subjectKey|BUGDROP_SECRET_KEY|secretKey" \
  README.md packages test docs/architecture.md docs/protocol.md docs/security.md
```

Expected: no matches. Historical discussion in the approved spec and implementation plan may retain
the old names solely when explaining the unpublished migration.

- [ ] **Step 5: Run the entire repository validation gate**

Run:

```bash
npm run validate
git diff --check origin/main..HEAD
```

Expected:

- ESLint, Prettier, TypeScript, Knip, audit, and workflow policy checks pass.
- Every Vitest file passes and all coverage thresholds remain satisfied.
- `npm run test:security` proves the API key, derived bearer markers, and server cryptography are
  absent from browser artifacts.
- Both publishable package dry-runs succeed.
- The diff contains no whitespace errors.

- [ ] **Step 6: Commit the canonical protocol migration**

```bash
git add README.md packages/server/README.md docs/architecture.md docs/protocol.md docs/security.md \
  docs/superpowers/specs/2026-09-15-api-key-credential-design.md \
  packages/contracts/fixtures/subject-pseudonym.v1.json
git commit -m "docs: make single API-key flow canonical"
```

After committing, verify `git status --short` is empty. Do not publish, deploy, provision credentials,
or modify either external repository from this plan.

---

## Cross-Repository Handoff After This Plan

This SDK plan intentionally stops after producing the canonical fixture and client behavior. Before
claiming end-to-end V1 support:

1. Create a `bugdrop-web` design and plan for generating the exact API-key format, displaying it
   once, storing the derived-authentication digest in the authoritative credential registry, and
   managing `active` / `retiring` / `revoked` lifecycle states with the specified 60-second
   propagation bound.
2. Create a `mean-weasel/bugdrop` design and plan for consuming the fixture, validating the derived
   bearer in constant time, resolving Application configuration, applying Application/pseudonym
   limits, enforcing the same revocation propagation bound, and issuing the existing capability
   response.
3. Run the same compatibility vector in all three repositories before changing the SDK design status
   from cross-repository consumption pending to V1 compatible.
