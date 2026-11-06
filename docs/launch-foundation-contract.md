# Launch foundation contract — November 5, 2026

Review scope: clinical program definitions and internal metadata lookup. This does not yet establish complete Daycare/ABA isolation: clinical session delivery, notes, measurement, care-team authority, reports and exports require subsequent path coverage before a daycare-only real-data pilot.

## Independent authority

Daycare Core retains existing roster, Classes/Activities, Tasks, attendance and reporting permissions. Service model and vocabulary remain presentation defaults. ABA enablement is a private, explicit organization entitlement; absent configuration denies. User program-read/program-edit grants are separate private records; edit requires read. No owner/admin role, billing status, support role or old Manage clients grant implies these grants. Existing tenant, device, subscription and record rules still apply.

| Selected action | Required authority in addition to existing rules |
|---|---|
| Read targets/behaviors | Enabled ABA + explicit program read + current tenant + accessible child |
| Insert/update/delete targets/behaviors | Above + explicit program edit + Manage clients + organization write access |
| Copy reusable behavior | Destination and source must satisfy the same boundaries; invoker RPC retains RLS |
| Support organization search/detail | Explicit active workforce role/version + active Auth session and identity + unlocked device + AAL2 in token and live session |
| Support metadata read audit | Same transaction as returned result; failed insert aborts lookup |
| Any sensitive support mutation | Unavailable in this slice; future command requires fresh step-up, live action authority, expected versions, ticket/reason and atomic audit |

Program read eligibility uses existing child access without widening it. Historical definition rows are not converted, reassigned or deleted. Read-only subscription status can retain separately authorized program reads; writes still deny. Existing clinical continuity is untouched outside these selected tables.

## Compatibility and migration policy

No automatic entitlement/grant backfill. Existing and new organizations lacking reviewed records deny the selected clinical actions. This intentionally makes an unreviewed clinical account unavailable for program setup. Do not deploy until an operator has reconciled each existing clinical organization and approved its exact module/read/edit assignments. Preserve pre-change snapshots and terms; no automatic grant escalation based on records or service model. There is no customer/support activation endpoint in this slice. Initial assignments require a separately reviewed operator transaction and durable change evidence. Production activation and workforce enrollment remain blocked on named operators and approved procedures.

The additive migration follows PRs 43–46. Those PRs remained open drafts when inspected; base is conflict-coverage `0597265`. Reconcile deployed migration definitions and timestamps before applying anything. Never replay the local history wholesale. No production state was queried.

## Support contract

Private workforce membership references Auth identity, independently of customer organization/role. Roles agent, billing and administrator currently share only `organization.metadata.read`; none grants customer-data access or mutations. No membership is seeded from system_admins, email suffix or customer roles. No self-enrollment or role editor exists. Auth/session/device checks are live for every lookup. The current device policy requires an active public identity; workforce enrollment must explicitly provision a suitable internal identity/device through a reviewed process, not borrow a customer's login. A separate workforce sign-in/device lifecycle is a pilot dependency.

Lookup requires exact organization UUID or a literal name prefix of at least three characters, capped at 20 results. It returns ID, organization name, service-model/version and ABA configuration/version only. No owner email, child counts, clinical content, billing guesses or secrets. Detail is the exact-ID lookup. Every successful lookup writes actor, workforce version, action, target IDs, timestamp and a ticket reference atomically. No arbitrary JSON payloads or free-text clinical narrative. Audit updates/deletes/truncates are rejected; private tables have no customer grants. Database owners remain a trusted administrative boundary.

Membership changes lock against in-flight lookups. An operation already holding membership lock linearizes before revocation; queued operations recheck after revocation. Expected workforce version invalidates stale requests. Audit failure means no returned metadata. Denials return generic errors and no tenant existence information. Denied-attempt telemetry is a later sanitized operational integration, not a customer-writable audit path.

Legacy owner approval is retired with HTTP 410. It cannot create legacy daycare rows or invitations. Current self-service organization onboarding remains the supported path; no support replacement is invented.

## Remaining pilot dependencies

Complete clinical session/read/RPC/direct-write/export inventory and denial coverage; clinical activation/readiness and grant administration; workforce enrollment/MFA recovery and isolated console deployment; approved step-up policy before sensitive commands; native PostgreSQL race CI; security advisors; migration reconciliation; authenticated preview and rollback rehearsal. Billing reconciliation/grace, public page/lead delivery, contracts, restore rehearsal, staffing, pricing and pilot terms remain separately bounded work. No charges, provisioning, outreach, merge or deployment is included.

## Enforcement inventory and reviewed references

Direct SELECT/INSERT/UPDATE/DELETE on client_targets and client_behaviors intersects prior permissive policies with new restrictive policies. The invoker apply_client_behavior RPC uses the same source/destination RLS; a write trigger also checks end-user identity inside elevated writers. Existing clinical session preparation and measurement readers of definition data, and previously saved session snapshots, remain outside this program-definition slice: they must be covered before any full clinical-read isolation claim. Customer roster/care-team management does not grant new clinical-program authority.

Reviewed Supabase [RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security), [MFA guidance](https://supabase.com/docs/guides/auth/auth-mfa), and [changelog](https://supabase.com/changelog). The markdown changelog endpoint could not be fetched, so the HTML index was used. No dependency upgrade or hosted command was performed.
