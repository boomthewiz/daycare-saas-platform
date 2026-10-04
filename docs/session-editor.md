# Session editor

The organization schedule links directly to `/sessions/[sessionId]/edit`. The existing administration route now links to the same editor while retaining target preparation, session cancellation and the timeline. Both routes share `SessionAdministration`; editing and persistence logic are not duplicated.

The editor loads the selected session, identifies its client and scheduled time, and presents a single details form with sticky Save and Cancel actions. Save stays on the editor and announces success or failure. Cancel returns to the selected session's administration page without writing.

Changes are not saved automatically. A dirty indicator and an accessible Keep editing / Discard changes dialog protect Cancel, Refresh, navigation links and browser Back. A same-document history entry lets Back show the dialog before the editor unmounts; clean Back skips that guard entry. The browser's standard beforeunload warning protects reload and tab/window closure. No draft is written to browser storage.

## Persistence and access

- The update filters by selected record ID, organization ID and `updated_at`, then requires one returned record. A zero-row result reports a conflict/access change and retains the draft.
- UI permission checks use the existing `can_manage_sessions` RPC. Subscription controls continue to enforce read-only UI access. The production database remains authoritative through RLS, the unlocked-device gate and lifecycle triggers.
- Historical sessions are read-only. After service starts, assignment, schedule, type and status remain locked. Metadata saves omit those fields entirely, preserving timestamp precision.
- Provider choices are scoped to the session's organization. An existing inactive/unavailable provider and an existing custom session type remain represented in the form.
- Owner accounts, email-code verification, device security, billing, pricing and trial configuration are unchanged.

## Verification

Passed locally: full Next.js production build, TypeScript, changed-file lint without warnings, and 79 security/workflow regression tests.

Browser acceptance used isolated synthetic data on desktop and at 390px mobile width (sidebar collapsed): direct editor entry, populated details, successful save, failed-save retry and draft retention, stale-version failure, Cancel without saving, Keep editing, Refresh/header-link prompts, browser Back, historical read-only controls, permission denial, subscription read-only controls, unavailable-record handling and allowed metadata editing after start. Mobile date fields have no overlapping decorative icons or horizontal overflow.

Production persistence checks used `supabase/tests/session_editor.sql`, entirely within a transaction ending in ROLLBACK. Assertions covered the correct record, untouched second record, stale version, organization boundaries, staff without permission, locked devices, started-session locks, allowed metadata changes and historical restrictions. No real session data was changed.

The approved owner production tab was inspected read-only. Little Lambs had no sessions or active clients available on the Sessions page, so the reported bottom-of-page expansion could not be reproduced with that account. Source inspection confirmed the administration form was mixed with target preparation, with no dedicated Edit route or discard handling.

## Repeat synthetic acceptance

In one PowerShell terminal:

```powershell
$env:NEXT_PUBLIC_SUPABASE_URL='http://127.0.0.1:3019'
$env:NEXT_PUBLIC_SUPABASE_ANON_KEY='synthetic-anon-key'
node node_modules/next/dist/bin/next dev --webpack --port 3017
```

In another terminal, run `node tests/session-editor.fixture.cjs`, then open `http://127.0.0.1:3018/start`. The fixture backend and proxy bind only to loopback and never connect to production. Use `http://127.0.0.1:3019/control?mode=...` for `reset`, `fail`, `conflict`, `started`, `historical`, `denied`, `readonly`, and `missing`. `/control` without a mode returns the synthetic saved record and captured update requests. Restart Next with ordinary project configuration after testing; synthetic environment values are process-local and are not committed.

The fixture is a UI acceptance surrogate, not a replacement for the real RLS/trigger test. Run `supabase/tests/session_editor.sql` through an approved SQL connection when validating persistence.
