# Daycare-first feature inventory

**Implementation update:** this document preserves the slice 1 audit. See [slice 2](daycare-slice-2.md) for the implemented Reports/tour consumers, capability RPCs and migrations awaiting release; the registry now reflects that code maturity.

Audited against fetched main `258844931a4a0929b1f23baeb111255e05418ef5`, October 17, 2026. This is slice 1 of the daycare-first handoff. No live database or production deployment was inspected during this audit.

`lib/feature-registry.ts` is the single typed, environment-independent inventory. Server code can import it without React, browser APIs, database clients or secrets. Stable feature keys own domain, proposed bundle, workflow maturity, dependencies, sensitivity and authorization references. Reports and tutorials join through `featureKey`; `getFeatureInventory()` resolves the report/module map. Their own maturity remains independent: a working roster does not make its proposed report implemented. All R1–R18 research IDs remain represented, including the split daycare/clinical interpretations of R17/R18.

The registry has no production consumers yet. It cannot authorize an action, grant a paid entitlement or certify service readiness. Do not use `proposedBundle`, terminology or domain tags to filter existing customer access. No new database schema, billing, restrictions or diagnosis labels are introduced.

## Source audit and next implementation boundaries

| Area | Evidence | Consequence |
| --- | --- | --- |
| Reports | `app/(dashboard)/reports/page.tsx` construction placeholder | D1/D2/D3 remain planned, including query and CSV/export enforcement. |
| Staff summaries | `20261008061322_onboarding_progress.sql`, `lib/use-setup-progress.ts` | Details require `can_manage_users()`. Summary has combined account readiness; separate active/PIN-ready presentation needs a reviewed, minimized RPC change. Never expose Auth rows or PIN material. |
| Report access | `20260919061400_enforce_pin_session_policy.sql` | `can_access_reports()` includes owner or `can_view_reports()`; report access does not automatically authorize every source table. Test report-specific denials before shipping queries. |
| Navigation | `config/navigation.ts`, `lib/permissions.ts`, `lib/use-setup-access.ts` | Legacy `can_manage_team/access/operations/settings` coexist with supported grants. Resolve via existing server capabilities; never promote navigation flags into database grants. |
| Setup milestone | `20261008061322_onboarding_progress.sql` | Source excludes `cancelled` while valid status is `canceled`. Forward migration and database regression required; no historical migration rewritten here. |
| Tours | `components/PageGuide.tsx`, `components/SetupProgressChecklist.tsx` | Existing guides include clinical instructions. Product-aware personal tours and separate daycare readiness are still unimplemented. Metadata does not change the current UI. |
| Tasks | `app/(dashboard)/tasks/page.tsx` | UTC date selection, console-only fetch errors and legacy child/classroom joins. Fix reliability and model connection before D5. |
| Clinical recording | `app/(mobile)/session/[sessionId]/page.tsx` | Existing response UI/quick actions do not establish mode-aware capture. Released setup/behavior assignment remains intact. |
| Branches | `lib/calendar-data.ts`, client/care-team migrations | Current membership is not event-time location. Deduplicate source IDs before totals; do not sum many-to-many branch segments as unique people/activity. |

## Slice 2 contract

Implement a shared effective-capability consumer using current server authority, with failure defaulting to unavailable. Retain tenant, PIN/device, subscription and record-state checks on every query/action/export. Add no product gating until compatibility and trusted administration are separately designed.

D1 is a current roster snapshot. D2 additionally requires Manage users and must distinguish active, accepted, PIN/account-ready and assignment-ready without implying email delivery or workforce presence. D3 counts scheduled activity by recorded status/type/time; it cannot establish attendance, payroll or historical service location. The existing Reports placeholder must not advertise any blocked report as available.

Use an explicit organization IANA timezone; specify a migration/default policy before persisting it. Date filters are local calendar dates mapped to half-open UTC intervals `[start, nextDayStart)` using that timezone, including DST. Label the timezone; reject invalid ranges; paginate with stable ordering. Server queries and exports must share the same authorization/filter contract, protect CSV formula cells and avoid exporting hidden/unapproved fields. Roster's date contract is snapshot time, not historical enrollment. Current-branch filters must say current membership.

Tours must be optional, anchored, keyboard/mobile accessible, replayable and scoped to user+organization. Filter each module by effective capability, workflow state and explicit product availability; hidden modules must not affect incomplete counts. Base learning must not depend on clinical program setup. Resolve mixed organizations without interpreting vocabulary as product permission. Pause on lock, active care and unsaved work. Coaching must never automatically save/import/export/invite/approve/finish records. Mandatory initial PIN remains separate. Learning progress never changes business-readiness facts.

Product profile describes intended use; paid entitlements describe trusted commercial assignment; user permissions authorize specific actions/records; regulated-service readiness records a separately reviewed service configuration. None implies the others. No runtime profile, entitlement or readiness storage is added in slice 1.

## Release prerequisites

Before enforcing entitlements, inventory usage, define grandfathering/mixed-organization/dependency behavior, use trusted administration, and test direct API denials, subscription transitions, retention and authorized continuity/export. Preserve all existing records and working features. Baseline safeguards stay available across bundles. Regulated-service planning needs a separate professional review of contracts, operations, subprocessors and technical controls; no HIPAA readiness assertion follows from this inventory.

Next reviewable implementation: capability alignment, canceled-milestone forward migration/test, timezone contract, D1/D2/D3 and daycare Setup/People/Reports tours. Production migration/deployment requires fresh release authorization. Initial-PIN issue #9 and invitation 403/delivery investigation remain separate verification work; do not reset an existing owner or send test invitations as a shortcut.
