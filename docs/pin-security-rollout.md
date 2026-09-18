# PIN hash access restriction

The dashboard and PIN setup now use an authenticated, uncached `/api/pin-status` endpoint returning only `hasPin` and `resetRequired`. The server verifies the supplied Auth token and always looks up that identity. Profile queries explicitly name public fields. PIN setup validates four digits and clears reset state; PIN login rejects inactive and reset-required profiles.

## Deployment order

1. Deploy this application change to Vercel. It is compatible with the existing database grants.
2. Verify the deployed `/api/pin-status` returns 401 without authentication. With a test account, confirm its response contains only the two booleans. Confirm dashboard, profile, initial PIN setup and reset navigation.
3. Apply `supabase/migrations/20260918041744_restrict_pin_hash_reads.sql` to Rejoyce App. Do not run a blanket database push: earlier live security migrations are not yet reconciled into this repository.
4. Run `supabase/tests/pin_hash_access.sql` and the Supabase security advisors. Verify the Data API denies selecting or filtering on `pin_hash` while ordinary profile fields remain available. Repeat the signed-in UI checks.

Tests: `node --test tests/pin-security.test.cjs`; `npx tsc --noEmit --incremental false`.

The migration removes table-wide SELECT, explicitly denies hash reads and grants only existing non-secret fields to authenticated users. Existing RLS remains in force; service_role keeps credential access. Old cached pages that request the hash will fail after the restriction and must be refreshed. Future profile fields require explicit grants.

Do not roll the application back to the old hash-reading pages after applying the restriction. Prefer rolling forward; restoring broad SELECT would reopen the exposure. Existing PINs are preserved. This fixes ongoing hash disclosure, not any prior disclosure. Existing PIN rotation/session revocation needs a separately coordinated recovery plan with the account owner.

This is not complete PIN-authentication hardening. Durable throttling/device restrictions, privileged-user authentication requirements, and other audit findings remain separate work. The pre-existing profile-edit flow (including its nonexistent phone field and self-update policy) is not repaired here.
