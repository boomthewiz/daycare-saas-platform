# ReJoyce page and integration audit — October 4, 2026

Item #9 is deployed in production through [PR #27](https://github.com/boomthewiz/daycare-saas-platform/pull/27), commit `de8d5c92a1db83ce26d720dfbf1663fa10cd34a5`. The separate review branch, `improve/setup-guides-and-workflow-bridges`, prepares onboarding guides and selected corrections below. **That broader branch is not approved for production rollout.**

This is a source-level audit of every one of the 35 application page routes, their layouts, navigation, shared session/note workspaces and relevant API/database integration points. Synthetic browser checks cover the changed guide workflows and responsive layouts. It is not a claim that every production page was exercised with every role or existing record. No production business records were edited; the production database check read column metadata only. Authentication codes and PINs were not entered.

## Confirmed findings

| Finding and location | User experience and missing connection | Correction / status |
|---|---|---|
| Shared `components/Sidebar.tsx` starts with a 256px expanded rail at phone widths. | Dashboard and other administrative pages overflow horizontally before the user collapses navigation. | Prepared: 80px phone rail with readable captions and accessible link names, desktop expand/collapse retained. Includes responsive scheduling/detail controls exposed by width checks. |
| `/sessions/[sessionId]` and `/sessions/[sessionId]/edit` use `components/SessionAdministration.tsx`; its service-type dropdown was a fixed five-entry list. | Types added in Setup were unavailable as replacement choices; historical codes were displayed as formatted identifiers. Creation and editing used different sources. | Prepared: organization-scoped configured type lookup, active choices, saved inactive/unlisted type retained, configured display names. A lookup failure disables type changes and explains recovery. Existing times are preserved; changing a type does not silently reschedule. |
| `/children` and `/teachers` were standalone heading-only placeholders. | Old bookmarks reach pages with no useful client/account work, outside the dashboard layout. | Prepared: redirects to `/team-management` and `/setup/roles`, using existing permission-aware workflows. These connect entry points; they do not migrate legacy `children` or teacher records. |
| `/onboarding` was a teacher-profile placeholder without completion controls. | Staff arriving at this old entry point cannot complete onboarding. | Prepared: redirect through `/dashboard`, whose existing authentication/PIN checks route users to sign-in or PIN setup as needed. No invitation delivery or login policy changes. |
| `components/Header.tsx` owner Setup shortcut led directly to preferences. | Users bypass the newer Setup home and its roles/care-team entry points. | Prepared: shortcut opens `/setup`. |
| `/profile` sends `phone` in updates, but production `public.users` has no `phone` column; current UPDATE policy also excludes self-updates. | Save Profile cannot persist under the current schema/policy. Earlier source inspection suggested an unloaded-phone problem; metadata and policy queries established both integration failures. | Prepared: shared-design read-only account view, visible loading/error/retry, PIN settings retained, unsupported phone and Save controls removed. Self-update protection is preserved; no policy or migration added. |
| `organization_terminology` is loaded and previewed in Setup preferences; ordinary page labels remain hard-coded. | Saving preferred labels does not propagate them across the workspace. | Remaining: introduce a shared organization terminology provider with safe defaults, then update navigation, forms, help and session displays consistently. Guidance now accurately describes the current limitation. Do not claim terminology rollout is complete. |
| `/tasks` joins `classrooms` and `children`; legacy `generate_tasks()` operates on `task_templates`, `daycare_id`, classrooms and children. New client/care-group setup uses separate clients, organizations and care groups. | Creating a client or class/group in current Setup does not establish a task-generation connection in this implementation. | Remaining: decide and implement an explicit mapping or replacement workflow, with migration/authorization tests. Existing legacy task data must be preserved. Confirmed disconnected models; whether a specific production user is affected depends on their use of legacy tasks. |
| `/tasks` chooses `new Date().toISOString().split("T")[0]`; load errors are only logged, then shown as an empty task list. | Local evening may show tomorrow's UTC date; a failed query can look like “No Tasks Today.” | Remaining: define business-day timezone, use it consistently with generation, and add visible error/retry and save states before revising the older design. |
| `/dashboard` uses `ADMIN_ROLES` for administrative actions and organization-wide team queries, while newer workflows use explicit grants. | A delegated frontline manager may not get relevant shortcuts; an administrative role without grants can get unusable actions. | Remaining: load authoritative capability RPCs and show each action by its actual grant. Keep RLS as enforcement; do not broaden grants or implement custom roles. This is a UI integration defect, not evidence of an authorization bypass. |
| Dashboard session query is capped at 12, but counters describe today's totals. | When there are more than 12 upcoming records, displayed “Today’s Sessions” / “Completed” may be partial counts. | Remaining: separate authoritative counts from the upcoming preview list, or label counts honestly. Item #9 hides only the summary strip on phones; desktop and daily overview still use current values. |
| `/my-sessions` and session delivery labels format `session_type` codes instead of resolving configured names; Reviews also carries raw service-type data. | The same saved service can appear with different wording in creation, editing and daily work. | Remaining: shared read-only type-name resolution with a legacy fallback. No My Sessions sidebar changes are included. |
| `/access-requests` and `/api/approve-owner` retain the old daycare approval pipeline; the newer owner onboarding creates organization-based workspaces. | Legacy approval creates `daycares` / `users.daycare_id` and sends an invitation, instead of the current organization setup flow. Its effects depend on invoking the legacy system-admin-only path. | Remaining / scope dependency: retire or explicitly bridge the approval path, preserving system administrator authorization and records. Invitation delivery follow-ups remain excluded. No approval action was invoked. |
| `/reports` is a construction placeholder. | “View reports” grants lead to a page without reports or analytics. | Remaining product gap, not a newly introduced regression. Define report requirements and authorization before implementation; do not invent reporting scope in this PR. |

## Possible improvements, distinct from defects

- Tasks, Profile, Access Requests and Reports use older gradient/full-height shells; revising them around the shared card/typography system would reduce duplicated padding and improve visual continuity. Profile's schema/policy mismatch is corrected in the review branch; these pages are not comprehensively redesigned.
- Setup home has two cards pointing at the same preferences page, which always initially selects session types. Deep links to a specific preferences tab would make branch/category instructions more direct. Current links work; this is an improvement, not a broken route.
- The reused roles account detail page still returns to Team and highlights different parent navigation depending on its route. A context-aware breadcrumb/back target would improve orientation without duplicating permission editing.
- Expanded guides remain optional and easy to revisit. A dismissible first-visit prompt or progress checklist could be considered after use is observed; the prepared implementation uses native disclosure controls to avoid obscuring essential work.
- Very long user-provided names and unusual content should receive a separate stress pass beyond the synthetic short records. Physical device behavior and assistive technology testing remain unverified.

## Complete page coverage

“Reviewed” below means source/workflow inspection. “Prepared” means a change exists in the separate review branch. Existing server and database checks remain authoritative.

| Route | Integration/design assessment |
|---|---|
| `/` | Redirects to Dashboard; existing protected workspace routing retained. |
| `/dashboard` | Item #9 released; shared phone shell correction prepared separately. Role/grant mismatch, sampled totals and terminology gaps recorded above. Errors and work/status controls remain separate from hidden counters. |
| `/setup` | Existing navigation/grants reviewed; getting-started order prepared. Explains branch/type setup, staff access, client assignments, targets and scheduling. |
| `/setup/preferences` | Reads branches/types/categories/terminology; permission-specific editors, subscription controls and whole-minute validation retained. Guide prepared. Terminology propagation remains incomplete. |
| `/setup/care-teams` | Staff branches precede optional groups; explicit client assignments are separate. RPCs, version checks, shared active branch rules and save feedback reviewed. Guide prepared. |
| `/setup/roles` | Existing per-person grant definitions, account-management gate and invitation link reviewed; guide prepared. Custom roles remain excluded. |
| `/setup/roles/[userId]` | Reuses Team account editor, retaining self/owner/admin and delegation protections. Back-navigation improvement recorded. |
| `/operations` | Existing redirect to Setup preferences retained; legacy entry point still connects. |
| `/team-management` | Client branches/filtering, atomic client creation/care-team RPC and user-management links reviewed; guide prepared. The Team label covers both clients and people. |
| `/team-management/[userId]` | Account detail, supported grants, assigned clients via care membership, sessions and owner/admin protections reviewed. No new grant behavior. |
| `/team-management/invite` | Supported roles and permission-gated invitation API reviewed. Delivery follow-ups remain out of scope. |
| `/team-management/care-setup` | Existing redirect to Setup care teams retained. |
| `/clients` | Redirect in `next.config.ts` leads to Team. No duplicate client-list implementation. |
| `/clients/[clientId]` | Current target categories, care-team panel, client branches and session detail/workspace links reviewed; guide prepared. Database controls writes; some client edit affordances still rely on save rejection rather than capability-aware UI. |
| `/sessions` | Uses configured active types/defaults/locations; client-query entry point, target-copy behavior and explicit scheduling permission reviewed. Guide and responsive controls prepared. |
| `/sessions/[sessionId]` | Shared administrative detail/preparation workspace; configured-type bridge, guide and responsive layout prepared. Saved session copies remain distinct from reusable client targets. |
| `/sessions/[sessionId]/edit` | Same shared workspace; explicit save, unsaved-change handling, optimistic version condition and started/historical restrictions retained. Configured types and narrow layouts prepared. |
| `/my-sessions` | Assigned-session queries, outcomes and delivery links reviewed. Configured display-name gap remains; sidebar changes excluded. |
| `/my-sessions/history` | Provider-specific history, terminal outcome filters, paging and note links reviewed. No new care-group access shortcut. Long/mobile pagination stress checks remain an improvement area. |
| `/session/[sessionId]` | Delivery, response recording, pause/end and subscription completion exception reviewed. Session assignment remains separate from client care membership. Raw service-type label gap remains. |
| `/session/[sessionId]/complete` | Uses shared SessionNoteWorkspace; does not duplicate note editor or bypass protected actions. |
| `/reviews` | Capability RPC plus protected owner/admin note access reviewed. Submitted queue and shared note links connect. Service labels/terminology need alignment. |
| `/reviews/[sessionId]` | Shared note workspace in review mode; review permission, returned/submitted/approved/locked states and protected remarks/history retained. |
| `/tasks` | Legacy model/date/error gaps confirmed. Subscription save controls present. Older design needs revision once task-model ownership is decided. |
| `/profile` | Name/role/email and PIN settings reviewed. Prepared shared-design read-only account view matches the current database policies and removes unsupported phone/Save controls; loading/error/retry are explicit. |
| `/billing` | Subscription access/grant checks and read-only explanation reviewed. Disabled checkout and existing pricing/trial terms preserved; implementation excluded. |
| `/reports` | Construction placeholder, recorded product gap and old design. No reporting functionality invented. |
| `/access-requests` | Legacy owner requests and protected approval API reviewed; old/new organization pipeline gap recorded. No approvals or invitations sent. |
| `/login` | Email-code flow, resend/recovery state and protected authentication endpoints reviewed. No codes entered and no auth policy changes. |
| `/set-pin` | Existing PIN setup/reset and device session transition reviewed. No PIN entered or safeguard relaxed. |
| `/staff-login` | Existing redirect to Dashboard retained; legacy login API remains disabled. |
| `/onboarding-owner` | Current email verification, organization creation/resume and PIN destination reviewed. Business setup/trial logic retained. |
| `/request-access` | Existing redirect to owner onboarding retained. |
| `/onboarding` | Old teacher placeholder replaced by protected workspace redirect in review branch. |
| `/children` | Old placeholder replaced by Team redirect in review branch. |
| `/teachers` | Old placeholder replaced by Roles and permissions redirect in review branch. |

The 35 source page files cover these rows except `/clients`, which is an additional configured redirect. Framework-generated error/not-found handling and shared layouts were also inspected. The dashboard layout retains authentication/PIN checks, BranchProvider and SubscriptionWriteProvider. SessionGuard retains device checking/locking, and the note workspace retains server RPC authorization and audit/history behavior. No database policies, device safeguards or subscription rules are changed.

## Review and rollout boundary

The prepared scope is eight page-specific guides (the session guide serves detail and edit routes), phone navigation/layout corrections, three legacy redirects, the Setup shortcut, configured session types in the editor, and the schema-aligned profile correction. The unchanged audit gaps above are explicitly recorded for subsequent decisions. Pricing, payments, trial duration, invitation-delivery follow-ups, custom roles, Create clients toggle and My Sessions sidebar changes remain excluded.

Approve merging and deploying the separate review PR only after reviewing this scope and its verification evidence. Item #9 does not need approval again.
