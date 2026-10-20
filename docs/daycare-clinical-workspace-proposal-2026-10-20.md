# Daycare-first workspace boundary — source map and proposal

Prepared October 20, 2026 from main 9e184aa and the independent form-field branch. **Proposal only: no navigation, clinical access, schema or enablement behavior is changed by this document.**

## Recommendation

Use one organization with shared people and branches. Make ordinary daycare operations the default presentation, with an explicitly identified clinical area for currently authorized work. Clinical includes general client-care eligibility/documentation/service time as well as ABA-specific programs and measurement. Finish presentation separation first; organization enablement and commercial packaging are later decisions.

Do not consume feature-registry bundle/domain metadata or vocabulary presets as authority. There is no approved organization-level clinical enablement rule today. Consequently “base-only,” “clinical-enabled” and “mixed” below describe proposed experiences, not new enforceable account types.

## Current route/capability map

Navigation sources: config/navigation.ts, components/Sidebar.tsx and lib/effective-capabilities.ts. Items with no navigation permission still depend on authentication, route-specific checks and server/RLS rules. A visible link does not authorize a record or action.

| Surface and routes | Current entry/access and source | Proposed placement / boundary |
|---|---|---|
| Home `/dashboard`; root, `/staff-login`, `/onboarding` redirects | Navigation permission null; ScheduleCalendar and DailyScheduleProvider use tenant-scoped session reads | Base Home; schedule covers both intents with explicit labels. Preserve all currently visible records and totals. |
| `/attendance` | `attendance` capability; AttendanceWorkspace uses attendance_context/read/mutation APIs with separate View/Record/Correct grants, explicit branches, device and subscription checks | Base operations; independent from activity schedule and clinical time. |
| `/tasks` | Navigation null; task_workspace, set_task_completed and set_task_owner enforce assignee or existing child/session-manager authority | Base operations; assignment records are not classroom or daily-care completeness. |
| `/sessions` | `sessions` capability and can_manage_sessions; create_scheduled_context_session, recovery/cancellation and saved choices | Shared scheduler; ordinary activity default and explicit clinical intent. Reuse existing immutable intent, choices, receipts and cancellation fence. |
| `/sessions/[sessionId]`, `/sessions/[sessionId]/edit` | SessionAdministration checks can_manage_sessions and scoped record; activity intent delegates to ActivityWorkspace; clinical preparation remains separate | Shared administration with intent-specific panels. Never require targets/notes for activity. |
| `/activity/[sessionId]` | ActivityWorkspace uses activity_schedule; server checks workflow intent, current actor/tenant, management or assigned provider | Base assigned activity. No therapeutic timer, targets or clinical notes. |
| `/my-sessions`, `/my-sessions/history` | My Sessions nav null; assigned/current-actor session reads, record intent determines destinations | Shared daily work and history. Explicit Activity / Clinical labels and retained total counts before any optional filters. |
| `/session/[sessionId]`, `/session/[sessionId]/complete` | Clinical delivery and shared SessionNoteWorkspace; assignment, clinical intent, state, PIN and current authority guards | Clinical delivery/documentation; reject ordinary activity. |
| `/reviews`, `/reviews/[sessionId]` | `reviews` nav capability; can_review_sessions / active note-admin checks; mutate_session_note and append_session_note_remark enforce action/state | Clinical review; preserve historical/locked/read-only access and protected remarks. |
| `/team-management`; `/children`, `/clients` redirects | `people` derives from clients OR users OR sessions; list/create actions use their specific grants | Base People; shared identity, branch membership and roster. Do not duplicate child accounts for clinical work. |
| `/clients/[clientId]` | can_access_client RLS; management uses can_manage_clients; ClientBranches and ClientCareTeam have distinct save RPCs; current page mixes overview, targets, behaviors and sessions | Shared child details/branches first; separate clinical care-team/program sections. Do not describe a daycare child as incomplete without treatment targets. |
| `/team-management/[userId]`, `/setup/roles/[userId]` | Shared account editor; can_manage_users, supported grant/delegation rules, self/owner/admin protections, attendance scopes | Base access administration; clinical grants clearly identified without changing delegation authority. |
| `/team-management/invite`, `/team-management/import` | User/client management separately authorized; API invitation safeguards and shared roster import | Base onboarding; import does not establish clinical eligibility. |
| `/setup` | Nav null; effective-capability-based setup access; onboarding_progress readiness already excludes clinical targets/behaviors/notes | Base readiness; tutorial progress remains personal and distinct from business records. |
| `/setup/preferences`, `/operations` redirect | Branches/types/target categories share existing editors; clients/sessions edit authority | Base branches/activity defaults; separately labeled clinical target categories. Do not duplicate editors or alter type identities. |
| `/setup/appearance` | Existing terminology/theme settings and save authority | Shared presentation. Presets never enable clinical work. |
| `/setup/care-teams`, `/team-management/care-setup` redirect | Care-group/branch context and existing management RPCs | Clinical assignment preparation; describe groups as selection shortcuts, not classes or enrollment. Review staff branch configuration before moving the whole surface. |
| `/setup/roles`, `/teachers` redirect | Base account definitions and grants; linked detail editor above | Base access setup. |
| `/reports` | `reports` capability; reportAvailable also requires source grants (D1 clients/sessions, D2 users, D3 sessions); server exports reauthorize | Base operational reports with scope/limits; later clinical reports need their own rules. |
| `/billing`, `/access-requests` | `billing` / `accessRequests` navigation capabilities; existing API checks | Organization administration. No clinical purchase/price/gate change in presentation slices. |
| `/profile` | Nav null; own password/PIN APIs, current authentication/device checks | Shared account settings. |
| `/login`, `/set-pin`, `/onboarding-owner`, `/request-access` redirect | Existing authentication, PIN and organization onboarding endpoints | Shared entry. No real invitations, codes or organization creation in visual fixtures. |

## Enforcement trace and constraints

- Effective capability normalization rejects incomplete payloads; People is an OR of existing capabilities. Attendance has a separate explicit capability. Source: lib/effective-capabilities.ts; latest SQL capability definition in 20261018084149_branch_attendance.sql. Do not infer module authority from owner wording or navigation groups.
- Tenant/device baseline: current_organization_id(), session_is_unlocked()/require_unlocked() and existing table RLS. Sources include 20260919061400_enforce_pin_session_policy.sql and later forward migrations. Preserve mandatory PIN/device revocation.
- P1 clinical boundary: 20261019194610_p1_activity_and_attendance_activation.sql makes workflow_intent immutable, blocks clinical records on activities and retains legacy clinical defaults. Its latest can_access_client includes management, care membership or clinical provider assignment, not activity assignment alone. activity_schedule separately authorizes activity access without widening child-profile access.
- Clinical notes/review: components/SessionNoteWorkspace.tsx rejects activity intent before note work; mutate_session_note and append_session_note_remark retain current actor/state/admin/reviewer checks. Session administration retains optimistic versions and started/historical restrictions.
- P2 tasks and recovery: 20261019202944_p2_scheduling_reliability.sql retains current assignee/client scope, subscription/version checks and operation receipts/cancellation fences. Saved choice tags/snapshots never grant clinical authority.
- Subscription access remains the existing organization write/continuity model, not clinical entitlement. Registry references describe inventory/enforcement sources; they are not executable permission rules.

This is a current-source trace, not a new database security certification. No live RLS, cross-tenant or mutation tests were run for the proposal. Every future behavior change must be tested at both direct routes and API/database boundaries.

## Concrete experience examples

| Example | Proposed default | Existing work that must remain reachable |
|---|---|---|
| Daycare operation with no clinical work | Home, Attendance, People, Tasks, ordinary activity scheduling and operational Setup | Any records authorized by current rules remain visible. Absence of records is not itself an entitlement decision. |
| Existing clinical organization | Shared Home/People plus clearly marked clinical preparation, delivery and review | Active sessions, authorized historical notes/review and existing grants; no silent disable or settings rewrite. |
| Mixed organization | Shared identities/branches and activity-first Home; labeled clinical destinations for authorized users | Both assigned workflows in daily work/history, with complete totals and explicit intent. Activity-only staff do not gain clinical record access. |

## Bounded implementation slices

1. **Presentation only:** Base-first navigation grouping, setup copy and child profile sections. Preserve the link set and grant predicates. Start with Home, attendance, People, Tasks, scheduling; put Reviews under Clinical. Keep the shared scheduler and assigned-work list out of a clinical-only group. Replace “Teams, groups and classes” with accurate care-group/branch wording and add explicit limits. Separate shared identity/branches from care-team/program preparation; no new default requiring targets. Validate mobile/desktop/collapsed navigation and all permitted/denied direct URLs.
2. **Daily-work consistency:** Add explicit activity/clinical labels across Home, My Sessions/history and links. DailyScheduleProvider currently counts sessions starting today, including canceled records, in the device-local calendar day; readCalendarSessions paginates tenant/RLS-limited rows and applies selected client branch. Do not silently switch to organization-day semantics or clinical-only counters while rearranging labels. Preserve current totals, cancellation/recovery and record destinations. Decide and document timezone semantics separately before changing count behavior.
3. **Optional enablement only after decisions below:** Additive schema with explicit organization control and separately enforced actor grants; compatibility/history/in-progress rules, server checks, audited changes and complete authority matrix tests. Never convert existing intent or remove clinical records when toggling presentation.
4. **Documentation/guides/tours:** Describe only verified behavior. Preserve general client-care versus ABA distinctions, historical release records and partial-feature limits. Classroom/enrollment remains a subsequent project.

## Decisions required before dependent changes

- Who can explicitly enable/disable clinical functionality, and through what organization setting? Recommendation: owner-controlled organization setting plus separate existing clinical grants; exact administration/delegation remains undecided.
- What compatibility rule preserves existing organizations with clinical work? Define rollout/defaults explicitly; do not infer silently from terminology, tags or subscriptions.
- When disabled, what authorized historical access and in-progress continuity remain? Recommendation: retain all records and allow defined authorized completion/history paths; specify this before gating direct APIs.
- Is this commercial packaging? Recommendation: presentation boundary first, pricing/subscription/purchase flows later. No commercial gate is approved by this handoff.

No answers are needed to review this proposal or to ship the independent cosmetic cleanup after required validation. Answers are required before implementing new enablement/schema/access behavior. A presentation slice should be reviewed as its own change after the cleanup, using matrix cases: base-only example, mixed/clinical example, denied, locked, cross-tenant, read-only and historical/in-progress records.
