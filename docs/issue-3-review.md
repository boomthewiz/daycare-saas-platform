# ReJoyce issue #3 — invitation safeguards

Base: boomthewiz/daycare-saas-platform at 410c62ff164297035ceed359c622c37afb80c85a.
Updated October 3, 2026. Production rollout in progress; issue stays open pending live acceptance.

## Evidence and SMTP

September 30 logs showed POST /invite HTTP 429, over_email_send_rate_limit, at 22:49:26 and 22:54:41 UTC. No Auth accounts or organization profiles were created in that window. The logs establish an Auth email quota rejection; they do not establish the current SMTP configuration or provider reset time.

The user confirmed GoDaddy Microsoft 365 SMTP, support@rejoyceapp.com, smtp.office365.com:587 with STARTTLS, SMTP Authentication enabled, and successful delivery after enforcing per-user MFA. Browser inspection on October 3 independently confirmed custom SMTP enabled, smtp.office365.com, port 587, sender name ReJoyce, and a 60-second minimum interval per user. Credentials were not read. Organization-wide Security Defaults were not independently inspected. Resend is not the selected provider.

Current Supabase guidance: https://supabase.com/docs/guides/auth/auth-smtp . Custom SMTP and Auth rate limits are separate controls. Preserve existing abuse controls. Do not infer the live quota from documented defaults.

## Behavior and security

Invite and resend share a persistent ten-minute reservation keyed by SHA-256 of the normalized recipient. Auth email quota errors extend invitation-project backoff to one hour. HTTP 429 responses include a wait message, stable code, retryAfter seconds, Retry-After and no-store. Missing or malformed reservation responses fail closed with 503. Reservations remain on success, failure and ambiguous timeout.

Private rejoyce_security storage has RLS, no browser grants, and service-role-only SECURITY INVOKER RPCs with an empty search_path. Both RPCs lock the project row first to serialize admission. This is a cooldown, not indefinite exactly-once delivery. Project backoff covers invitation/resend; email login retains its existing controls.

Existing unlocked-session, caller identity, active-account, organization write access, granular permission, stored-target role, self/owner/admin, and cross-business restrictions remain. Pricing, payments and trial duration are on hold.

## Verification

- Patch applies to current main; all 57 invitation, device-session and PIN security regressions passed locally.
- Full Next.js production build passed, including TypeScript and static generation, with inert local Supabase placeholders. Vercel must also build with its configured environment.
- Changed production TypeScript files pass ESLint. The CJS test file hits the repository's existing no-require-imports rule; do not rewrite its established harness for this fix.
- Prior rolled-back SQL assertions covered admission, duplicate suppression, project backoff, expiry, RLS and service_role calls. Repeat after migration in rolled-back transactions.
- Real concurrent database transactions and live invitation/resend/acceptance checks remain required.
- Baseline Security Advisor has 32 existing authenticated SECURITY DEFINER warnings and disabled leaked-password protection. This migration uses invoker functions; preserve unrelated authorization implementations.

## Acceptance and rollout

The Supabase CLI generated supabase/migrations/20261004011959_invitation_email_reservations.sql. Apply the reviewed migration before deploying the route; absent RPCs fail closed. Keep the SQL draft as a reference, not a second migration.

Live URL inspection confirms https://www.rejoyceapp.com as Site URL and wildcard allowlists for www, apex, m, and localhost:3000. The live invitation template uses ConfirmationURL. Invitation/recovery links alone cannot create trusted device state. Email-code verification must precede PIN setup and workspace access; preserve that gate.

DNS inspection found SPF v=spf1 include:secureserver.net -all, DMARC p=quarantine with relaxed alignment, and both Microsoft DKIM selector CNAMEs. DNS presence does not prove DKIM signing or SPF/DMARC pass on delivered mail; inspect a real message's authentication results.

User authorized a staff test at esmithmontg04+rejoyce-test@gmail.com in the existing owner's organization. Do not resend to or alter the owner account. User should enter email codes and PIN directly; never request credentials in chat.

Create a PR, verify preview, apply and verify the migration, merge, confirm Vercel production commit, then test invitation, immediate resend suppression, resend after cooldown, email verification, PIN setup and workspace access. Record exact results and remaining checks; leave issue #3 open until acceptance passes.
