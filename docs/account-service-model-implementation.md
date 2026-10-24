# Account service model and intent-aware scheduling

Implementation for review, October 23, 2026. Based on production merge `86213b8`; no production migration, merge or deployment is part of this change.

## Behavior

Existing organizations remain unconfirmed (no settings row, version 0). No labels, roles, subscription plans or historical records are used to classify them. Setup onboarding and Business preferences show an explicit choice, preview, current version and last server-recorded actor/time. Confirmation saves only this setting.

Daycare starts with daily Classes and a group Activity draft. ABA starts with clinical detail and a clinical draft. Mixed starts with All and requires a visible scheduling-type choice. Unconfirmed retains the ordinary individual Activity default. Every focus remains available, including All as the route to existing future work. Changing focus does not change day/week/range, permissions or account configuration. Staff focus is scoped to the current user/organization in memory; persistent personal preferences and branch overrides are deferred.

Clinical filtering uses saved workflow intent, while group shape distinguishes individual and group Activities. The Activities focus includes both Activity shapes and excludes clinical sessions. Calendar and schedule-list labels explicitly distinguish ABA session, Individual Activity and Group Activity, independent of vocabulary. Clinical administration/execution uses fixed ABA session nouns while retaining other display vocabulary.

Calendar selections capture start/end before the Mixed/Activities choice. All choices carry those values into the asynchronous form. Selecting a saved type or recent details preserves an explicitly selected end. Native start/end fields remain editable. Scheduling still uses browser-local time; organization-timezone reporting is unchanged.

## Authority and storage review

Migration: `supabase/migrations/20261023215652_account_service_model.sql`, created by the installed CLI. It is additive and must be reviewed/applied separately before the application release. Reconcile production migration names/definitions rather than replaying older local timestamps.

Two private RPC-only tables hold the current confirmed model and append-only history. Missing state means unconfirmed. Both tables have RLS and no direct anonymous/authenticated access. Public RPCs are invoker wrappers; private implementations use an empty search path and explicit live identity/tenant/device checks. Audit actor and timestamp are server-derived.

The writer reuses the privileged configuration authority in `attendance_activation` (`20261019194610_p1_activity_and_attendance_activation.sql`): `can_manage_users()` AND current role owner/admin. `has_org_permission` (`20261018084149_branch_attendance.sql`) grants owners authority and requires an actual grant for nonowners. An Administrator label alone and the legacy unused `can_manage_settings` column grant nothing. This intentionally does not reuse the broader appearance policy (client OR session management), which controls presentation vocabulary.

The writer also requires current organization write access and an explicit matching organization ID. It locks the organization row before comparing the expected integer version, including the first confirmation. Concurrent editors cannot silently overwrite each other. No client supplies audit actors. Settings changes never update session intent, target/note tables, group snapshots, timestamps, grants, module flags or subscriptions.

The provider scopes results by verified actor and organization, discards outdated responses, preserves equal result references on routine checks, and clears availability on capability invalidation or a failed read. Existing capability/setup refresh behavior is retained. In-progress forms do not change workflow when a routine model refresh arrives. Identity/tenant changes reset scoped defaults and new-draft state.

## Verification and release boundary

Synthetic tests extend the existing foundations fixture. They cover all four states × three record kinds × manager/assigned/unauthorized actors; explicit confirmation/audit; grant, tenant, anonymous, locked-device and expired-subscription denials; stale versions; preserved record/snapshot contents; saved-intent filtering; and unchanged legacy DST/midnight parsing/placement tests. Existing Classes tests retain archived-roster, receipt/retry/cancel fencing, note separation and event-count coverage.

The existing browser/database flow additionally confirms Daycare/ABA/Mixed defaults, Mixed's empty direct-link choice, all three drag-choice routes with retained 09:00–10:30 times, and retained times after changing workflow. Existing synthetic field checks delay capability, setup and service-model requests while checking that walkthrough/checklist/navigation stay mounted. Native PostgreSQL coverage races two first confirmations and requires exactly one history row. CI runs native races and the required production-mode browser flows; local partial tests are not a substitute for CI.

No live overlap detector is added. C4 remains open; no conflict-prevention, attendance, staffing coverage, ratio, payroll or clinical billing claim is introduced. Account model is a defaults setting, not clinical eligibility or module activation. All clinical and group write/read endpoints retain their existing authorization and receipts.
