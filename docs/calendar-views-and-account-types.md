# Calendar views and account setup

Implemented locally: All scheduled work, Classes (group Activities; daily default), and Session detail (individual work). Existing day/week/date-range controls remain available. Mouse/pen drag selects a same-day range in 30-minute increments, in either direction; touch and keyboard retain slot selection. Navigation opens a draft, never saves. Explicit URL end times are validated and preserved rather than overwritten by a type default. Existing server permissions, branch filters and subscription checks still apply.

The Classes view starts a group Activity draft. Session detail starts a clinical draft; All scheduled work keeps the existing ordinary Activity default. Staff review workflow, roster, staff and times before saving. Class selection reuses an existing Class; this gesture schedules its Activity rather than creating a new roster.

## Recommended account configuration (proposal, not enabled)

Add an owner/admin-controlled service model: Daycare, ABA, or Mixed. Collect it during onboarding and expose it in Business settings. Show a preview of default navigation, terminology, calendar and creation behavior before saving. Existing businesses should explicitly confirm it; never infer clinical authority from editable vocabulary, staff role names, or a calendar choice.

Daycare defaults to daily Classes and group Activity creation. ABA defaults to detailed individual session scheduling and clinical preparation. Mixed offers both and can eventually set branch-level defaults. Individual staff may switch calendar views without changing organization setup. Preserve existing data and historical workflow intent when the setting changes.

Keep service model, enabled modules/subscription, permissions, and display vocabulary separate. A service-model change can set presentation defaults but must not grant clinical rights, activate attendance/billing, change entitlements, or reinterpret existing records. Sensitive module activation retains its own readiness and permission checks.

Potential next views: class lanes for group Activities, provider lanes for ABA, and a daily agenda on small screens. Dedicated class lanes need a stable class identifier/name in the minimal schedule DTO; current group Activities remain one event with reviewed participants.

## Validation

TypeScript and affected-file lint passed. Production webpack build passed. Four calendar unit checks passed. The isolated PostgreSQL browser flow passed, including Class/group view filtering, dragging 09:00 to 10:30, group Activity URL intent, and preserving that end time through form load. No production migration, deployment, or account-type setting was applied.
