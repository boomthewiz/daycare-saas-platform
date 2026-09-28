# ReJoyce Stripe billing — test integration

This branch implements test-only subscription billing. It is **not a production
launch**. Public signup remains default-off. Existing organizations without an
onboarding subscription row are neither enrolled nor charged. No production
migration or runtime credential change has been made.

## Agreed policy

- $79 USD per organization per month includes one provider; each additional
  provider is $29. Five providers cost $195. Administrative-only accounts are free.
- Count active `therapist`, `teacher`, `educator`, `assistant`, `aide`, `caregiver`,
  and `staff` users, matching `is_frontline_staff` and the scheduling interface.
  Exclude pending/inactive users, managers, directors, admins and owners. The app
  does not currently let owners deliver services; this change grants no new role
  permissions. If that authorization changes, update the count and its tests too.
- Preserve the persisted 30-day trial deadline. More than 48 hours remaining uses
  subscription Checkout with the existing deadline. During the final 48 hours,
  setup Checkout saves a payment method; reconciliation creates the subscription
  with the same deadline (or charges normally if the deadline has already passed).
- Provider additions invoice prorations immediately with a pending Stripe update
  if payment cannot complete. During trial, quantities change without charges.
  Reductions on paid subscriptions use a schedule effective at next renewal.
- Cancellation is at period end. A failed renewal grants no additional grace:
  the existing trial/paid deadline remains. Existing database write guards and the
  original trial-session finishing exception remain authoritative.

## Architecture and authorization

`POST /api/create-subscription` verifies the bearer token and unlocked device,
then a service-only RPC verifies the active owner and live database session. No
browser organization ID, Stripe ID, price, seat count, or redirect is used.
`GET /api/billing` exposes a limited owner-only status view; `POST /api/billing`
supports refresh, payment/invoice portal and cancellation.

`POST /api/webhook` verifies the raw body with Stripe's signature verifier and
rejects live and Connect events. Resolve organizations using their stored Stripe
customer ID, never event metadata. Events trigger fresh Stripe reads under a
per-organization database lease. Duplicate and out-of-order events reconcile
current state rather than applying historical payloads. Only settled recurring
base-plan invoice lines can extend `paid_through`; Checkout redirects, trial
invoices and provider prorations cannot. The database makes paid deadlines
monotonic. Refund/dispute entitlement policy is not implemented in this release.

Stripe mutations persist exact parameters and a random idempotency key before
the API request. The lease is fenced and expires after five minutes; checkpoints
extend it. Ambiguous operations older than 23 hours require operator inspection
instead of reissuing requests beyond Stripe's idempotency retention. Inspect the
stored operation and Stripe request history, reconcile the actual result, then
clear/complete the operation under a fresh lease. Never blindly clear a pending
request or generate a new key after an unknown payment outcome.

User insert/update/delete triggers record provider-count revisions. A worker
must regularly call `POST /api/billing/reconcile` with `Authorization: Bearer
<BILLING_WORKER_SECRET>`. It reconciles the 25 least-recently-checked customer
records, including missed events and pending requests. Configure at least a
once-per-minute scheduler on the isolated test deployment and monitor non-200
responses. This repository deliberately does not provision a paid scheduler.
Webhooks and owner refreshes also reconcile. Without the worker, seat changes
are not guaranteed to reach Stripe promptly; do not enable billing without it.

The customer portal allows payment-method updates and invoice history. It cannot
change quantities, prices or cancel; the app handles cancellation so reduction
schedules are safely released before period-end cancellation.

## Test configuration

The connected account is `acct_1UKTgICxlg8hHxkP` (New business). The connector
exposes live and shared test mode under the same account ID, not a distinct
sandbox account. Only `livemode=false` has been mutated.

| Variable | Value / requirement |
| --- | --- |
| `STRIPE_BILLING_ENABLED` | `true` only on the isolated test deployment; otherwise unset/false |
| `STRIPE_ACCOUNT_ID` | `acct_1UKTgICxlg8hHxkP` |
| `STRIPE_BASE_PRICE_ID` | `price_1UKWHLCxlg8hHxkP27zSb6kF` |
| `STRIPE_PROVIDER_PRICE_ID` | `price_1UKWHXCxlg8hHxkPMPs2w26E` |
| `STRIPE_PORTAL_CONFIGURATION_ID` | `bpc_1UKWK9Cxlg8hHxkPbU4eZLsq` |
| `STRIPE_SECRET_KEY` | A test restricted API key, stored as a sensitive server environment variable |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for that test deployment's webhook |
| `BILLING_APP_ORIGIN` | Exact trusted HTTPS origin, or local HTTP origin for localhost testing; no trailing slash |
| `BILLING_WORKER_SECRET` | Random server-only secret of at least 32 characters |
| Supabase variables | Isolated test database, never the production project |
| `SELF_SERVICE_SIGNUP_ENABLED` | Keep unset/false throughout unfinished acceptance |

The connected ChatGPT Stripe account does not provide API credentials to Next.js.
Provision the restricted test key through Stripe, then store it privately in the
deployment environment; do not paste it into chat or commit it. Required resource
access: read account/prices/invoices; read/write customers, subscriptions,
subscription schedules, Checkout sessions and portal sessions; read SetupIntents
and portal configurations. Validate the restricted key's permissions using actual
test flows before deployment. Stripe SDK is pinned to 22.6.2 (2026-08-26.dahlia).

Live keys, Vercel production and the known production Supabase project are
explicitly rejected. A future production release requires a reviewed change to
these guards and full acceptance; an environment flag alone cannot launch it.

Register a test webhook at `/api/webhook`, API version `2026-08-26.dahlia`, for
`customer.subscription.*`, `invoice.paid`, `invoice.payment_failed`,
`invoice.payment_action_required`, `invoice.created`, `checkout.session.completed`,
`checkout.session.async_payment_succeeded` and `checkout.session.expired`.
No webhook endpoint was registered without a configured test app destination.

## Migration warning

The new additive migration is `20260928043018_stripe_billing.sql`. It introduces
private billing state, owner-only server RPCs, leases, checkpoints and a provider
revision trigger. All new tables have RLS; all new RPCs revoke public/anonymous/
authenticated execution and grant only the service role.

Production history was rechecked. **Do not run a blind `supabase db push`.**

| Existing migration | Repository version | Already-applied remote version |
| --- | --- | --- |
| complete_service_session_lifecycle | 20260923185604 | 20260923233333 |
| self_service_organization_onboarding | 20260924080336 | 20260927185605 |

Reconcile history explicitly against reviewed SQL before any future CLI sync.
Do not reapply either migration, revoke unrelated functions, or apply this new
migration to production as part of test acceptance.

## Validation and remaining acceptance

Automated checks:

```sh
node --test --test-reporter=dot tests/*.test.cjs
npx tsc --noEmit
npx eslint lib/billing*.ts lib/stripe-config.ts app/api/billing app/api/create-subscription/route.ts app/api/webhook/route.ts 'app/(dashboard)/billing/page.tsx'
npm run build
```

`tests/billing-db.test.cjs` executes the migration in local PGlite PostgreSQL with
a minimal pre-existing schema. It tests tenant/session/owner rejection, provider
eligibility, legacy preservation, leases, fencing, monotonic payment access and
function/table privileges. It is not a full Supabase migration-stack test.
`tests/billing.test.cjs` covers signatures, test-mode guards, trial preservation,
durable retry recovery, checkout deduplication, paid invoice entitlement,
renewal/failure ordering, additions, reductions and cancellation. A sanitized
actual Stripe test invoice fixture validates the API shape.

`tests/billing.browser.cjs` uses synthetic auth/database/API responses. It covers
$195 display, checkout failure recovery, cancellation confirmation, legacy and
disabled views, owner denial, and mobile with the existing sidebar collapsed.
The existing subscription-management browser regression suite also passes.

Actual Stripe test API checks (no customer email supplied):

- Test clock: `clock_1UKWKyCxlg8hHxkPJZF9Aygf`.
- Five-provider subscription `sub_1UKWLNCxlg8hHxkPbcNhrCjx`: initial invoice
  `in_1UKWLNCxlg8hHxkPVoaBMxe1` paid 19,500 cents. Addition to six providers
  invoiced with `always_invoice` and `pending_if_incomplete`; cancellation was
  scheduled at the period end. These API checks do not exercise the app server.
- Declined-payment subscription `sub_1UKWPwCxlg8hHxkPj6F1N584` stayed incomplete;
  invoice `in_1UKWPwCxlg8hHxkPZiYEhIQq` remained open with $0 paid and $79 due.

Still required before release: isolated Supabase runtime configuration; full
migration-stack/regression testing; restricted key and signed webhook connection;
worker scheduling; actual hosted Checkout through the app (including the final
48-hour setup flow and SCA); actual recurring renewal and scheduled reduction
under a Stripe test clock; payment recovery; repeated/concurrent real delivery;
real email/code/PIN/signup acceptance. No paid test environment was created.
Public signup remains disabled until all launch requirements are accepted.

Tax registration and collection also need a launch decision. Automatic tax was
not enabled without confirmed registrations. See Stripe's
[recurring tax setup](https://docs.stripe.com/billing/taxes/collect-taxes) and
[subscription webhook guide](https://docs.stripe.com/billing/subscriptions/webhooks).
