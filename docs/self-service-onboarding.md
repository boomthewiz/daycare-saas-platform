# Self-service organization onboarding

## Confirmed product decisions

- Anyone may create an organization without platform administrator approval.
- The creator becomes that organization's owner.
- New organizations receive a 30-day free trial starting when creation succeeds.
- A payment card is requested only when the owner chooses to subscribe.
- Continued paid use requires a subscription after the trial.
- Unpaid organizations retain read-only access after the trial, with billing available for subscription activation. Existing role and tenant restrictions still apply to reads.
- Initial monthly USD pricing is $79 per organization, including one service provider, plus $29 per additional provider.
- Administrative-only accounts are included; owners delivering sessions count as providers.
- Five providers cost $195 per month. There is no setup fee.
- Trial length and launch pricing are provisional. Keep plan versions and persisted trial end dates so future changes do not silently rewrite existing agreements.

## Pricing research

Published prices checked September 24, 2026; promotions excluded where possible.

- TherapyNotes: $79/month for the first group clinician, $50 per additional clinician. https://support.therapynotes.com/hc/en-us/articles/30661380110747-TherapyNotes-Pricing-and-Subscription-Options
- SimplePractice: Plus $99/month, additional practitioners from $74/month. https://www.simplepractice.com/pricing/
- Theralytics: combined platform $45/user/month with a 10-user minimum, or per-client billing. https://www.theralytics.net/pricing
- Brightwheel: custom quoted pricing. https://mybrightwheel.com/pricing/

These are related platforms with different feature sets. ReJoyce's launch price is not yet validated against operating costs.

## Existing implementation constraints

- Accounts currently have one organization_id; branches belong to the same organization. Preserve this tenant model unless a separate change is approved.
- Owner onboarding and subscription routes are placeholders. The legacy approval route still refers to daycares, which is not the current organization model.
- Existing email sign-in only permits active profiles. New-owner email verification needs a dedicated bootstrap path without weakening existing PIN/session protection.
- Guide a new owner through their first branch and required PIN setup, consistent with docs/company-branches.md.
- Organization creation and owner attachment must succeed atomically, reject reassignment of existing accounts, and support safe retries.
- No live subscription or onboarding changes have been applied.

## Trial expiration

The user approved finishing sessions already underway when the trial expires and submitting their notes. Scheduled sessions cannot start. Sessions completed before expiration do not gain an editing exception. The exception does not permit review, return, approval, unlocking, remarks, preparation changes, or reassignment. Existing role and device restrictions continue to apply.

## Implementation progress

- Added versioned launch terms, a provider-seat quote, trial deadline calculation, and a presentation-only entitlement helper in lib/subscription-plan.ts.
- Added server-only atomic organization/owner/first-branch creation after email verification, with safe identical retries and existing-membership protection.
- Added a new-organization subscription record and database write triggers, including the session-finishing exception. Existing organizations are not enrolled into new billing terms.
- Added email-code onboarding, a trial banner, and note/session action restrictions. Browser code cannot activate a subscription or extend trial dates.
- Production is unchanged. The migration and tests were exercised inside a rolled-back transaction.

## Release blocker: subscription checkout

The repository has no working Stripe integration or local Stripe configuration. The old checkout and webhook endpoints returned success without doing anything; they now return 503 until real payment handling is implemented. Do not launch self-service signup until paid activation, payment failure, cancellation, provider-seat changes, duplicate event processing, and Stripe test-mode acceptance are complete. No customer should reach the end of a trial without a working subscription route.

Supabase email signup must be enabled, and both signup-confirmation and sign-in email templates must contain the email token. Verify delivery with a user-authorized test account before release; automated tests must not email real users.

## Validation of the draft

- 70 application tests pass, including signup identity binding, rate limiting, membership conflicts, trial deadlines and provider pricing. No test sent an email.
- TypeScript and the production build pass with synthetic environment values.
- Focused lint has no errors; the two existing internal-navigation warnings in SessionGuard remain.
- The migration, new onboarding/expiry checks, lifecycle regression and tenant regression pass together in a rolled-back database transaction.
- Browser fixture data has been updated for the new access check. The browser interaction suite and real email/Stripe acceptance remain release checks; do not treat the unit/database checks as end-to-end acceptance.
