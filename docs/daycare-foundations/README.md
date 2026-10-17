# Slice 3: daycare foundations for product review

October 17, 2026. **Proposed, not approved or implemented.** This package follows slices 1–2 and provides the product review requested by the handoff: “Choose a bounded first implementation after product review.” No migration, grant, runtime UI, product entitlement, customer record or registry maturity changes are included.

## Recommended first implementation

Approve **online, branch-level child check-in/out with an immutable correction history**, scoped to explicitly authorized staff. Give staff a clear open-visit list and an honest branch-presence view. Build this as a dedicated attendance workflow, outside the clinical session timer.

| Decision | Recommended first boundary |
| --- | --- |
| Presence unit | One open visit per child per organization, across branches. Explicit branch at check-in; never infer from a session or today's default branch. |
| Classroom attribution | Not collected in this branch-level release. Store this absence explicitly; display “Classroom not recorded.” No classroom breakdown, capacity or ratio claim. |
| Clock and timezone | Require the explicit organization IANA timezone from slice 2. Live actions use server time. Retain UTC instants, recording time and the timezone used when recording. |
| Authority | New independent view, record and correct attendance grants. Nonowners start denied. Assign dedicated attendance branch scopes; existing care-team/staff-location shortcuts cannot grant them. |
| Grant administration | Owner or administrator with existing Manage users authority; respect existing self/owner/admin account protections. Correction authority and attendance scope assignment are owner/admin-controlled in the first release. |
| Correction policy | Authorized correction staff directly apply a reasoned correction within seven local calendar dates including today. No second approval queue in the first release. Older corrections remain unavailable pending a separately reviewed exception process. |
| Mistaken records | Void a visit with a reason; keep its complete history. No hard-delete control. |
| Subscription transition | Propose a narrow check-out continuation for a visit already open when editing access expires; retain current account, grant, branch, tenant and device checks. No new visits or historical corrections during read-only access. This is a new proposed policy, not the clinical session exception. |
| Offline behavior | Online only. Never show a check-in/out as saved until the server confirms it. Retried requests use the same operation ID. |
| Retention | No automatic purge in this release. Agree the attendance retention/archival policy before production rollout; no specific legal retention duration is assumed here. |

Approval of this package authorizes preparing and testing that bounded implementation, not production migrations/deployment or the other daycare subsystems. Each production release still needs fresh authorization. If any recommendation changes, update the decision record before dependent implementation.

## Separate proposals and dependencies

| Workstream | Concrete design | Dependency before its reports can become available |
| --- | --- | --- |
| Branch-level presence | [Attendance](attendance.md) | Dedicated visits/events, independent authority, correction history, timezone, concurrency and continuity tests. |
| Classroom enrollment and staff coverage | [Classrooms and shifts](classrooms-and-shifts.md) | Effective-dated rooms/enrollment, actual room/staff presence, capacities and reviewed rule versions. |
| Guardians and pickup | [Guardians and pickup](guardians-and-pickup.md) | Verified child relationships, explicit pickup authority, revocation and staff verification history. |
| Daily care and family sharing | [Daily care](daily-care.md) | Typed care records, incident restrictions, review/share states and verified recipient access. |

The first attendance release would make `daycare.attendance` **partial**, only after it actually works and passes its acceptance tests. D4 remains incomplete until its classroom-attribution and absence/correction requirements are satisfied. Any initial report must say **branch-level recorded presence**, show its missing classroom coverage and retain the unresolved parts of D4 in metadata. D6 and D7 remain blocked. No existing registry entry is promoted by these documents.

## Source findings that constrain the design

- `clients` and `client_locations` provide child identity and current branch membership. `20260921003120_client_branch_memberships.sql` enforces composite tenant relationships. These are not enrollment history or event-time location.
- `staff_locations`, `care_groups` and `client_care_members` in `20261004053317_client_care_teams.sql` serve clinical eligibility and selection shortcuts. Reusing them as attendance authority would let existing setup edits change the new safety boundary.
- `lib/permissions.ts` lists supported grants; there is currently no attendance or guardian grant. New keys require matching database enforcement, delegation rules, defaults and tests before a settings control is shipped.
- Slice 2's `rejoyce_security.reporting_settings` supplies explicit organization timezone. Its reporting RPC stays caller-scoped; it cannot report a missing attendance model into existence.
- `organization_can_write()` and `session_trial_exception()` in `20260924080336_self_service_organization_onboarding.sql` distinguish read-only access from a specific clinical-session continuation. Attendance needs its own reviewed checkout rule.
- The current Tasks page queries legacy `children`/`classrooms` and selects UTC dates. The task-generation function is a placeholder. Neither supplies an attendance/classroom source or a validated daily-care workflow.

The source audit is against commit `0d78620` (slice 2), with fetched main still at `2588449`. PR #35 and PR #36 remain the predecessor review slices; this design does not merge or release them.

## Proposed implementation order after approval

1. Add the new grants and dedicated branch scopes with default-deny database rules; test source/tenant/device denial before exposing UI.
2. Add append-only attendance events plus a server-maintained visit projection, idempotent commands and correction validation. Test concurrent transactions on a real PostgreSQL instance.
3. Add staff check-in/out, open-visit exceptions and reasoned history views. Validate mobile/keyboard use and interrupted requests.
4. Add the explicitly limited branch-presence report/export using the same effective authority and filter contract. Update registry maturity only to the extent validated.
5. Prepare a separate release review: migrations, existing-customer compatibility, checkout continuity, retention/archival policy and smoke checks. Do not infer authorization to deploy from scope approval.

**Product review requested:** approve this recommended attendance boundary, or identify which defaults to change. The classroom/shift, guardian/pickup and daily-care proposals remain subsequent scope choices.
