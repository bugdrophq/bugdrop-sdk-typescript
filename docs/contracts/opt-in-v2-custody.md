# P0 custody and replay limits — separate policy decision pending

Uninstall retention Option A does NOT approve the following P0 storage. These are
exact proposed limits requiring joint data/privacy/runtime acceptance before any
implementation, credentials or rollout. No new aggregate or indefinite fence is implied.

| Record                                                                                  | Proposed custody and clock                                                                                                       | Access and exclusion                                                                                     |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Original scope, intent, state, signing uncertainty, confirmation, capability commitment | Private P5 authority only; retentionDeadline=original reservedAt+720h; immutable across retries/recovery                         | Scoped private authority API only; absent from P6/P7 SQL, logs, traces, analytics and browser storage    |
| Client pending intent and status                                                        | Trusted server's private attempt store; deadline=original client issuedAt+720h, no refresh                                       | No key/root/authSecret/token; no browser persistence or general analytics                                |
| Historical catalog and public confirmation key                                          | Until maximum retentionDeadline of any referencing reservation+5min; max128 catalog snapshots and128 keys                        | Verification-only history; no extension of reservation evidence or credential authority                  |
| Confirmation private signing key                                                        | Active signing service only, independently reviewed key-rotation/destruction policy                                              | Historical public-key retention does not authorize retaining private keys                                |
| Original normalized delivery tuple                                                      | Atomically transferred into qualified original delivery record before acknowledging the join; existing delivery accepted_at+720h | P6/P7 receives only typed17-input command; no confirmation, intentDigest, capabilityDigest or raw intent |

Internal tenant/generation/credential/attempt references are linkable operational data.
capabilityDigest is a secret-derived protocol commitment; a signed confirmation binds
it to an intent. It is NEW custody, not anonymous telemetry or harmless public metadata.
No raw/encrypted capability token, API key, root or authSecret is persisted by this
proposal. Expiration must block all reads/joins even if physical purge is late; purge
health, backup retention, restore reconciliation, private API ACLs and deletion handling
need an exact runtime policy before approval. Bounded counts do not authorize retaining
identifiers or replacing purged evidence with long-lived aggregates.

P0 purge cannot erase the only metadata copy for already accepted delivery work. The
delivery owner must commit the immutable four-tuple together with the original scoped
acceptance record before acknowledging the join to P5. Both sides use the same original
identity; a lost acknowledgement cannot create a second delivery. If the join cannot
finish while admission evidence is valid, fail closed/unavailable; never reconstruct
versions from current builds. Delivery retention starts at original delivery acceptance,
not capability reservation, and is never refreshed by state transitions or SQL retry.

Historical A counts committed authorization, not present usability. Revocation/expiry
may make its token unusable without decrementing historical A or erasing known S.
Unknown signer state is neither a delivery indeterminate state nor a NULL version.
Missing reads, purged rows and delivery counters cannot prove S=0 or A=0.

The proposed server-side same-submission uniqueness guarantee lasts only until original
reservedAt+720h. After purge, expired ORIGINAL intent is still rejected by its signed
deadline, but a fresh attempt using the same submission ID is not indefinitely fenced.
SDK prohibition on doing that is not a service-enforced indefinite guarantee. This finite
limit needs explicit joint acceptance; if indefinite non-reopening is required, this
candidate is blocked rather than inventing permanent identifier retention. No purge,
rollback, restore or recovery may reopen the original unexpired attempt.

Legacy P7 wrapper yields four NULL values; never infer protocol1 from them. A historical
protocol1 value requires an independently qualified producer. Activity records retain
delivery clocks and cannot establish software observation freshness or issuance counts.
