# Daycare operational reports and guided setup

Slice 2 implements the code and forward migrations for D1–D3 and the base Setup/People/Reports tours. It depends on the inventory in PR #35. No production migration, deployment, invitations, imports, subscriptions or customer records were changed during implementation.

## Implemented behavior

Reports is now a permission-filtered library. D1 is a current people/status/branch snapshot; D2 is current staff account status, invitation acceptance, PIN/account readiness and active branch assignment; D3 lists recorded scheduling activity with configured activity names and a safe legacy-code fallback. None establishes attendance, enrollment history, staff presence, classroom coverage or payroll.

The shared `effective_capabilities()` result feeds navigation, Setup access, report eligibility and tour eligibility. It calls the existing server checks; legacy navigation flags no longer decide management links. Note-admin review access remains intact. Access Requests follows the same active system-administrator condition as its existing server API. This does not create or broaden any grant, entitlement or product profile.

`operational_report()` runs as the caller with RLS and explicit tenant/record filters. All three reports require `can_access_reports()`. D1 additionally requires existing client or schedule management authority (both already have organization roster reads); D2 requires Manage users; D3 requires Manage sessions. Unknown report IDs and invalid date/page/filter requests fail. Foreign branch IDs are rejected. Current membership uses EXISTS rather than a multiplying join. Reads remain available under the existing read-only subscription rules; timezone writes require current editing access. The public/private RPC ACLs deny anonymous calls.

Results use stable ordering, a maximum of 100 rows per page and a `hasMore` flag. Pages are independent fresh snapshots, so concurrent record changes can affect pagination. There are no global totals that could imply a complete historical census. Selecting a page explicitly queries it. Changing filters clears visible results. CSV export is explicit, re-runs the same authorized query, includes only that page, uses whitelisted columns, adds filter/timezone/generation metadata and protects spreadsheet-formula cells. Pending responses are invalidated on identity/capability changes or device lock, including pending downloads.

## Reporting timezone and dates

New private reporting settings have **no automatic default or tenant backfill**. D1/D2 can run without a timezone. D3 requires an authorized schedule manager to explicitly save a recognized IANA timezone in Reports. The write derives organization/actor from the authenticated context, checks device and subscription rules, serializes changes and records previous/new timezone and actor/time in private history. No editable profile/Auth metadata is trusted.

D3's inclusive local date range maps to `[local start midnight, midnight after the final date)` in the saved timezone. PostgreSQL performs timezone conversion, including 23/25-hour DST days. The maximum span is 367 inclusive days. The UI states that the existing Calendar and legacy Tasks retain their prior day handling; this slice does not silently change them. Snapshot reports reject historical date filters. Branch filters explicitly mean current membership, not historical event location.

## Tours and readiness

The registry marks only the implemented base page families as available. Each short walkthrough has highlights, a coach card, Back/Next/Pause, Escape, focus handling, written instructions and replay/resume. Steps are filtered to current server-derived capabilities, with read-only wording where appropriate. Setup and People no longer teach targets/behaviors as required base setup. The live readiness checklist counts only the user's applicable business milestones and remains derived from saved facts.

Learning stores only status/step under a versioned user+organization+page-family key in this browser. No child or clinical content, staff rankings or business-readiness facts are stored. Progress is not synchronized across devices. Unavailable storage produces an explicit in-page limitation. Learning never saves/imports/invites/exports/approves/finishes a business record. Input changes, opened editors, backgrounding and device lock pause coaching. The engine is mounted only on Setup/People/Reports, not active-care/session-delivery pages. Mandatory PIN setup remains separate.

Product profile, vocabulary, entitlements, user authority and regulated-service readiness remain separate. Existing clinical workflows and records are preserved; clinical tutorials remain bookmarked rather than required base steps. This slice adds no entitlement enforcement, pricing, billing or compliance assertion.

## Forward migrations and release order

1. `20261017192817_daycare_operational_reports.sql`: private timezone setting/history, current effective-capability RPC, timezone setter and invoker report RPC.
2. `20261017192818_correct_canceled_onboarding_milestone.sql`: forward replacement of onboarding progress excluding valid `canceled`, plus minimized staff status/PIN-ready booleans. Original migration remains unchanged; existing callers tolerate the additive fields.

Both migrations must be applied before deploying the new application consumer. They are additive/backward-compatible with the prior UI. Deploying code before its migrations produces explicit access/load errors, not a fallback that broadens authority. An application rollback can leave the additive migrations in place; do not delete timezone history or customer data as a rollback shortcut.

Production application of these migrations and deployment require fresh user release authorization. A read-only schema inspection on October 17 confirmed the live onboarding function still uses `cancelled` and none of the three new public reporting/capability/timezone RPCs exists. Before release, verify migration order against the current live schema and run production smoke checks with authorized existing test accounts. No live migrations or end-to-end production verification were performed.

## Verification

Offline PostgreSQL integration tests load the existing schema fixture and real migrations, then exercise authenticated/anonymous roles, RLS and synthetic device sessions. They cover canceled-only scheduling readiness, pending/accepted/PIN distinctions, report/source denials, foreign branches and child exclusion, private-table ACLs, invoker execution, read-only subscriptions, invalid filters, deterministic pagination, no branch multiplication, timezone history and spring/fall DST boundaries.

Pure tests cover capability normalization, role/legacy-key rejection, CSV escaping/field minimization, timezone display, bounded learning metadata and per-user/organization keys. Browser integration uses synthetic credentials and intercepted HTTP RPCs backed by isolated PostgreSQL. It exercises reports, failure/retry, fresh CSV downloads, pagination, explicit timezone saving, mobile coaching, persisted replay, device-lock cancellation of pending downloads, source-grant filtering, and Setup/People/preferences deep links. No production connection is used.

Run database tests with `REJOYCE_BASELINE_SQL` and `REJOYCE_PGLITE_MODULE` set, as with the existing care-team suite. Run `tests/operational-reports.browser.cjs` with the same variables and Playwright available (`PLAYWRIGHT_MODULE` can specify its location); use a synthetic Supabase URL of `https://workflow-test.supabase.co` in the local app build. The test blocks unexpected business mutations. Prefer `http://localhost:3047` for Next dev; this Next version blocks the default `127.0.0.1` HMR origin.

Remaining work: actual attendance/guardian/classroom/daily-care models; Tasks model/date cleanup; clinical capture/reports/tours; cross-device learning and adoption analytics; initial-PIN issue #9 verification and the separate invitation delivery investigation. Historical branch attribution remains unavailable. No HIPAA service readiness is established.
