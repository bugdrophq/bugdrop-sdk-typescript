# SDK API-Key Credential Design

**Status:** Approved direction; implementation pending  
**Date:** 2026-09-15

## Decision

BugDrop V1 exposes one server-side `BUGDROP_API_KEY` to an SDK integrator. The server package accepts
that value through one `apiKey` constructor option. It uses domain-separated cryptographic outputs
for request authentication and subject pseudonymization, but the customer manages only one key.

A pseudonymous subject remains stable for the lifetime of an API key. Rotating the API key starts a
new pseudonymous identity epoch. Per-user rate-limit counters, blocks, and other state keyed by the
old pseudonym do not automatically carry into the new epoch.

## Goals

- Give customers one server-only credential and one environment variable.
- Let BugDrop rate-limit an end user without receiving the customer's raw user identifier.
- Keep authentication material and subject pseudonymization cryptographically domain-separated.
- Make API-key rotation and its identity-reset behavior explicit.
- Preserve direct script-tag installation as a first-class installation method; the SDK remains an
  additional authenticated installation method.

## Non-goals

- Preserving end-user pseudonyms across API-key rotation.
- Long-term identity migration or aliasing between key epochs.
- Bring-your-own-authentication (BYOA), which is post-V1.
- Provisioning credentials in `mean-weasel/bugdrop`.
- Sending raw user identifiers to BugDrop.

BYOA is not implemented in V1, but V1 must not couple the browser or capability contract to API-key
authentication in a way that makes BYOA a breaking change.

## Public SDK API

The server package exposes one credential option:

```ts
import { BugDrop } from '@bugdrop/server';

const bugdrop = new BugDrop({
  apiKey: process.env.BUGDROP_API_KEY,
});

const capability = await bugdrop.createSubmissionToken({
  subject: currentUser.id,
});
```

`subject` is the integrating application's existing stable, opaque user identifier. It must not be
an email address, display name, or profile object. Customers do not create or store a separate
BugDrop-specific user ID. V1 accepts 1–1024 UTF-8 bytes and hashes those exact bytes without
trimming, case folding, or Unicode normalization; integrators must therefore provide the same
canonical identifier representation on every call.

The SDK pseudonymizes `subject` before making the capability request. Neither the raw subject nor
the API-key root secret may appear in the request, browser bundle, logs, serialization, or errors.

## Credential Format and Derivation

`bugdrop-web` generates a versioned credential containing:

- a 16-byte cryptographically random key identifier; and
- a 32-byte cryptographically random root secret.

Both byte strings use unpadded base64url. The customer-facing format is:

```text
bd_api_v1.<key-id>.<root-secret>
```

Base64url does not contain `.`, making the three segments unambiguous and copy-safe. The SDK
requires the exact prefix, segment count, encoded lengths, alphabet, and decoded byte lengths.

The SDK derives separate values from the root secret using HMAC-SHA-256 and fixed V1 domain
separators:

- `auth-secret = HMAC-SHA-256(root-secret, UTF8("bugdrop:auth:v1\0" + key-id))`
- `subject-digest = HMAC-SHA-256(root-secret, UTF8("bugdrop:subject:v1\0" + subject))`

HMAC outputs use unpadded base64url. The request carries:

```text
Authorization: Bearer bd_auth_v1.<key-id>.<auth-secret>
```

The request body carries `bdsub_v1_<subject-digest>` as its pseudonym.

The complete API key and root secret are never transmitted. The SDK sends only the public key
identifier and derived authentication bearer in the Authorization header. Because authentication
and pseudonymization use separate domains, disclosure of the transmitted bearer does not disclose
the root secret or permit computing subject pseudonyms.

Compatibility fixtures contain non-production input and expected output vectors for the precise
encoding and byte-level derivation. Unsupported versions, non-canonical encodings, whitespace,
truncated components, and unexpected segments fail locally before a network request.

## Request and Rate-Limit Flow

1. The customer's token endpoint authenticates its current user and applies its own per-user rate
   limit.
2. `@bugdrop/server` derives a pseudonym from `BUGDROP_API_KEY` and the customer's opaque subject.
3. The SDK authenticates to the Worker using the key identifier and derived bearer.
4. The Worker validates the credential, resolves the Application's server-side configuration, and
   applies Application- and pseudonym-level limits.
5. The Worker returns a short-lived capability scoped to that Application and pseudonym.
6. The browser SDK supplies the capability to the hosted widget without persisting or placing it in
   a URL.
7. Submission handling applies capability, upload, network, and global abuse limits.

BugDrop's per-user rate-limit key is scoped by Application and pseudonym. It is stable while the API
key is stable. Multiple concurrently active API keys produce different pseudonyms for the same end
user; a short deployment overlap can therefore temporarily split per-user counters. Application,
network, and customer-side limits remain in effect during that overlap.

## Rotation and Revocation

`bugdrop-web` owns Application management and API-key provisioning. It displays a newly generated
API key once. Its credential record contains the key identifier, Application identifier, a
SHA-256 digest of the high-entropy derived authentication secret, lifecycle status, and relevant
timestamps. It does not retain the root secret or any subject-derived value. The Worker performs a
constant-time comparison against the stored authentication digest.

Rotation creates a new key identifier and root secret, beginning a new pseudonymous identity epoch.
The old credential may remain valid for a short, explicit deployment grace period and is then
revoked. The UI and documentation warn that rotation resets pseudonym-based limits and blocks.

Revocation immediately prevents new capability issuance for that key. Previously issued
capabilities remain valid only until their short expiry unless the Worker supports immediate
capability-family revocation within the same V1 scope.

## Repository Ownership

- `bugdrop-sdk-typescript` owns the public TypeScript APIs, local derivation, strict credential
  parsing, documentation, and compatibility fixtures.
- `bugdrop-web` owns Application management plus API-key creation, display, rotation, and revocation.
- `mean-weasel/bugdrop` owns the hosted widget, Worker, protocol implementation, credential
  validation, capability issuance, and submission-side enforcement.

Cross-repository behavior is not considered compatible until each implementation passes the same
V1 fixtures.

## Future Authentication Extensibility

Capability issuance authentication is a replaceable server-side concern. The capability request
body, capability response, browser `tokenProvider`, and hosted-widget integration remain independent
of the authentication method used between the customer backend and BugDrop.

The V1 `apiKey` constructor option is the only public authentication method. Internally,
`@bugdrop/server` keeps credential parsing and Authorization-header creation behind an
authentication strategy boundary. A later BYOA release can add a mutually exclusive `auth` option
without removing or changing `apiKey`, for example:

```ts
new BugDrop({
  auth: {
    type: 'byoa',
    getAssertion: async () => customerSignedAssertion,
  },
});
```

The precise BYOA assertion type and validation rules are intentionally deferred. A BYOA assertion
is presented only by the customer backend to the capability endpoint. It is never passed to the
browser SDK or hosted widget. The Worker validates the configured authentication strategy and then
issues the same BugDrop capability shape used by API-key authentication.

Both SDK packages remain optional conveniences under BYOA. `@bugdrop/browser` still provides hosted
widget loading, token delivery, controller methods, and event integration. `@bugdrop/server` can
provide assertion acquisition, safe capability exchange, validation, timeouts, and redacted errors.
An integrator may instead use the documented HTTP protocol and direct script-tag installation.

## Errors and Security Boundaries

- Invalid or missing API keys fail before `fetch` is called.
- Remote bodies and network exception details are never included in SDK errors.
- The API key, derived bearer, raw subject, and capability are redacted from observable errors and
  serialization.
- The browser package cannot accept, import, or bundle the API key or server package.
- Callers cannot supply Application IDs, repositories, installations, labels, or privileged flow
  configuration to the capability exchange.
- Pseudonyms are pseudonymous identifiers, not anonymous data, and receive appropriate retention
  and access controls.

## Migration from the Unpublished API

The packages are not yet published, so the existing `secretKey` and `subjectKey` constructor options
are removed without a compatibility shim. Examples and environment variables move to `apiKey` and
`BUGDROP_API_KEY`. The standalone subject-key fixture is replaced by a credential fixture that
covers parsing, authentication derivation, and subject pseudonymization together.

There is no V1 option to preserve pseudonyms generated by the unpublished two-key design.

## Validation

The implementation must add tests proving:

- the same key and subject produce the same pseudonym;
- different subjects produce different pseudonyms;
- a rotated key produces a different pseudonym for the same subject;
- exact subject bytes are preserved without implicit normalization;
- authentication and subject outputs use distinct domains;
- the raw subject and API-key root never appear in serialized requests;
- malformed and unsupported credentials fail before network access;
- authorization failures and reflected remote errors do not leak secrets;
- browser builds remain free of server credentials and Node cryptography;
- shared fixtures pass in the SDK, `bugdrop-web`, and the Worker; and
- the repository's full `npm run validate` and `npm run test:security` gates pass.

## Alternatives Considered

### Separate authentication and subject keys

This preserves pseudonymous identity through ordinary authentication-key rotation, but adds a
second customer-managed secret and a separate lifecycle. V1 does not require enough durable
per-user identity to justify that complexity.

### No subject or per-user identity

This is the smallest and most private protocol, but BugDrop could enforce only Application,
capability, and network limits. The selected design retains pseudonymous per-user enforcement while
keeping the customer-facing credential surface to one key.

### Customer-stored BugDrop user IDs

Assigning every end user a permanent BugDrop-specific ID eliminates keyed pseudonymization, but
requires database changes in every integrating application and sends a persistent identifier to
BugDrop directly. That is a worse V1 integration experience.
