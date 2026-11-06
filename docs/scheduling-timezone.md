# Explicit organization scheduling timezone

Item 2 of the October 24, 2026 implementation handoff. Stacked on scheduling-conflict PR 44 at `135aabe`. No production migration or release is included.

## Behavior

Setup and Business preferences offer a separate, explicit IANA scheduling timezone. There is no inferred device, branch, reporting, or account-model default. An owner/admin with live account-management authority and organization write access reviews and confirms the setting. The server locks the organization, checks the expected version and records the actor, previous timezone and server timestamp. Missing configuration blocks reviewed scheduling until confirmation.

Existing session/group UTC instants, roster snapshots and clinical records are untouched. Changing timezone changes their displayed civil dates/times, never their saved instants. Reporting and existing daycare attendance reporting retain their independently configured timezone. An optional personal display timezone is not introduced in this slice: scheduling displays consistently identify the organization timezone.

Calendar selection, creation, individual/group Activity editing and clinical administration use organization civil time. Create, edit and conflict review display the timezone. Repeated times require an earlier/later occurrence for new drafts; an unchanged saved occurrence remains selected. Gaps are rejected rather than normalized. Existing seconds/milliseconds survive edits. Overnight work is clipped to organization dates; query boundaries and Today counters account for 23/25-hour dates. Staff mobile schedule cards and child Activity links use the same labeled display. Mobile Today refreshes its clock each minute. Calendar clock-change ranges use an agenda with offset labels instead of drawing a misleading fixed 24-hour grid.

Open forms freeze their timezone/version. Background changes preserve entered values and block saving until reload/review. Calendar draft links also carry the selected timezone, preventing a subsequent configuration change from silently reinterpreting a dragged range. Identity/access invalidation uses the existing capability scope; settings are not persisted in device storage.

## Server contract and security

Migration `20261025012613_scheduling_timezone.sql` follows `20261023215652_account_service_model.sql` and `20261024082651_schedule_conflict_reviews.sql`. It introduces private RLS-protected settings/history, invoker public RPC wrappers, empty-search-path private implementations, and explicit execute revocations. Audit identity is server-derived. Role labels alone do not grant configuration authority.

Reviewed payloads carry `p_clock` with timezone/version and civil start/end. The server checks the live setting and exact PostgreSQL timezone roundtrip against the supplied UTC occurrence. Reviewed saves take the organization lock before checking configuration, including receipt retries. Settings updates use that same lock. Existing conflict payload/snapshot comparisons, acknowledgements, operation receipts and lifecycle guards remain in force. Older private implementations are no longer directly callable by authenticated clients; new wrappers explicitly validate even when a connection previously prepared an older function body.

The private `scheduling_day_bounds(organization, instant)` contract derives the organization-local date from an instant, uses the earliest repeated midnight and returns half-open UTC boundaries. Future day-wide absence commands must call it inside the appropriate transaction and use server time for “today”; they must not derive dates from a device or add a fixed 24 hours. No absence workflow is implemented here.

Legacy RPC/direct-table scheduling remains outside universal reviewed enforcement, as in PR 44. Item 3 must inventory and harden those paths and integrations. This migration does not reinterpret offset-free timestamps submitted by older clients or claim universal timezone enforcement across them.

## Validation and rollout

Local validation: 175 partial-regression tests passed, including four new timezone tests with synthetic PostgreSQL. Targeted checks cover traveling devices, Chicago gaps/folds, Lord Howe half-hour DST, Kathmandu offsets, saved subsecond precision, overnight clipping, 23/25-hour dates, repeated midnight, permission revocation, anonymous/tenant/subscription boundaries, stale settings and private storage. TypeScript, affected-flow lint and synthetic production webpack build pass. The three production-mode browser suites cover existing regressions; the extended group suite runs with a Tokyo browser timezone, saves the later Chicago occurrence, rejects a gap, confirms a timezone through Setup at 320px and blocks a stale draft after that change.

The native PostgreSQL suite now additionally races first timezone confirmations and a reviewed save against a settings update. It has not been rerun locally because the disposable server is unavailable; required CI must pass it. Supabase security advisor was attempted with `--local` and could not connect to `127.0.0.1:54322`. No linked/production database was queried. Automated catalog assertions verify private RLS/storage boundaries; those are not a substitute for a deployed advisor run.

Before release, reconcile production migration names/definitions, apply the approved additive migration, deploy the compatible application, and have an authorized administrator confirm the scheduling timezone. Verify authenticated previews and restricted accounts. Preserve additive settings/audit tables during an application rollback; test rollback compatibility in a disposable environment. Production migration, merge and release require separate authorization.
