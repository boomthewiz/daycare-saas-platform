# People setup, CSV imports and portal presets

Sessions now opens a dismissible setup dialog when the business has no active clients or no active frontline accounts. `session_people_readiness` returns only two booleans to unlocked session managers. Organization-wide readiness avoids treating a restricted staff list as an empty business. Owners and administrators alone do not count as eligible frontline staff. The dialog opens once per page visit; Refresh does not reopen a dismissed dialog. Existing inline requirements remain.

## Import people

People → Import people and Setup → Import people open `/team-management/import`. CSV files up to 1 MB and 100 people are supported. The admin maps columns, previews rows, then explicitly confirms the ready rows. Duplicate and invalid rows are shown with explanations. Row reports include row numbers and outcomes, escape formula-like errors, and contain no names or emails. Uploaded files are read in the browser and are not stored.

Client columns: `external_id`, `first_name`, optional `last_name`, optional `preferred_name`. External ID and first name are required. Pick one active business branch for the list. The database imports an entire valid batch atomically through the existing care-team creation functions, creating branch memberships without assigning care staff. The external ID is unique per business; repeat imports skip it without changing existing records. Imports from different systems must use distinct ID namespaces. Manually created clients lack an import ID and must be reviewed before importing matching names. This first release creates records; it does not synchronize updates or merge existing people.

Staff columns: `full_name`, `email`, `role`, all required. Supported roles are listed in the interface. Owner and admin accounts must be added individually. Confirming explicitly sends invitations through `/api/invite-user` one at a time, preserving its role, tenant, subscription, device and email-limit safeguards. Existing accounts are skipped without resending invitations or changing their roles. A failed or uncertain response pauses the batch; failed rows require review in People/the individual invitation screen. Remaining ready rows can be continued. Navigating away stops subsequent invitations, though an in-flight request can complete. Download the report before leaving; previews are not persisted.

API integrations and SFTP scheduling are future extensions, not configured by this release. The authenticated client import RPC is an internal portal action, not a public integration-key API.

## Appearance and vocabulary

Setup → Appearance & vocabulary opens `/setup/appearance`. General services, Education, Childcare and Therapy presets fill singular/plural labels for clients, frontline staff, sessions and targets. Each term can be overridden. ReJoyce, Ocean and Lavender visual themes are selected independently. Changes are previewed before saving and apply to the business after reload; the saving user's current workspace refreshes immediately.

Vocabulary is applied to primary navigation, People, scheduling, client profiles, care setup, My Sessions, session delivery and documentation interface copy. Routes, role values, permission names, technical import column names, user names, notes, saved session-type names and historical data retain their original meanings. Authentication session terminology is unchanged. Backend error text and a few legacy screen descriptions retain system vocabulary. Visual themes cover portal design tokens and primary action colors; semantic error/success colors retain their meanings.

Changes require existing Manage clients or Manage sessions permission, plus subscription write access and an unlocked device. The existing terminology editor continues to work and refreshes the workspace vocabulary after saving.

## Release and rollback

Apply `20261007195601_portal_enhancements.sql` before deploying the UI. It adds a default ReJoyce theme, nullable client import IDs, a unique index, readiness functions and an invoker import function. Existing terminology RLS/device/subscription rules protect the theme; the private readiness function authorizes session management before counting business-wide records. No production migration or deployment is part of preparation.

Rollback the frontend first if necessary. Additive columns/functions can remain. Do not drop import IDs after real imports; they prevent duplicate creation on repeat uploads. No existing business records are rewritten by the migration.

## Verification

Run `node --test tests/*.test.cjs` with `REJOYCE_BASELINE_SQL` pointing to the pre-care schema snapshot and `REJOYCE_PGLITE_MODULE` pointing to PGlite. The suite tests database imports, atomic failures, repeat IDs, unauthorized/foreign/locked/revoked/expired/anonymous requests and preset RLS. CSV and vocabulary tests run without the database fixture. Browser acceptance uses synthetic data in isolated PostgreSQL and a loopback-only mail stub; it sends no real emails.

## Live onboarding and staff readiness

Apply `20261008061322_onboarding_progress.sql` after the portal and care-team migrations before releasing this UI. No production migration, merge or deployment has been performed during preparation.

Setup now reads `onboarding_progress()` on mount, focus, visibility return, manual refresh and every 30 seconds while visible. Requests are versioned; errors invalidate stale completion state. Four milestones track an active service type, active client, ready frontline account and a non-cancelled scheduled session. Saved branches are optional because scheduling permits custom locations. Care groups/default workers are optional shortcuts; explicit care membership with a shared active branch grants ongoing client access. A person assigned directly to a session can deliver that session. Appearance and vocabulary remain optional.

Readiness requires an active frontline role, confirmed authentication email, completed PIN setup without a reset requirement, and no current authentication ban. It does not guarantee a current unlocked device or future availability. Owner/admin/manager accounts do not count. This informational checklist does not alter scheduling authorization or eligible-provider selection.

The private, fixed-search-path definer returns tenant-scoped booleans to active unlocked organization members. `p_include_staff=true` additionally requires Manage users and returns only IDs already used by People plus readiness/assignment booleans and invitation state. No auth records, credentials, PIN hashes, names, emails, timestamps or tokens are exposed. Grants exclude PUBLIC/anon. Subscription write access is returned separately; expired trials retain the existing browsing behavior.

People shows account status separately from invitation acceptance and session readiness. Auth `invited_at` without `email_confirmed_at` means pending acceptance; a confirmed email is labelled accepted/email confirmed. Missing auth evidence is unknown. The stored data does not reliably establish delivery, expiration or prior send failures, so the UI does not invent those states. Resend remains under Manage through the existing invitation route, permissions, rate limits and duplicate checks.

At widths below 640 px navigation uses a native modal dialog. The labelled Menu button reports expanded state; the drawer focuses Close, traps keyboard focus, closes on Escape/navigation and restores focus to Menu. Desktop collapse and permission-filtered active links are preserved. The closed mobile drawer occupies no content width.
