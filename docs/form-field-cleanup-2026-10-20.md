# Form-field cleanup — October 20, 2026

## Scope and implementation

Starting main: 9e184aa80c8aa1f4b3b127f6018d3fc65c9973f0. Origin/main refreshed October 20 and matched HEAD. Branch: fix/plain-form-fields.

Removed nine decorative field adornments and compensating padding across six page implementations. The Roles detail route reuses the Team account editor. Native datetime pickers, select arrows, search clear controls, labels/placeholders, help/errors, handlers, grants and subscription checks remain intact. Unused Mail, Filter and Search imports were removed only where unused. Shared .rj-input padding remains 0.875rem 1rem; no global padding or !important change.

A browser inspection confirms the ordinary 16px left inset. The source cascade indicates why prior absolute-left adornments could occupy that same region: shared unlayered padding overrides Tailwind indentation. Removing both the decoration and its redundant utility resolves the collision without changing the CSS cascade.

At 640px the shared account editor's three summary cards overflowed beside the desktop sidebar. Their grid now starts at md rather than sm. This is a small responsive correction shared by both account routes; card icons remain.

No application workflow, schema, customer setting, invitation, billing or deployment change is included.

## Actual validation

- Direct installed TypeScript and affected ESLint commands passed; the local npx/npm wrapper points to a missing npm installation.
- Webpack production build passed with synthetic Supabase configuration. The final build after the responsive correction also passed.
- Synthetic Edge browser: seven affected routes, empty/populated search/email, disabled account email, five viewport widths (35 checks), all without overflow or decorative overlays across the text region; Sessions additionally checks native datetime entry and status selection. Screenshots at 375/1280px are synthetic only. Reviewed the mobile Sessions and desktop invitation screenshots directly.
- Default rendering/redirect smoke: all other static routes plus /clients at 375px (27 visits). This means navigation/rendering was exercised, not that every form state is signed off. Unknown fixture RPCs and blocked requests are retained in results.json; a fixture error is not authorization coverage.
- Unit runner failed at preflight: installed checkout lacks @electric-sql/pglite. Native PostgreSQL is also unavailable at 127.0.0.1:55439. No full required-suite/CI pass is claimed.
- No production requests, codes, invitations, organizations or access approvals were performed. The browser fixture intercepts external business requests and denies mutation endpoints.

Run tests/form-fields.browser.cjs against a synthetic local production server on port 3047, with Playwright available. Set PLAYWRIGHT_CHANNEL=msedge for installed Edge on Windows; CI uses pinned Chromium. The required CI browser step now includes this check. Evidence is written under work/form-field-evidence; the completion deliverables include the result JSON.

## Route/state coverage (39 pages plus /clients)

The middle column is the retained acceptance checklist, not a statement that every listed state was tested. Focused = inset/value/native-control checks; smoke = default state only. All states beyond those explicitly reported remain open.

| Route | Acceptance checklist | Completed coverage / remaining work |
|---|---|---|
| `/` | Destination Home and global unlock overlay | Source rescan; default rendering/redirect smoke at 375px only. |
| `/login` | Email, password method, email-code method; errors, autofill and disabled/sending state | Source rescan; default rendering/redirect smoke at 375px only. |
| `/staff-login` | Destination and authentication state | Source rescan; default rendering/redirect smoke at 375px only. |
| `/set-pin` | PIN and confirmation, mismatch/error and disabled state | Source rescan; default rendering/redirect smoke at 375px only. |
| `/onboarding` | Destination | Source rescan; default rendering/redirect smoke at 375px only. |
| `/onboarding-owner` | Email, code, full name, organization name, branch name and timezone selector across steps | Source rescan; default rendering/redirect smoke at 375px only. |
| `/request-access` | Destination owner onboarding | Source rescan; default rendering/redirect smoke at 375px only. |
| `/children` | Destination People | Source rescan; default rendering/redirect smoke at 375px only. |
| `/teachers` | Destination Roles | Source rescan; default rendering/redirect smoke at 375px only. |
| `/dashboard` | Calendar go-to date; range start/end; shared unlock overlay | Source rescan; default rendering/redirect smoke at 375px only. |
| `/attendance` | Name search, from/through dates, correction start/end local timestamps, correction/void reason; DST selection; activation/scope panels | Source rescan; default rendering/redirect smoke at 375px only. |
| `/tasks` | Organization-local task date and assignment selector | Source rescan; default rendering/redirect smoke at 375px only. |
| `/sessions` | Creation drawer/form: client/staff/type/location/tag searchable choices, new-type duration, start/end; list search/status; choice-management search and rename | Removed decorations; focused layout checks at 320/375/640/768/1280px. |
| `/sessions/[sessionId]` | Shared administrative editor: dates, location, duration, target/behavior selection, confirmation dialogs | Source rescan; record-specific browser states unverified. |
| `/sessions/[sessionId]/edit` | Same editor in editing, unsaved, disabled, started and historical states | Source rescan; record-specific browser states unverified. |
| `/activity/[sessionId]` | Activity start/end and location | Source rescan; record-specific browser states unverified. |
| `/my-sessions` | Assigned activity/clinical list, empty/error states and shared unlock overlay | Source rescan; default rendering/redirect smoke at 375px only. |
| `/my-sessions/history` | Outcome filter and shared shell | Source rescan; default rendering/redirect smoke at 375px only. |
| `/session/[sessionId]` | Clinical delivery states, recording buttons and shared unlock overlay | Source rescan; record-specific browser states unverified. |
| `/session/[sessionId]/complete` | Observations, final note and permission-dependent note actions | Source rescan; record-specific browser states unverified. |
| `/reviews` | Client/provider search and review filters | Removed decorations; focused layout checks at 320/375/640/768/1280px. |
| `/reviews/[sessionId]` | Observations/final note, return feedback, protected remark, read-only/locked state | Source rescan; record-specific browser states unverified. |
| `/team-management` | People search; create-child names/identifier; branch and care-member pickers | Removed decorations; focused layout checks at 320/375/640/768/1280px. |
| `/team-management/[userId]` | Full name, disabled email, role and grant/attendance-scope controls | Removed decorations; focused layout checks at 320/375/640/768/1280px. |
| `/team-management/invite` | Name, email and role | Removed decorations; focused layout checks at 320/375/640/768/1280px. |
| `/team-management/import` | Paste textarea, optional ID namespace, file input, mapping selectors and review checkboxes | Source rescan; default rendering/redirect smoke at 375px only. |
| `/team-management/care-setup` | Destination care-team setup | Source rescan; default rendering/redirect smoke at 375px only. |
| `/clients` | Destination People | Source rescan; default rendering/redirect smoke at 375px only. |
| `/clients/[clientId]` | Target search; child name/identifier edits; target name, materials, instructions; behavior name/description; selector/modal states | Removed decorations; focused layout checks at 320/375/640/768/1280px. |
| `/setup` | Readiness, setup links, tours and shared unlock overlay | Source rescan; default rendering/redirect smoke at 375px only. |
| `/setup/preferences` | Branch/type/category editors: name, code, description, default duration; terminology/name dialogs | Source rescan; default rendering/redirect smoke at 375px only. |
| `/setup/appearance` | Custom singular/plural terms, preset selector and theme radios | Source rescan; default rendering/redirect smoke at 375px only. |
| `/setup/care-teams` | Group name, branch/group selection and membership controls | Source rescan; default rendering/redirect smoke at 375px only. |
| `/setup/roles` | Account links and shared shell | Source rescan; default rendering/redirect smoke at 375px only. |
| `/setup/roles/[userId]` | Same account fields as Team detail | Removed decorations; focused layout checks at 320/375/640/768/1280px. |
| `/operations` | Destination preferences | Source rescan; default rendering/redirect smoke at 375px only. |
| `/reports` | Timezone input, name search and D3 from/through dates, report selectors | Source rescan; default rendering/redirect smoke at 375px only. |
| `/profile` | New/confirm password; new/confirm PIN | Source rescan; default rendering/redirect smoke at 375px only. |
| `/billing` | Subscription/action controls and shared shell | Source rescan; default rendering/redirect smoke at 375px only. |
| `/access-requests` | Request list, action/confirmation states and shared shell | Source rescan; default rendering/redirect smoke at 375px only. |

## Shared components and open coverage

Source rescan of app and components found no remaining pl-10/pl-11/pl-12 field decoration pattern or absolute-left form icon after cleanup. SearchableChoice, SessionChoiceManager, SessionContextChoices, SessionAdministration, SessionTypeDurationField, ActivityWorkspace, SessionNoteWorkspace, AttendanceWorkspace/Activation, OperationalReports, TasksWorkspace, ScheduleCalendar, profile password/PIN and SessionGuard remain plain. Branch/care/behavior pickers retain functional indicators. Navigation/tour/action/status icons remain.

Still open: rich shared picker create/loading/error/archive states; every profile/target/behavior dialog; attendance correction/void/DST/history; clinical activity/admin/note record states; true browser autofill, 200% browser zoom, global locked/unlock overlays, full keyboard/focus and help/error-association QA. The 640px reflow check is not a claim of actual browser zoom. The synthetic fixture does not validate RLS, tenant isolation, PIN enforcement or actual subscription authority.

## Review and release status

Local implementation and bounded workspace proposal only. No remote branch, PR, migration or deployment created. Do not call this fully release-verified until required CI and remaining acceptance coverage are addressed. Existing P1/P2 production release remains the last recorded release.
