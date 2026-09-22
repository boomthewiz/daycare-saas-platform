# Invitation and permission security

Reviewed against main commit `72ce8ede98e9a5ce13b78682843afd24762c3d26` and the relevant live database definitions on 2026-09-22.

## Security fixes

- Resend previously checked the submitted role, allowing a manager to submit `staff` for an existing administrator. It now also authorizes the stored target role and enforces the existing UI protections for self and owner accounts.
- Resend no longer writes a previously loaded role/name back to the profile, avoiding overwriting concurrent account changes.
- A resend with no existing organization profile returns 404 instead of creating an account.
- Case-insensitive email lookup escapes SQL pattern characters and rejects ambiguous results.
- Auth directory lookup fails closed if its pagination limit is reached.
- Resend uses one Auth recovery-email request. The unused `generateLink` step was removed. No authentication link is returned to the caller.
- The existing owner/admin-only billing toggle is now enforced for database INSERT, UPDATE and UPSERT operations. Moving a billing grant to another recipient is also protected. An unchanged billing grant may still be included when saving other permissions.

The billing migration is applied to project `lvtabzfkajgicjfexvxx`, with version `20260922220114`. Its trigger is security invoker, uses an empty search path, is in the private security schema, and has no direct execute grants to browser roles. Existing tenant, target-account and unlocked-session RLS checks remain in force. Trusted server/database operations retain their existing authority.

## Approved delegation setting

Owners/admins now control **May delegate permissions** on the team member page. The new `can_delegate_permissions` column defaults to false. Non-owner/admin accounts require both Manage users and this setting to edit another account's permission grants. Manage users continues to allow profile/account management without delegation authority. Owners/admins retain existing target-management restrictions; a non-owner administrator still needs Manage users.

Only owners/admins can grant or revoke delegation authority. Approved delegates can edit other nonbilling grants, including Manage users, but cannot pass on delegation authority or change billing. Self, owner-account, tenant and session restrictions remain enforced. Revocation is evaluated from current database state rather than a stale JWT claim.

Migration `20260922220541` is applied to the backend. Existing managers have delegation disabled until an owner/admin enables it. The UI changes require deployment of this branch.

## Product decisions still pending

The invitation page/API currently authorize owner, admin, manager and director roles. Database team management instead requires `can_manage_users` (owners bypass the flag). Aligning these affects which accounts may invite and requires a product decision.

Role assignment already rejects the owner role and reserves assigning admin for owners/admins. Target management does not impose a full hierarchy: a user manager can modify a non-owner administrator if the resulting role is assignable. This behavior has not been changed without a product decision.

The [permission settings foundation](permissions-foundation.md) centralizes grant definitions, defaults, normalization, and editor checks. Broader customization rules and initial PIN onboarding verification (issue #9) remain pending.

## Validation

- `node --test tests/*.test.cjs`: 52 passing tests, including invitation, delegation UI, and permission foundation regressions.
- `node node_modules/typescript/bin/tsc --noEmit --incremental false`: passed.
- `node node_modules/eslint/bin/eslint.js app/api/invite-user/route.ts`: passed.
- `supabase/tests/billing_permission_delegation.sql`: reproduced the pre-fix manager billing grant, then passed after the migration. Covers manager/director/staff, owner/admin, grant/revoke, INSERT/UPDATE/UPSERT, recipient reassignment, unchanged billing grants, and nonbilling saves. Synthetic records and JWT settings roll back; no email is sent.
- `supabase/tests/permission_delegation.sql`: passed. Covers default denial, approved delegation, prevention of onward delegation, owner/admin control, immediate revocation, unchanged delegation values during other saves, and self/owner/foreign/locked-session restrictions. All synthetic fixtures roll back.
- Security advisor reports no finding for the new trigger. Existing warnings remain for [authenticated security-definer RPCs](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) and [disabled leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). Unrelated RPCs were not expanded into this review.

Email delivery and browser acceptance of a real invitation were not tested; the route tests mock Auth/email operations.
