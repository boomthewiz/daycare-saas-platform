# Attendance: proposed branch-level contract

**October 18 update:** scope approved by the user. The [implementation record](../attendance-session-context.md) describes the code, tests and release prerequisites; this document preserves the reviewed contract.

Design only. [Scope decisions](README.md) must be reviewed before implementation. Names below are proposed schema/API identifiers, not existing tables, grants or RPCs.

## Records and invariants

| Proposed record | Fields and purpose |
| --- | --- |
| `attendance_branch_scopes` | Organization, staff user, branch, assigned/revoked actor and time. History is append-only; an effective projection resolves current scope. Administer independently of `staff_locations`. |
| `attendance_visits` | Organization, child, immutable visit ID, original branch ID/name snapshot, captured timezone, projection version and effective opening/closing event IDs. Projection is server-maintained; clients cannot update it directly. |
| `attendance_events` | Organization, visit, child, event ID/type, effective UTC instant, server-recorded time/actor, branch attribution, captured timezone, operation ID, expected prior version, correction reason and superseded event ID where applicable. Immutable source of truth. |
| `attendance_operations` | Organization + operation ID, actor, canonical request fingerprint and result reference. Prevent duplicate action on retry; do not store arbitrary submitted child content. |

Use composite foreign keys for organization/child/visit/branch relationships. No cascade deletion of attendance history when a child, branch or staff account is deactivated or otherwise removed. A later approved archival/deletion workflow must address references explicitly. Snapshot the branch label from the authorized branch row; never accept an authoritative label or actor from the browser. Display child names as current names unless a separately designed historical identity model exists.

Enforce at most one effective open visit per organization/child across all branches, with a unique constraint on the current projection plus transactional child-scoped serialization. Closed visit intervals for a child cannot overlap. Events use deterministic revision/sequence ordering; timestamps alone do not resolve correction chains. Direct INSERT/UPDATE/DELETE on source/projection tables is unavailable to ordinary API roles. Exposed reads require RLS; any narrowly elevated internal writer must derive identity and validate every action/record rather than rely on its privileges.

The branch-level release records `classroom_id = null`/equivalent explicit unknown. Do not insert a fake “unassigned classroom” or copy a current care group. Later room intervals can reference a visit without rewriting its original branch-level history. No first-release absence, classroom transfer, guardian signature, authorized-pickup or ratio model is implied.

## Proposed authority

| Operation | Required authority, in addition to active tenant/account and unlocked, nonrevoked device |
| --- | --- |
| Minimal child selector and attendance read | `can_view_attendance` plus effective attendance branch scope. Return only child identity/status, relevant current membership and authorized attendance, not clinical records. |
| Live check-in/out | View + `can_record_attendance`, with scope over the event branch. Check-in additionally needs active child/branch and current child membership in that branch. |
| Correct/void attendance | View + `can_correct_attendance`; current scope over every old/new branch affected; reason, expected version and correction-window checks. This does not imply live-record authority. |
| Report/export | View + `can_view_reports`, restricted to attendance branch scope and approved fields. A report grant alone is insufficient. |
| Grant assignment | Preserve existing Manage users/delegation/self/owner/admin rules. Record/view may be delegate-managed; correct remains owner/admin-controlled in the initial proposal. |
| Attendance branch-scope assignment | Owner or administrator with existing Manage users authority; history and protected-account rules apply. Existing client/session setup grants do not administer scopes. |

Owner access follows the existing explicit organization-owner model; nonowners receive no automatic grants or scopes from a role title. Do not backfill rights from clinical assignments, vocabulary, product profile or subscription payment. Permission and branch-scope revocation take effect on the next server operation, including a retried operation or export. Scope readers must not disclose another branch's open-visit details through error text.

## Command semantics

Suggested commands are `attendance_check_in(child, branch, operation_id)`, `attendance_check_out(visit, expected_version, operation_id)` and `attendance_correct(visit, expected_version, replacement, reason, operation_id)`. The server derives organization/actor; it accepts no authoritative organization ID. Validate structured fields and cap reason length; free-text reasons are staff-only and absent from general CSV by default.

Live check-in/out takes its effective timestamp from the server. Check-out remains possible for a legitimately open visit after its child or branch is deactivated, subject to attendance authority and scope; deactivation must not trap an open visit. Deleting current child membership cannot rewrite the event branch or revoke a separately authorized historical branch read. Cross-branch check-in while a visit is open fails generically; ask authorized staff to close the existing visit. Atomic classroom/branch transfer is a separate later command.

Serialize by organization/child and re-read current projection/version under the lock. Within one transaction: authorize the action, validate tenant references/state, resolve idempotency, append event(s), update the projection with a version check, and persist operation result. Unique constraints remain the final guard. A matching retry by the same currently authorized actor returns the original committed result; a changed payload/actor with the same operation ID returns a conflict. Two different operation IDs cannot create two open visits. A failed transaction leaves neither an event nor a successful operation receipt.

## Corrections and history

A correction creates a new immutable revision that references the prior effective revision. It does not edit old timestamps, actor, branch or reasons. Propose a complete replacement of the visit's effective check-in/optional check-out pair, or a void of the visit, applied atomically. Record before/after projection versions. Concurrent corrections use an expected version; the losing editor must reload history, not silently overwrite. A voided visit is excluded from effective presence but remains visible in authorized history; restoring one is outside the first release.

For the proposed first policy, both the visit's original check-in date and the replacement check-in date must fall within today plus the previous six calendar dates in its captured timezone. A revision cannot reset the correction window by changing an effective or recording timestamp. Only authorized correctors may backdate; future effective instants, close-before-open and overlap with another effective visit are rejected. Re-evaluate the corrected timeline across day and branch boundaries. Corrections to branch attribution need authority over both branches; current membership is not evidence the child historically belonged there. The correction history must say attribution was corrected, not retrospectively verified enrollment.

Correction forms show timezone and UTC offset and require an explicit resolution for repeated DST wall-clock times; reject nonexistent local times rather than normalize them silently. Retain both effective and recorded times. No midnight job invents a checkout. Older unresolved visits remain exceptions until an approved older-record correction process exists; the seven-day rule must not hide them.

## Subscription continuity and reporting

Propose a dedicated close-only exception when a previously open visit crosses subscription editing expiry. Verify the visit opened while editing was allowed and before expiry, along with current record grant, branch scope and device/account validity. It permits only a server-time checkout, not reopening, new visits, corrections or general writes. Revoked/inactive users do not qualify. Define and test overlapping renewal/expiry transitions before shipping. This exception is a product decision awaiting approval, not an existing RPC behavior.

For local range `[start, day-after-end)`, include effective visits overlapping the range, with explicit carry-in/carry-out and open-visit markers. Never infer absence from no event. Use the selected report timezone for boundaries; disclose it, generation time and current versus cutoff interpretation. Retain event-time branch and explicit unknown classroom. A record-time cutoff resolves the event revisions that existed at that cutoff, with all rows in a request using one snapshot. Do not claim reproducible historical exports until a cutoff is carried across pages/exports and tested. The initial current report may instead disclose fresh independent page snapshots, as in slice 2.

Open-visit exceptions mean “no recorded checkout as of this cutoff,” not a fabricated stay length or confirmed physical presence. Current child branch membership does not replace event branch attribution. Export minimal authorized fields with the slice 2 CSV safety rules, no correction reasons or pickup claims. Do not promote the full D4 or any classroom report when only branch-level presence exists.

## Acceptance cases required before release

| Boundary | Required evidence |
| --- | --- |
| Authority | Direct RPC/table/export denial for missing grants, missing scope, clinical-only assignments, foreign tenant/child/branch/visit, locked/revoked devices and inactive accounts. Owner/admin/delegation/self protections stay intact. |
| Lifecycle | Duplicate check-in, double checkout, inactive child/branch with open visit, branch change, overnight visit, old unresolved open visit, failed save and reload all preserve truthful state. |
| Concurrency | Independent PostgreSQL connections race check-ins, retries, correction versus checkout and competing corrections. Exactly one admissible transition commits; no silent lost update or partial receipt. |
| Corrections | Original events preserved; invalid/future/overlapping replacements rejected; version conflict/reason/window enforced; a void remains auditable; historical branch reassignment needs both scopes. |
| Time | Spring gap, autumn repeated hour, UTC/local midnight, range boundaries and timezone changes preserve recorded instants and explicit coverage gaps. |
| Continuity | Expiry before/after check-in, late checkout, renewal, permission revocation and device lock exercise the dedicated close-only rule. Never copy the clinical timer exception. |
| UX/export | Online confirmation, same-operation retry, visible errors, accessible confirmation/history, no optimistic false success, scoped CSV and no automatic tour mutations. |

These are future implementation acceptance cases, not test results from this design-only slice.
