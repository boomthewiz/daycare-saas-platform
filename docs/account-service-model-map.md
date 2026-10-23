# ReJoyce account differentiation and conflict map

Prepared October 22, 2026. Product/engineering plan; account configuration and live scheduling-conflict detection are not implemented by this document. Calendar views are local commit 0c5f48c, following Classes commit c1744d4. PR #42 contains the pushed Classes baseline; the calendar follow-up remains local. No production changes are authorized by this plan.

## Account model

| Layer | Responsibility | Who controls it |
| --- | --- | --- |
| Service model: Daycare, ABA, Mixed | Onboarding, navigation and scheduling defaults | Owner or admin with current account-configuration authority |
| Enabled modules and readiness | Which workflows the organization has explicitly enabled | Separately authorized setup and entitlement checks |
| Permissions | Which records and actions this actor can access | Existing server-enforced grants, tenant, device and subscription rules |
| Vocabulary and appearance | Child/Client, Educator/Therapist, Activity/Session; visual theme | Authorized appearance settings; display only |
| Calendar preference | Day/week/agenda and Classes/ABA/All focus | Individual user; never changes account configuration or permissions |
| Saved record intent | Clinical session, individual Activity, group Activity | Explicit server-validated creation; retained for that record's lifetime |

A service-model choice selects defaults, not new authority. Never infer service model from vocabulary, role names, a tag, billing plan, or the currently selected calendar view. The same person/child identity can participate in both domains without granting access to both.

## Customer experience

| Account setup | Calendar default | Primary scheduling action | Secondary actions |
| --- | --- | --- | --- |
| Daycare | Daily Classes; individual Activities available | Schedule class Activity | Schedule individual Activity; clinical action only if separately enabled and authorized |
| ABA | Individual clinical sessions, day/week detail | Schedule ABA session | Other enabled workflows remain available through explicit actions |
| Mixed | Combined schedule initially; user can choose a default focus | Choose ABA session, class Activity, or individual Activity | Later allow authorized branch defaults |

Onboarding: select service model, preview defaults, separately review module readiness, then confirm. Existing businesses start unconfirmed and retain existing behavior until an authorized person confirms the setting. Do not silently classify them from existing labels.

Business settings: show current value, who changed it and when, and a preview of the proposed change. Use version checks to avoid conflicting edits and retain an audit history. Existing records, roster snapshots, permissions, subscriptions and enabled workflows remain intact. If a model change would hide a workflow with active future records, preserve a visible route and show an impact summary rather than stranding those records.

Mixed-account display must preserve explicit badges: ABA session, individual Activity, group Activity. Neutral shared navigation such as Schedule avoids translating clinical sessions into Activities through a single organization-wide word replacement. Each record detail and confirmation uses its saved intent. Vocabulary remains customizable outside those semantic badges.

Recommended calendar focuses: Classes (group Activities), Activities (individual and group daycare work), ABA (clinical intent only), and All. Keep focus separate from time scale. A focus may suggest a creation type, but enabled workflows and actor authority determine the available explicit actions. Drag selection captures times first; creation review clearly states workflow and roster before saving. Never create a Class roster merely by dragging a slot.

## Record and access boundaries

Shared: tenant identity, child identity, staff identity, branch selection, time range, authorized calendar summaries and operation recovery. Shared visibility does not imply shared authority.

ABA: single-child clinical sessions retain clinical eligibility, preparation, targets, timers and notes. Ordinary Activities cannot enter clinical execution or note endpoints. Do not convert an Activity into a clinical session by changing its label or account type; use a reviewed new record and preserve the original audit trail.

Daycare: a Class is a reusable roster; a scheduled group Activity stores its reviewed child/staff snapshot. Class membership does not establish clinical care-team membership, actual attendance, coverage, shifts, ratios, payroll or billable clinical time. Later Class edits must not rewrite scheduled participants.

Reports: group Activity count is one event; child participation and staff assignment are separate measures. Split clinical session counts and daycare Activity counts explicitly. Scheduled duration is not attendance, service delivery or payroll. Mixed totals must label their denominator and avoid double-counting a child's participation as extra events.

## Scheduling-conflict design

Introduce a tenant-scoped server conflict reader used by create and reschedule flows across both storage models. Expand group participants from the saved event snapshot, not today's Class membership. Check every assigned staff member and child. Use UTC instants and half-open intervals: existing.start < proposed.end AND proposed.start < existing.end. Adjacent bookings do not conflict. Handle overnight events, DST and edits excluding the current event. Define occupying statuses explicitly; canceled/absent/no-show records should not reserve future time by default. Unknown end times require an uncertainty warning rather than an invented conflict-free result.

| Situation | Proposed response | Why |
| --- | --- | --- |
| Same staff member in overlapping ABA and Activity events | High-priority review warning; require an authorized acknowledgement/reason before save | May be an actual double booking; a roster suggestion is not verified coverage |
| Same staff member in two overlapping clinical sessions | High-priority review warning with the same acknowledgement policy | Do not silently allow it through different calendar views |
| Child in an ABA session during a class Activity | Review warning with an explicit planned pull-out acknowledgement | Can be intentional; Class membership or scheduled participation is not actual presence |
| Child in two overlapping individual clinical appointments | High-priority review warning | Usually an accidental double booking |
| Class Activity overlapping another class Activity with common participants | Child/staff warnings based on actual saved participant intersections | Different Class names do not prevent shared children/staff |
| Same free-text room/location | No asserted room-resource collision yet | Reliable room booking requires stable room IDs and a resource model |
| Attendance open during ABA | No automatic checkout or absence | Attendance and clinical delivery remain independent |
| Travel between branches | Future configurable buffer warning | Requires verified event-time location and a reviewed travel policy |

Start with warnings and explicit acknowledgement, not a universal overlap prohibition. Do not silently remove a child or staff member from another event to resolve a warning. Do not treat acknowledgement as verified presence, staffing sufficiency or clinical authorization. A warning modal reveals only the minimum conflicting details this actor may read; restricted records return a generic authorized conflict signal, not another provider's clinical data.

A preflight check alone can miss concurrent saves. Before claiming prevention, recheck transactionally on both legacy and group create/update paths with consistent per-tenant/resource locking. Deterministic lock order, idempotent receipts and retry behavior must be tested. Document whether the first release detects overlaps or prevents them; never claim prevention from UI-only checks. Store acknowledgement actor, timestamp, reason and the relevant conflict/version snapshot; recheck after changes.

## Current conflict register

| ID | Finding and evidence | Status / next action |
| --- | --- | --- |
| C1 | components/ScheduleCalendar.tsx filters Session detail using !group_activity, which also includes individual ordinary Activities | Confirmed presentation gap. Split clinical intent from individual/group shape; retain All for combined work |
| C2 | Calendar createAt derives intent from focus; All defaults to ordinary Activity. No persisted service-model setting exists | Confirmed defaults gap. Add explicit account configuration and creation choice; test direct URLs and in-app navigation |
| C3 | PortalProvider translates Session/Activities organization-wide without saved-record intent | Mixed-account naming risk. Use domain badges and intent-aware labels on shared and clinical surfaces |
| C4 | create_group_activity and update_group_activity validate authority, roster, versions and time ordering, but do not compare participant intervals against clinical sessions | Confirmed missing cross-workflow overlap detection. Build server conflict reader and acknowledgement flow before claiming schedule conflict protection |
| C5 | Clinical care-team membership, group staff assignment and daycare attendance are separate authorization models | Required invariant. Monitor for code that treats one assignment as authority for another |
| C6 | Calendar uses browser-local timezone; account/service-model defaults must not silently change booking instants | Known limitation. Decide organization versus user display timezone explicitly; preserve instants and label conversions |
| C7 | Group events preserve branch snapshots; legacy branch filters follow current child branch membership | Known historical-location limitation. Do not claim equivalent historical branch attribution |
| C8 | One group event has multiple child/staff participants | Required invariant. Guard against multiplying calendar/report event totals or inventing clinical billing units |

Review found concrete gaps, not evidence that every boundary is broken. Existing Classes validation covers tenant isolation, explicit assignments, immutable snapshots, role/device/subscription denial, receipt recovery, stale versions and group event counts. These checks do not establish overlap detection or account-type enforcement.

## Delivery sequence

1. Stabilize semantics: distinguish clinical intent from individual/group shape; add domain badges and tests covering every record type in every view. Make creation intent visible and retain selected drag times.
2. Add account configuration: persistent enum with unconfirmed state, audited/versioned privileged update, onboarding/settings preview, read-only defaults resolver. Keep vocabulary and authority separate. Test Daycare, ABA and Mixed with enabled/disabled modules and restricted users.
3. Add scheduling conflict detection: server reader across both models, minimal permission-safe results, review/acknowledgement UX and create/edit integration. Add cross-model concurrent-save tests before promising prevention.
4. Add per-user calendar preference, then branch defaults if needed. Scope stored preferences by organization and user. Never carry another account's preference or draft across tenant switches.
5. Release via reviewed migration, CI and preview validation, then separately approved production release. Rollback disables new defaults without rewriting saved workflow intent or roster history.

Acceptance matrix: all three service models x clinical/individual/group record x manager/assigned/unauthorized actor; direct-link and calendar creation; disabled modules; role/device/subscription revocation; Class rename/archive; concurrent edits and saves; duplicate retry/cancel fencing; overlapping and adjacent times; same participant across both models; intentional pull-out; cancellation; branch changes; restricted conflict privacy; timezone/DST/midnight; calendar/report counts. Group Activities never prepare targets or enter notes/timers. Changing account model never grants access or converts historical records.

## Ongoing monitoring

A daily Codex review at 9 AM America/Chicago monitors repository changes and accessible PR checks against this register. It reports meaningful regressions, resolved findings or required decisions and stays quiet when unchanged. It reviews software boundaries; it does not query live customer schedules. Live customer overlap alerts are the planned product capability above, not a feature already running. This monitor cannot change production, apply migrations, merge, deploy or publish code.
