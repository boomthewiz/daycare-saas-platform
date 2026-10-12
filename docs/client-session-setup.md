# Client targets and reusable behaviors

Implemented on `fix/client-session-setup`, based on fetched `origin/main`
`62c302f99eb5a91c975e1a990d21034f3513a83c`. The initial working tree was clean.

## Changes

- Client Behaviors now offers an existing-definition dropdown. Definitions come
  from `client_behaviors` in the destination organization, under existing RLS,
  and are loaded only after `can_manage_clients` succeeds.
- Applying a definition creates an independent client record. A case-insensitive,
  trimmed name plus measurement type identifies an existing assignment. Repeated
  requests reuse its ID; an inactive match is reactivated without replacing its
  client-specific guidance or historical event references. Already-active matches
  are disabled in the dropdown.
- `apply_client_behavior` is SECURITY INVOKER, with a destination-client row lock
  to serialize concurrent applications. Existing PIN RLS, organization/client
  permissions, tenant foreign keys and subscription triggers remain authoritative.
  Anonymous callers have no EXECUTE grant. Different measurement types remain
  distinct definitions. This does not alter or consolidate historical duplicates.
- Target forms now submit the production response modes
  `independent_prompted_retry`, `correct_incorrect`, `frequency`, `duration`,
  `custom`. Default: `independent_prompted_retry`.
- Target types now match the production constraint: `discrete_trial`, `frequency`,
  `duration`, `interval`, `task_analysis`, `natural_environment`, `other`.
  Default: `discrete_trial`. The old default `skill_acquisition` would also fail
  after fixing the reported response-mode error.
- Behavior measurements now match the production constraint: `frequency`,
  `duration`, `interval`, `intensity`. Removed unsupported `frequency_duration`.
- Database CHECK constraints were inspected read-only in production and are not
  weakened or changed by this implementation.

## Validation

`tests/client-program.test.cjs` checks all 35 type/mode combinations against real
isolated PostgreSQL, rejects the old invalid response modes, verifies repeated
assignment and reactivation, checks session preparation and behavior recording,
and checks denied permissions, foreign organizations, locked/revoked devices,
anonymous access and expired subscriptions. Existing PIN, permission, device,
subscription and care-team tests were also run: 52 tests passed, none skipped.

`tests/client-program.browser.cjs` uses Playwright with API interception backed by
isolated PostgreSQL, real RLS and the actual migration. It verifies the dropdown,
interrupted request/retry, persistence after reload, disabled duplicate option,
creation through each of the five response modes, and creation of a prepared
session with all five target modes preserved. No production API writes occur.

TypeScript, lint for all changed code/tests, `git diff --check`, and the optimized
Next.js production build passed. The build used Webpack and synthetic Supabase
keys; network access was required only to download the existing Google Fonts.

To run database tests, set `REJOYCE_BASELINE_SQL` to the existing pre-care schema
snapshot and `REJOYCE_PGLITE_MODULE` to the installed PGlite package, then run:

```sh
node --test tests/client-program.test.cjs tests/care-team-db.test.cjs tests/pin-security.test.cjs tests/permissions.test.cjs tests/subscription-plan.test.cjs tests/device-session.test.cjs
```

For browser tests, start Next locally using
`NEXT_PUBLIC_SUPABASE_URL=https://workflow-test.supabase.co` and a synthetic anon
key, with Webpack (the existing dependency junction prevents Turbopack startup).
Set `NODE_PATH` to the installed Playwright package directory if needed, and run
`node tests/client-program.browser.cjs`. Default test URL: `http://127.0.0.1:3037`.

## Release dependency

The migration `20261012203249_reusable_client_behaviors.sql` must be applied before
releasing the frontend that calls its RPC. It has been tested locally and applied
to production with explicit release authorization. Production SQL regression
checks passed and rolled back every synthetic fixture. Security-advisor findings
were unchanged (32 existing definer-function warnings and one existing
password-protection warning).
The separate staff-invitation 403 investigation remains unresolved and untouched.
