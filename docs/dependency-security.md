# Dependency security update

Verified 2026-09-21. The prior lockfile had 20 npm advisory entries (2 critical, 14 high, 3 moderate, 1 low). After this update, the full npm audit reports zero known vulnerabilities, including development dependencies. This does not establish that the entire application is secure.

## Changes

- Next.js and eslint-config-next: 16.2.4 to 16.3.5.
- React and React DOM: 19.2.3 to 19.2.8, retaining the existing minor release.
- Supabase CLI: 2.95.2 to 2.117.0, removing its vulnerable tar dependency.
- Removed unused next-pwa 5.6.0 and its build dependency tree. It was neither imported nor enabled; the web app manifest and icons remain.
- Updated compatible transitive dependencies and pinned runtime dependencies. Supabase browser/server SDK versions remain unchanged.

## Verification

- Clean npm ci with normal installation scripts: passes, zero advisory findings.
- All 33 PIN, device-session and client-branch regression tests: pass.
- TypeScript check and production Next.js build: pass. Local build used placeholder Supabase configuration; deployment builds use Vercel configuration.
- Supabase CLI version and migration-new help: pass. In the restricted local environment, SUPABASE_HOME was directed to a writable workspace folder and SUPABASE_TELEMETRY_DISABLED=1 was set only for that command.
- No database schema or production data changes.

## References

- [Next.js August security release](https://nextjs.org/blog/august-2026-security-release)
- [Next.js 16.3.5 release](https://github.com/vercel/next.js/releases/tag/v16.3.5)
- [Supabase CLI 2.117.0 release](https://github.com/supabase/cli/releases/tag/v2.117.0)

Continue auditing invitation/delegation boundaries, historical records, audit logging, onboarding and commercial billing independently of this package update.
