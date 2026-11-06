# Scheduling write coverage — item 3

October 24, 2026, America/Chicago. Local implementation stacked on PR 45 at `23255ad`. This is not a release or a claim of universal enforcement: the new independent-transaction races still require native PostgreSQL CI, and production schema reconciliation remains outstanding.

## Entry-point inventory

The inventory combines repository call sites, migration definitions and an installed synthetic-database function catalog. It does not inspect customer integrations or assume vendor API access.

| Entry point | Existing path | Coverage after this migration |
| --- | --- | --- |
| Current create/edit UI | `save_reviewed_schedule` for individual Activity, clinical session and group Activity | Existing actor/payload/snapshot/version/timezone checks; private transaction-bound permit links the actual write to the validated review |
| Legacy scheduled creator | Public/private `create_scheduled_context_session` | Table trigger rechecks under organization lock; clean writes retain receipts; overlapping writes require the reviewed workspace |
| Older clinical context creator | `create_context_session` → `create_prepared_session` | Same session table gate; existing preparation/eligibility and operation fences remain |
| Old prepared creator | Public `create_prepared_session` | Same gate despite SECURITY DEFINER; no grandfathered definer bypass |
| Direct session mutations | Authorized Data API/SQL INSERT or schedule/assignment/occupancy UPDATE | Same locked check and private audit; RLS is not relaxed; identity changes rejected; deletion remains unsupported—use cancellation |
| Legacy group create/update | Public/private `create_group_activity`, `update_group_activity` | Lock before parent mutation; deferred check uses final saved child/staff roster; unreviewed overlaps roll back parent, roster and receipt together |
| Saved group participants | Private child/staff snapshot tables | Inserts only during the same transaction's group creation; later insert/update/delete rejected |
| Session lifecycle | `start_assigned_session`, `pause_assigned_session`, `resume_assigned_session`, `finish_assigned_session`, preparation | No extra scheduling authority for unchanged occupied intervals; existing lifecycle validation remains; moving an interval/assignment after service starts is still blocked |
| Existing file imports | People/roster importer and invitation endpoints | No schedule writer found; imports do not acquire scheduling authority |
| API/SFTP/vendor integrations | Proposed in product docs; no implemented scheduling connector found | No service provisioned or adapter assumed. A future adapter must use a live authorized actor, supported isolation, timezone contract and reviewed commands |

Catalog writers of `public.sessions` include the prepared creator, clinical lifecycle/preparation functions, private scheduled creator and private reviewed writer. Public wrappers and legacy context creators reach those writers transitively. Group storage and participant tables are separately guarded; searching UI calls alone would miss these paths.

## Transaction and audit behavior

Additive migration `20261025020957_conflict_write_coverage.sql` requires the conflict-review and explicit-timezone migrations first. Before a scheduling mutation, the database rechecks live actor, tenant, device, subscription and scheduling authority, confirms the organization timezone exists, and takes the existing organization lock. New occupied writes require finite, ordered start/end instants within 24 hours. Unchanged legacy unknown ends can still be read/reviewed as uncertainty; they are not silently converted into availability.

Read-committed isolation is required for schedule changes so a transaction waiting on the organization lock cannot use a stale repeatable-read snapshot. Unsupported isolation fails closed. Direct updates may deadlock against an opposite lock order in a reviewed edit; PostgreSQL aborts one transaction, and the caller must reload/review rather than blindly retrying an acknowledgement.

The validated reviewed writer creates a private permit only after checking the current actor-bound review and acknowledgement. The permit is bound to transaction ID, actor, organization, participants, UTC interval, kind, and review snapshot. It is closed when the underlying writer returns and bound to the resulting record. A user-set configuration variable cannot forge it. Receipt retries do not insert another scheduled record or duplicate write audit.

Session guards compare the actual row with the permit and re-read conflicts before writing. Group validation runs after saved participants and the acknowledgement exist, at transaction end. Reviewed overlaps remain possible, including planned ABA pull-outs; no roster member is removed automatically. Metadata-only lifecycle work does not acquire a new scheduling review. Multiple schedule changes inside one transaction are checked against their final shared state; do not rely on an earlier clean review to authorize later overlapping batch rows.

Every successful creation, interval/assignment change or occupancy removal stores private actor/time/record/transaction evidence, previous whitelisted schedule fields, the resulting proposal, conflict snapshot and optional review link. Clinical notes and broad rosters are not added to public DTOs. Failed writes, rejected batches, receipts and partial group rosters roll back atomically. Clean reviewed-save evidence is retained when old unacknowledged review drafts are pruned.

No attendance, clinical completion, billing, roster-removal or coverage assertion is derived from a scheduling review. Existing historical/started-session guards remain. A future privileged absence workflow is separate.

## Validation and remaining limits

Local partial regression: 180 tests passed. Five new database tests cover legacy/direct bypass attempts, prepared/context wrappers, direct rescheduling, reviewed pull-outs, final group rosters, immutable participants, receipts, audit privacy, failed batch atomicity, unsupported isolation, lifecycle/history and pruning evidence. TypeScript and affected lint pass. Production-mode attendance, group/conflict and field/layout browser flows run against synthetic data; the database flows apply the new migration.

The native suite now races reviewed scheduling against a legacy RPC, a direct insert, and a legacy session competing with a reviewed group. It asserts exactly one unacknowledged overlapping event commits and the other writer receives a new review or rejection. These new races have not run locally because the isolated PostgreSQL server is unavailable. Do not label item 3 concurrency coverage verified until required CI passes them.

PR 45's independent native timezone races and all its CI checks passed at `23255ad`; that is evidence for item 2, not for this new migration. Its first CI run exposed a detached-field measurement race; the test now waits for a connected, measurable field while retaining the exact spacing assertion.

Before release: review installed production grants/functions/triggers and migration names/definitions, run security advisors and native races, test authenticated preview/rollback compatibility, and approve the new older-client behavior. Database owners capable of disabling triggers, arbitrary production scripts, undocumented integrations and customer-specific import paths are outside this verified inventory. No production migration, merge, deployment, connector or customer-data access was performed.
