# Tenant isolation — F02 remediation

Verified September 20, 2026 (America/Chicago). Backend: Supabase project `lvtabzfkajgicjfexvxx`.

**F02 is remediated for the inspected database relationships.** Organization reads were already scoped by RLS, but a caller could previously create a session for their organization using a client ID from another organization. The database now rejects that combination, including privileged application writes that bypass RLS.

## Applied migrations

- `20260920183815_enforce_tenant_relationships.sql`: validated tenant-aware foreign keys, immutable established membership, session/client context, and pre-commit synthetic checks.
- `20260921000456_index_owner_request_organization.sql`: covers the new owner-request relationship with an index after the performance advisor identified it.

These files record migrations already applied to the live project. Do not rerun their SQL manually there. Their versions match the live migration history.

## Enforced boundaries

| Area | Result |
|---|---|
| Existing organization-bearing relationships | All 30 now include organization identity in their foreign keys. |
| Task completions | Organization is derived from the task for existing callers; both task and teacher references must match it. Task is required. |
| Task-template classrooms | New composite foreign key prevents foreign or nonexistent classrooms. |
| Total tenant-aware relationships | 33 validated foreign keys. |
| Established organization identity | Protected from ordinary reassignment on 22 tables, including privileged application writes. |
| Initial membership | Unaffiliated Auth profiles may still receive their first organization through the existing trusted provisioning path. |
| Session target source | Must belong to the same client as its session. |
| Behavior event source | Must belong to the same client as its session. |
| Target response | Its target must belong to the stated session and organization. |
| Null bypass | Business rows require organization IDs; optional parent IDs remain optional. |
| Owner requests | Optional organization now references a real organization. Browser access remains denied. |

The three new trigger functions use `SECURITY INVOKER`, an empty search path, and the existing private schema. They grant no browser-callable RPC and introduce no permissive RLS policy. Existing device/PIN gating remains active.

The original foreign-key names were retained for PostgREST relationship hints. Existing `CASCADE`, `NO ACTION`, and `SET NULL` actions were preserved. For composite keys, `SET NULL` clears only the optional reference ID, preserving the organization and client context. Native foreign keys enforce relationships during concurrent writes; no cross-table `CHECK` lookup is used. See [PostgreSQL constraint documentation](https://www.postgresql.org/docs/17/ddl-constraints.html) and [Supabase nested-query documentation](https://supabase.com/docs/guides/database/joins-and-nesting).

Operational consequences: a classroom referenced by a task template must be unlinked from that template before deletion; an organization referenced by an owner request cannot be deleted leaving an orphan request. Changing a session's client while dependent records exist is rejected. A future cross-organization account-transfer feature needs an explicit, audited workflow; ordinary profile edits cannot transfer membership.

## Verification

Before migration, all 30 existing relationships had zero organization mismatches. The new classroom and owner-request references also had no invalid existing records. No business row required tenant repair.

The main migration ran self-cleaning synthetic tests inside its transaction before commit. Additional post-application tests passed:

- Every one of the 33 relationships rejected a foreign-organization parent.
- All 22 protected tables rejected established organization reassignment.
- The original authenticated-owner session/client exploit is rejected.
- All 11 supported staff roles were denied foreign-organization reads, session writes, and target-preparation RPC access. The role matrix exercises PostgreSQL's authenticated role and real RLS with synthetic unlocked Auth/device sessions.
- Same-organization but wrong-client or wrong-session relationships are rejected, including parent updates that would invalidate existing children.
- Valid inserts derive the new fields for existing application callers.
- Optional-reference deletion, blocking deletion, and cascading deletion passed.
- A valid assigned provider started a session, recorded target and behavior data, finished, saved/submitted documentation, received a correction request, resubmitted, and reached an approved/locked note.
- Eight HTTP PostgREST checks passed, including the production sessions, review, and tasks nested-query shapes. These use a publishable key and `limit=0`: they verify relationship resolution without reading customer records, not signed-in browser rendering.
- The device-session SQL regression passed, including PIN setup, lock, 30-day full-authentication and seven-day inactivity rules.
- All 30 existing PIN/device-session application tests passed.
- Synthetic records rolled back; no fixture accounts remain. Production counts stayed at one organization, four users, 895 tasks, and zero clients/sessions.

Re-run `supabase/tests/tenant_relationships.sql` with a database administrator connection. It creates synthetic fixtures in a subtransaction and discards them on success; an assertion failure aborts the statement. Run the HTTP smoke script with a public publishable key in `REJOYCE_PUBLIC_KEY`: `node tests/tenant-api-smoke.cjs`. Never use a service-role key for that smoke script.

## Advisor results and limits

Security advisors reported no new categories: the existing 38 intentionally authenticated SECURITY DEFINER function notices and disabled leaked-password protection remain. These are not a clean-bill-of-health claim. See [function-execution guidance](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) and [password protection guidance](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

All newly added/composite foreign keys have covering indexes. Existing performance findings remain: seven other unindexed foreign keys, RLS planning/multiple-policy warnings, duplicate or unused indexes, the legacy table without a primary key, and Auth connection configuration. See [foreign-key index guidance](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys).

This closes the confirmed F02 relationship-integrity flaw; it does not certify the complete commercial product. No new independent two-connection concurrency stress test or full signed-in browser lifecycle was performed in this change. Cross-tenant protection still depends on RLS and authorization in every service-role endpoint for reads; a service-role credential inherently bypasses RLS.

## Remaining order of work

1. Triage and fix the outstanding dependency vulnerabilities against current advisories.
2. Unify invitation, granular-permission, and role-delegation rules; ask for the desired hierarchy before changing product policy.
3. Finish historical-record protection, review UI, audit logging, and the legacy scheduler authorization/reliability work.
4. Build self-service onboarding, including the deferred [required initial PIN acceptance check (#9)](https://github.com/boomthewiz/daycare-saas-platform/issues/9).
5. Build subscription/entitlement infrastructure and launch operations.
