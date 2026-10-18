# Classroom and shift history: separate proposed scope

Design only. This work follows the reviewed attendance foundation and is not included in the recommended first branch-level release.

## Model

Separate six facts: room identity, enrolled children, expected bookings, actual child presence, planned staff shifts, and actual staff presence. Existing `care_groups` remains a selection shortcut. A staff account being ready does not prove that person is on site, qualified for a room or covering a shift.

| Proposed entity | History and invariant |
| --- | --- |
| Rooms | Stable tenant/branch identity. Names, active periods and capacities have effective-dated versions. Preserve retired rooms and all referenced history. |
| Child room enrollment | Child, room, effective start/end, recorded actor/time and correction revision. Distinguish a default room from time-specific enrollment. |
| Expected bookings | Child, room/branch, planned intervals and exceptions. Bookings do not create actual attendance. |
| Child room presence | Attendance visit + room interval + movement event/reason/actor. Transfers atomically close one interval and open another; room intervals cannot exceed the effective visit. |
| Planned staff shifts | User, branch, planned intervals, explicit room-coverage assignment and revision history. No payroll inference. |
| Actual staff presence/coverage | Verified presence intervals, room assignments and correction history. Presence and assigned coverage are distinct. Staff cannot count simultaneously in two rooms without an explicitly reviewed rule allowing that case. |
| Capacity/qualification/rule versions | Effective-dated source, configured limits, applicability and approving actor. Changes do not silently rewrite past calculations. |

Use composite tenant foreign keys and server-derived actors. Choose half-open intervals and explicit overlap rules before schema implementation. Correct history through revisions; preserve effective and recording time. A client's current branch, care-team membership or today's room assignment cannot supply missing past room/staff presence.

## Authority and safety of interpretation

Propose separate room/enrollment administration, shift planning, presence recording, historical correction and coverage-report authorities. Reuse neither clinical note-review grants nor generic attendance view as room/rule administration. Each operation checks old/new branch and room scopes, record version, device/account and subscription rules. Assigning a shift must not grant record access to children; classroom access needs its own explicit scope model.

The first classroom report should show enrolled, expected and actually recorded people as distinct columns. Show unknown capacity, missing room intervals, missing staff presence, unknown qualification and overlapping coverage as exceptions. Do not turn missing values into zero demand, spare capacity or a passing ratio. Calculate interval-based snapshots rather than summing overlapping sessions. Preserve the report's source cutoff and rule version.

No “compliant” or licensing pass/fail claim belongs in an initial view. Jurisdiction/age/qualification/mixed-group rules and their maintenance owner must be selected and reviewed before an applicable rules engine is designed. This document does not supply legal ratio thresholds.

## Bounded later implementation and review

Recommended later order: room directory + enrollment history; actual child room movements; staff presence and explicit coverage; capacity exception views; only then a separately reviewed ratio evaluation. Decide permitted enrollment/coverage overlaps, transfer semantics, qualification verification, overnight shifts, breaks, correction approval, timezone and retention before each dependent stage.

Acceptance must cover foreign rooms/staff/children; direct API denials; room/branch deactivation with open intervals; duplicate/concurrent transfers; retroactive changes; capacity/rule changes; staff breaks and cross-branch moves; midnight/DST; missing versus zero data; and export scope. Test actual independent database transactions for exclusion/uniqueness rules. D6 remains blocked until its required histories and semantics exist and are validated.
