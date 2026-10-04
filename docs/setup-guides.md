# Getting-started guides and workflow bridges

The optional, closed-by-default Getting started disclosure appears on Setup home,
preferences, care teams, roles, Team, client detail, scheduling, and session
detail/edit. It explains ordering, optional configuration, permissions and how
configuration reaches everyday work. Native disclosure controls remain keyboard
accessible and do not cover editing controls. Reopen the guide whenever needed.

Configured session types replace the fixed service list in SessionAdministration.
Only active choices and the original saved type are offered. An unlisted saved
code remains available as a fallback. A configuration-load error retains the
session and disables changing its type. The lookup is scoped by the saved
session's organization. Choosing a type in this editor never changes its times;
the scheduling page retains its existing new-session default-duration behavior.

The shared sidebar uses a compact labeled phone rail below 640px and retains
desktop expand/collapse behavior. No navigation destinations, ordering or grants
change, including My Sessions. Legacy Children, Teachers and staff onboarding
entry points redirect to existing protected workflows. Profile is a read-only
account view with PIN settings: the production users table lacks phone storage,
and current UPDATE policy excludes self-updates. These rules are preserved.

See [the full page audit](page-integration-audit.md) for confirmed remaining gaps
and possible improvements. No database migration, subscription change or
permission expansion is part of this branch. Production rollout needs separate
approval beyond item #9.

## Verification

The existing 97 Node tests include real isolated PostgreSQL authorization tests
when REJOYCE_BASELINE_SQL and REJOYCE_PGLITE_MODULE are provided. The existing
client-branch component harness now stubs the unrelated guide component.

`tests/setup-guides.browser.cjs` follows the existing Playwright harness pattern.
Start a local production build with NEXT_PUBLIC_SUPABASE_URL set to
`https://workflow-test.supabase.co`, synthetic public/service keys, and port 3037.
Provide Playwright through NODE_PATH and installed Chrome. Run from the repo root:

```text
node tests/setup-guides.browser.cjs
```

TEST_BASE_URL may override the local URL. All external browser requests are
blocked except the synthetic Supabase responses intercepted by the fixture.
Saved updates affect the in-memory synthetic session only. The test verifies
63 guide/layout cases (nine routes at seven widths), closed/expanded guides,
configured and saved legacy types, one explicit saved/reloaded type change,
unchanged times, lookup failure, denied/read-only/historical controls, dashboard
loading, legacy redirects and the profile's lack of unsupported writes. It does
not enter codes or PINs. Evidence is written under work/setup-guide-evidence.

TypeScript, changed-file ESLint, production build and whitespace checks are also
required. Physical phones, production authenticated flows and every role/content
combination across the unchanged pages are outside these synthetic checks.
