# Clinical access coverage — November 6, 2026

This slice extends the deployed program-definition boundary to existing clinical sessions, copied targets, measurements, notes, historical snapshots, review and current report/CSV paths. It does not validate clinical practice, introduce claims or family sharing, activate support or payments, or establish overall pilot/compliance readiness.

## Authority

Existing reviewed organization ABA enablement and explicit user program-read approval are necessary for clinical record access and delivery. They are not sufficient: all existing tenant, child eligibility, provider assignment, reviewer/action, device, billing, note version and immutable-history checks still apply. Program-edit remains necessary for reusable definition and clinical category editing; it is not required for an assigned teacher to record delivery. No grants are seeded or broadened. Owners and administrators without explicit approval deny. Care-team and session assignments retain roster eligibility but do not create clinical authority.

Existing service-model settings are presentation defaults only. Missing enablement/grants deny; ordinary Activities and Classes remain available through existing permissions. Existing clinical records and intent are preserved. An actor whose grant is revoked cannot finish clinical delivery using billing continuity alone. Billing continuity remains independently bounded for actors who retain clinical authority.

## Access matrix

| Surface / entrypoint | Source / authority in this slice | Enforcement and evidence |
|---|---|---|
| Child targets / behaviors / reusable behavior RPC | `client_targets`, `client_behaviors`, `apply_client_behavior` | Existing PR47 restrictive RLS and definer-write trigger; source/destination client eligibility remains required |
| Clinical category setup | `target_categories` | Restrictive read/write policies plus definer-write trigger; category UI hidden without clinical access; no grant inferred from Manage clients |
| Calendar, Sessions, My Sessions, child schedule links, detail/edit | `sessions` with immutable `workflow_intent` | Restrictive policy intersects existing rules on all operations; trigger covers elevated writes; Activities bypass only the additional clinical gate |
| Creation / preparation | `create_prepared_session`, `create_context_session`, `create_scheduled_context_session`, `prepare_session_targets` | Guard executes before reads, inserts, copied definitions or receipt returns; target snapshot remains immutable relative to definition edits |
| Reviewed creation / schedule updates | `schedule_conflicts`, `save_reviewed_schedule`, predecessor/internal writers | Clinical proposals and existing clinical IDs require current access; all actual writes also pass triggers; timezone, review permits, operation receipts and cancellation fences retained |
| Scheduling context / interrupted-save recovery | `session_context`, `session_context_v2`, `recover_session_creation` | Deny inaccessible session IDs; omit clinical recents without child-level approval; recheck access before returning committed clinical receipt IDs |
| Start/pause/resume/finish | `start_assigned_session`, `pause_assigned_session`, `resume_assigned_session`, `finish_assigned_session` | Added guard before existing assigned-provider and subscription controls; write trigger independently checks access |
| Prepared targets and reorder | `session_targets`, `swap_session_targets` | Restrictive RLS, trigger and explicit RPC guard; existing preparation/state/order controls retained |
| Responses | `target_responses`, `record_target_response` | Resolve target to session inside privileged guard before any response read/write; existing provider and value rules retained |
| Behavior measurement / undo | `behavior_events`, `record_behavior_event`, `undo_latest_behavior_event` | RLS, trigger and RPC guard; behavior/source binding retained; missing measurements are not converted to zero |
| Note drafts, submit/review/return/approve/lock/unlock | `session_notes`, `mutate_session_note`, legacy note RPCs | RLS and trigger plus guard before RPC reads and receipt replay; current author/reviewer/admin action rules, locks and optimistic versions retained |
| Remarks and immutable snapshots | `session_note_remarks`, `session_note_history`, `append_session_note_remark` | Same session-level gate, including JSON snapshots and operation payloads; existing append-only controls retained |
| Clinical delivery and completion routes | `/session/[id]`, `/session/[id]/complete` | Capability boundary prevents rendering clinical controls without explicit approval; database remains authoritative |
| Review list/detail | `/reviews`, `/reviews/[id]` | Capability boundary and navigation filter; all note/table reads independently restricted |
| Daycare schedule controls and tours | Sessions and calendar | Clinical workflow choices hidden; deep-link intent cannot override capability; ordinary Activity guide replaces target/timer/note guide |
| D3 current operational report and CSV | `operational_report`, `OperationalReports`, `reportCsv` | SECURITY INVOKER source reads use session RLS; CSV serializes only the authorized returned page; no separate export bypass |
| D1/D2, attendance/group reports | Roster, staff, attendance and group activity sources | Existing source/permission rules remain; these paths do not read clinical measurements, notes or snapshots |
| Clinical summaries in documentation UI | Session targets/responses/behavior reads in `SessionNoteWorkspace` | Same restricted tables; no service-role export API exists in this repository |
| Setup milestone | `onboarding_progress` scheduled boolean | Clinical session existence counts only with child-level clinical read access; ordinary activity milestone remains available |
| Care teams / shared vocabulary / session types | `care_context`, care member/group RPCs, shared session choices | Shared operational metadata remains available through existing permissions; no module/grant mutation or clinical record authority is created |
| Conflict occupancy | Private conflict snapshots / public count-only summary | Preserve collision detection against all occupied records; public result exposes aggregate overlap/uncertainty counts, no clinical content, target data or hidden session identity |
| HTTP API routes / views | Repository `app/api`; production public view catalog | No clinical content/export HTTP handler or public view identified in preflight; app uses caller-authenticated Data API and RPCs |

## Concurrency and verification

Clinical mutations lock the enablement and current user grant rows in shared mode, held through the transaction, and require READ COMMITTED isolation. A revocation already holding its row lock wins; a queued writer rechecks committed state and denies. An authorized in-flight writer may finish before revocation acquires its lock; later requests deny. Native PostgreSQL tests exercise both orderings. Read policies use current statement authority; already returned data cannot be recalled.

Synthetic integration tests cover every legacy clinical RPC family, direct table reads/writes, elevated writers, foreign child IDs, approved provider delivery, owner/provider separation, module/grant/device revocation and operational report preservation. Browser tests connect UI requests to isolated PostgreSQL, covering hidden controls, denied routes, read-only program access and live revocation. Required CI includes native PostgreSQL races, full regression, TypeScript, affected lint, production build and existing browser suites.

## Release and recovery

Apply only `20261106055633_clinical_access_coverage.sql` after reconciling remote PR47/PR48 migration mappings. Exact predecessor source hashes abort the transaction on unexpected definitions; do not replay historical local migrations or blanket-push. No data/grant backfill, payment activation, recovery policy or workforce enrollment is part of this migration.

Before release, production aggregate preflight found two enabled organizations, four approved readers, and zero active clinical sessions with an unapproved provider. Compare advisors and catalog/grant state after migration. Deploy the exact checked tree and verify production aliases and disabled payment endpoints. Preserve the known PR48 app for compatibility rollback; app rollback does not remove database restrictions. Correct a proven authorization regression with a reviewed forward migration; do not drop history, fabricate approval or remove gates to restore access.
