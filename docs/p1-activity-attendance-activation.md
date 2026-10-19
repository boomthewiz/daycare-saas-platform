# P1: activity scheduling and attendance activation

Current release status and migration mappings are maintained in [the October 19 release record](release-2026-10-19.md). The user has now authorized the combined P1/P2 deployment; older implementation/release restrictions below are dated history.

October 19, 2026. Implementation for review; **not deployed**. The October 18 attendance/context release remains the production baseline. This change does not authorize production migrations or deployment, and changes no customer settings, subscriptions, grants, invitations or external services.

## Scheduling decision and compatibility

`sessions.workflow_intent` explicitly distinguishes `activity` from `clinical`, independently of activity type, tag category, diagnosis or child labels. It is immutable. The default is `clinical`, preserving the behavior of existing rows, direct legacy inserts and original `create_prepared_session` / `create_context_session` callers. No historical rows, targets, notes, snapshots or attendance events are rewritten. Existing recent-detail sets also default to clinical intent.

New scheduling uses `create_scheduled_context_session` with explicit intent. An activity inserts only a confirmed schedule row: no prepared timestamp or treatment targets. Clinical intent delegates to existing clinical preparation and retains its permissions. Both paths validate current authority, tenant, device, subscription, active child/staff/type, tag selections and times; commit tag snapshots, ten current-user/org recent-detail sets and operation receipts atomically. Activity receipts include intent in their fingerprint; clinical fingerprints preserve compatibility with existing context receipts. Changing intent while reusing an operation ID is rejected. Recents include explicit intent and never copy an old date.

Ordinary activities have schedule views and schedule edits, not therapeutic start/pause/finish, target preparation, clinical notes/review or attendance-status controls. They can be canceled; this P1 does not introduce an activity completion or group-activity model. Triggers reject clinical rows/timing for activities even through existing elevated RPCs, enforce valid activity times/location length, and require current active selections when inserting or changing child/staff/type. Clinical assignment helpers and `can_access_client` ignore ordinary activities when deriving clinical access. Existing explicit care-team access is retained. A minimal `activity_schedule` RPC gives assigned staff the schedule and child display name without access to the full clinical profile. This access adjustment and the calendar/mobile routing updates are direct P1 prerequisites, not P2 expansion.

## Attendance activation

The Attendance page includes a read-only activation checklist backed by `attendance_activation`. It reads configuration only, never visits/history. It checks explicit IANA timezone, subscription editing availability, active account, independent View/Record grants and at least one active, authorized attendance branch with active child membership. Correct is optional for a recorder and never implies View. Staff locations and care-team shortcuts do not satisfy attendance scope.

Owners use existing owner authority without extra staff or scope requirements. Owner configuration, selected-recorder readiness and organization-wide rollout completeness are separate statements. A ready result means configuration permits new visits in at least one branch; it does not certify every branch, every intended recorder, or an unlocked staff device. The checklist shows each branch's gaps.

Owner/admin user-management authority permits inspecting only accounts allowed by `can_manage_org_user`; a protected owner cannot be inspected by another administrator. Administrators without View may see configuration but receive no visit data. Non-admin staff see only their own readiness and assigned branches. Setup links follow the actor's capabilities. Every setup edit remains explicit and is rechecked by existing server boundaries. Refresh, focus, capability/auth/device changes, scope saves and retry reload readiness; stale or failed requests cannot report ready.

## Forward migration and release plan

New local migration: `20261019194610_p1_activity_and_attendance_activation.sql`, generated with the Supabase CLI. No applied migration was edited. Deploy the migration before the UI: old callers remain compatible during rollout. Verify remote migration history before any approved production change; local versions of prior applied migrations differ from remote versions:

| Local | Applied remote | Migration |
|---|---|---|
| 20261017192817 | 20261018180924 | daycare_operational_reports |
| 20261017192818 | 20261018180928 | correct_canceled_onboarding_milestone |
| 20261018084149 | 20261018180932 | branch_attendance |
| 20261018084157 | 20261018180935 | session_context_tags |

Do not blindly push/reapply old migrations. A rollback must retain intent columns, guards, schedule rows, snapshots, receipts and attendance events. Reverting to the old UI would mislabel activities and offer unavailable clinical actions, so retain an activity-aware read-only view or forward-fix the UI. Never drop/reclassify activity rows to make an old client work. Fresh release authorization is required.

## Validation

Use the existing synthetic baseline/PGlite fixture. `tests/p1-activation-db.test.cjs` fails clearly if its prerequisites are missing. It covers explicit and legacy paths, targets/receipts/tags/recents, clinical mutation denial, unchanged historical intent, activity-derived clinical access, foreign/stale selections, device/subscription/grant restrictions and configuration-only readiness. The shared foundations fixture applies the new migration for attendance/context regressions. Browser coverage extends `tests/attendance-context.browser.cjs` using intercepted synthetic Supabase HTTP into that isolated database; no production credentials or customer data are used.

Exact final commands/results are recorded in the PR. Native PostgreSQL concurrency requires the isolated server on `127.0.0.1:55439`; absence is not a passing concurrency result.

Verified locally: 143 regression tests passed with zero failures/skips (native concurrency file excluded), focused P1/foundations database checks, seven focused calendar/inventory checks, synthetic browser flows, TypeScript and the production webpack build. Changed-file ESLint has zero errors and only the three pre-existing mobile-session warnings. Default Turbopack cannot follow this checkout's linked `node_modules`, so validation uses `next build --webpack`; builds use synthetic Supabase public/service keys and fetch the app's existing fonts. Next's generated repository `AGENTS.md`/`CLAUDE.md` guidance is retained after dev verification.

## P2 queue — next, in order

1. Saved-choice server pagination/search by kind/query; independently resolve selected/recent/new IDs (the 500-choice omission remains).
2. Preserve attendance screen state while freshly authorizing export; retain lock/auth cancellation.
3. Interrupted session-save recovery across response loss/reload/retry without casual browser storage of child/session data.
4. Saved-choice rename/archive/duplicate lifecycle with immutable snapshots and reconciled uniqueness; favorites/filters afterward.
5. Organization-local attendance correction inputs with DST ambiguity handling and server validation.
6. Reproducible required CI/test setup, failing clearly when external prerequisites are absent.
7. Broader current release documentation and migration mappings, preserving dated history.
8. Legacy Tasks joins, local-day semantics and visible error/retry handling before D5 reporting.

Classroom enrollment, guardian/pickup authority, daily-care sharing, caregiver competency and broader clinical/analytics models remain later work.
