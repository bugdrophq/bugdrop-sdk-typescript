# P6/P7/P8 delivery projection — review candidate

Source pin: web `0c5ce62f85a88c61fa9605d54f7689f435194c04`, effective
`20260916233500_require_credential_activation.sql:3–4` and
`20260916224638_managed_contracts.sql:198–200`. Data owner supplied these exact source
signatures. No SQL migration, producer or live account DTO is implemented by P0.

## Proposed command and provenance

P6 queue body exact keys `schemaVersion:2, command:"ingest_outcome_v2", arguments`.
Arguments is an ordered array of EXACTLY17 typed values, in this order:

| Position | SQL parameter                                    | Wire value                                                               |
| -------- | ------------------------------------------------ | ------------------------------------------------------------------------ |
| 1–5      | t, a, i, d, c                                    | tenant/application/internal installation/destination/credential UUID     |
| 6–7      | event_hash, submission_hash                      | existing keyed receipt commitments, lowercase64hex                       |
| 8–9      | accepted_at, occurred_at                         | canonical UTC ISO timestamp with milliseconds                            |
| 10       | state                                            | authorized, delivering, delivered, failed_before_delivery, indeterminate |
| 11       | reason                                           | existing outcome_reason enum                                             |
| 12       | is_test                                          | boolean                                                                  |
| 13       | correlation_id                                   | UUID                                                                     |
| 14–16    | sdk_version, browser_sdk_version, widget_version | normalized stable version or null                                        |
| 17       | protocol_version                                 | 2 for this opt-in command                                                |

Existing reason enum: none, github_rate_limited, github_unavailable, permission_denied,
repository_unavailable, issues_disabled, credential_rejected,
attachment_processing_failed, origin_rejected, internal_error, unknown.
No arbitrary bag, SQL string, extra fields or raw token/intent/feedback/header data.
Public app string and internal application UUID are distinct; map only through accepted
original authority. Fixture UUIDs/hashes are synthetic, not real keyed provenance.

The four values come unchanged from the original admitted intent. Delivery acceptance
is a later event: accepted_at is the ORIGINAL delivery-acceptance time, not reservation,
capability admission, queue dispatch, SQL ingestion or UI read time. occurred_at is the
qualified outcome transition time. Neither may be reconstructed from current time during
retry. Original accepted_at+720h is the existing outcome deadline; it is independent of
P0 intent expiry and reservation retention. Missing provenance blocks dispatch.

An issuance pending marker alone CANNOT create an authorized delivery outcome. P5 retains
the immutable admission tuple for a later generation-bound delivery join; P6 emits this
command only once a separately qualified original delivery record supplies all13
existing values. A lost capability response may therefore have admission evidence and
NO delivery row. Do not label missing delivery as zero mint or failed issuance.
The delivery producer/join API is an explicit remaining runtime dependency.

P5 alone owns marker state and acknowledgement. P6 sends the same original command on
transport ambiguity, never signs or delivers a report. Acknowledge only after confirmed
SQL transaction completion and accepted ingest result. Unknown COMMIT keeps pending.
Malformed/immutable-conflicting commands quarantine without changed identity; expired
commands become unavailable/incomplete, not fresh events. Exact SQL result allowlist,
authenticated queue transport, keyed commitment source, retry scheduling and dead-letter
custody require P6/P7 review before implementation; the17-value vector does not supply
those mechanisms. No direct runtime table grant is implied.

## Activity projection and display semantics

Append four columns to the existing security-invoker view, exact14-column order:
`id,tenant_id,application_id,destination_id,accepted_at,occurred_at,state,reason,
is_test,correlation_id,sdk_version,browser_sdk_version,widget_version,protocol_version`.
Existing view filters expires_at>now(); preserve RLS, caller session and no-store.
Existing13-input SQL wrapper supplies all four NULL. No backfill or later enrichment.
All four properties are present in a valid V2 read row; NULL means no reported known
value, never infer from another field. Missing/wrong-type fields invalidate the report
read; they do not become NULL. Historical protocol1 and NULL may be displayed where
authorized by P7, while this opt-in fixture carries2.

Use four independent labels: Reported server SDK, Reported browser SDK, Reported widget,
Reported issuance protocol. These are claims, not binary attestation or currently
installed versions. Widget remains NULL. accepted_at is delivery acceptance;
occurred_at is outcome event time, NOT version-observed freshness. Show those accurately
labeled historical times; no fresh/current/stale threshold or derived observation time.

Display states remain distinct: loading; records; empty (successful read, no rows);
unavailable/error (no report evidence); account denied (clear all held/rendered rows).
They are UI states, not extra columns or a newly invented account RPC. P7/P8 must freeze
the authorized read surface; do not infer an application summary from activity rows or
treat an existing static mock usage panel as live. No version/report values enter
analytics. Read failures never expose raw SQL/provider errors or stale prior-tenant data.

The accompanying fixture pins field order, separate clocks and the normalized tuple.
It is a contract example only; it does not prove a working queue, database query or UI.
