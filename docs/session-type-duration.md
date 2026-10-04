# Session-type default duration (item 8)

Proposed product rule, pending rollout approval: a required whole number of minutes from **1 through 1,440**, inclusive (24 hours). This limits the reusable default, not all actual session lengths. Existing scheduling calculations are unchanged.

The settings editor uses text entry with `inputMode="numeric"` so invalid pasted text stays available for correction. The label is “Default duration (minutes)”; the unit remains outside the input and there is no decorative clock inside it. Empty, zero/negative, fractional/nondecimal syntax, and oversized values receive specific inline feedback on blur or submit. The save handler validates before converting to a number or making a request. Drafts survive validation and database errors. Only ASCII digits are accepted; exponents, signs, separators, surrounding whitespace and decimal notation are rejected by the editor.

## Database enforcement and legacy records

Migration `20261004163145_session_type_duration_validation.sql` changes the column from nullable integer to **unscaled numeric**, preserving values. Integer and `numeric(p,0)` can round fractional inputs before constraints evaluate; unscaled numeric retains the fraction and the check rejects it. A CHECK requires a non-null, integral value between 1 and 1,440 for every INSERT/UPDATE, including an UPSERT conflict update. PostgREST uses the same table constraint; no alternate privileged write path is introduced. API numeric representations are checked by numeric value; lexical input restrictions apply in the editor.

The check is initially `NOT VALID`: historical missing or oversized records stay readable without replacement. Any write to such a row, including an active-state toggle, requires correction of its duration first. Open Edit, choose a valid duration, and save. No scheduling fallback/default for legacy records is changed. Once all records satisfy the rule, an operator can validate the check after approval:

```sql
SELECT count(*) FILTER (WHERE default_duration_minutes IS NULL) AS missing,
       count(*) FILTER (WHERE default_duration_minutes NOT BETWEEN 1 AND 1440
                        OR default_duration_minutes <> trunc(default_duration_minutes)) AS invalid
FROM public.session_types;
-- Only after missing=0 and invalid=0:
ALTER TABLE public.session_types VALIDATE CONSTRAINT session_types_duration_supported_check;
```

Read-only production audit on October 4, 2026: 7 rows; minimum 45, maximum 60; 0 missing and 0 outside the proposed range. Recheck immediately before any approved migration. No business records were modified.

## Verification

- 97 Node tests pass without skips using the existing isolated PostgreSQL baseline and PGlite runtime. `tests/session-type-duration.test.cjs` covers strict syntax, boundaries, database INSERT/UPDATE/UPSERT rejection (including fractional coercion, null, NaN/infinity), unchanged legacy reads, correction, and validation of the constraint.
- `supabase/tests/session_type_duration.sql` verifies authorized INSERT/UPSERT, fractional UPSERT rejection, cross-business requests, and denied INSERT/UPDATE/UPSERT for no Manage sessions grant, locked/revoked devices, expired subscriptions, and anonymous callers. Existing Setup/delegation/administrator/billing-grant tests also run against the changed column. RLS, permission functions and triggers are unchanged.
- TypeScript, changed-file ESLint, production build, and whitespace checks pass. CJS tests follow the repository's Node test conventions with a scoped exception for CommonJS imports.
- Synthetic browser checks cover desktop and 390×844 mobile creation/editing, valid saves/reloads, bounds, invalid entries and clipboard pastes, unit visibility, absent input clock, and preserved drafts after validation and duplicate-code database errors. Mobile uses the existing sidebar collapse control. A physical phone keypad was not tested; the `numeric` input-mode hint was verified.
- 20 invalid HTTP INSERT/UPDATE requests fail with constraint code 23514 through a loopback adapter backed by isolated PostgreSQL. It is not a live PostgREST server; direct UPSERT and authorization enforcement are verified in PostgreSQL. Authenticated production UI and writes were not exercised.

Run the tests using the existing harness:

```powershell
$env:REJOYCE_BASELINE_SQL = '<schema-only test baseline.sql>'
$env:REJOYCE_PGLITE_MODULE = '<PGlite dist/index.cjs>'
node --test tests/*.test.cjs
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js 'app/(dashboard)/setup/preferences/page.tsx' components/SessionTypeDurationField.tsx lib/session-type-duration.ts
```

## Rollout and rollback

The draft PR does **not** authorize migration, merge, or deployment. Obtain separate approval for the proposed product rule and rollout. Reaudit production values, apply the migration, check real PostgREST rejection with disposable non-production records, then merge/deploy the editor and verify production reads and user-authenticated flows. Old open editors may receive a database error for formerly optional or oversized values; valid values continue to work.

Rollback needs separate approval: revert the editor, drop only the new check, and restore integer storage after confirming all values are integral and fit an integer. The previous positive-or-null constraint remains in place throughout. Reload the PostgREST schema. Keep existing legacy values intact.

Read-only Supabase security advisors report existing callable SECURITY DEFINER functions and disabled leaked-password protection. This migration introduces no functions, policies, grants or auth changes. Review those independently using the [function advisor guidance](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) and [password protection guidance](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
