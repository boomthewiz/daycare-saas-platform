# Billing recovery: bounded grace foundation

This follow-up slice separates provider facts from a temporary ReJoyce access exception. It does not enable Checkout, process payments, activate pricing, create a Stripe environment or deploy billing. The earlier test-only Stripe branch remains a reference, not a production dependency.

An unpaid managed organization may receive `organization_write` grace only under an explicitly approved, active, immutable policy version. No policy, workforce enrollment or grace is seeded. Policy duration, renewal cap and MFA freshness are required configuration, without default operational values. Policies requiring independent approval fail closed until a separate approval workflow exists; an administrator cannot bypass this restriction.

Only current billing/administrator workforce members with expected membership version, unlocked device, live unexpired AAL2 Auth session and fresh second-factor evidence may issue/revoke grace. Signed `amr` second-factor timestamps are bounded by the approved freshness policy. Customer owner/admin and support agent roles do not authorize grace. Every operation takes an explicit organization, expected grace version, policy version, ticket, reason code and idempotency UUID. Live authority is checked before replaying a receipt.

Grant/revoke, optimistic version, operation receipt and append-only audit commit together under the organization lock. A failed audit insert aborts everything. Idempotent replay must match the original actor and payload. Expired or revoked rows cannot restore access. Server-time expiry and current active policy are checked by the ordinary access resolver; cleanup jobs are unnecessary for denial. Renewals append records and consume the configured limit, including previously revoked grants.

Grace never changes provider payment status, `paid_through`, trial history, subscription ownership or managed/unmanaged classification. Unmanaged organizations cannot receive grace. Existing user/device/tenant/record/module restrictions remain authoritative. Existing narrowly authorized trial finish/close-only continuity remains unchanged. The API labels grace separately from paid/trial access.

Remaining work: approved policy and operators, independent approval workflow, customer notices, metadata preview/confirmation UI, actual provider reconciliation and Checkout/portal/webhook lifecycle, risk-event handling, sandbox acceptance, tax review, operational monitoring and required native PostgreSQL races. No real billing or grace policy is enabled by this source change.
