# Dedicated Setup — item 7

Based on verified main `9be4fb8c3680f4f4561b60c3077c419c1044cb0b`.

## Existing support and authorization inventory

| Settings | Existing implementation | Database authority |
| --- | --- | --- |
| Branches / locations | Operations; organization_locations | Manage sessions, same organization |
| Session types / default minutes | Operations; session_types | Manage sessions, same organization |
| Target categories | Operations; target_categories | Manage clients, same organization |
| Business terminology | Operations; organization_terminology | Manage clients or Manage sessions |
| Staff branches / teams / groups / classes | Care setup; care RPCs | Manage clients, same organization; optimistic versions and eligibility rules |
| Account roles / grants | Team member editor; users / user_permissions; invitation API | Manage users; owner bypass; delegated grant authority; protected administrator / owner / self targets |

Inventory checked against production catalog definitions, RLS policies and `has_org_permission`. Legacy navigation flags such as Manage operations are not enforced settings capabilities. Setup navigation does not create a new grant. Existing Team navigation grants are retained, with links also exposed to actual client/account managers and owners.

Supported business preferences are terminology, branch options and target categories. Arbitrary organization name/type editing has no existing authorized write path and is not added. Account roles are fixed; grants are editable per person. No custom roles, permission presets, new delegation authority, or role-wide permission editor is introduced.

## Implementation

`/setup` is available in the main sidebar to authenticated users, with a wrapping section navigation. Readable definitions are available to staff; writes still require their existing capability. `/setup/preferences` relocates Operations, `/setup/care-teams` relocates care setup, and `/setup/roles` provides the access guide and an authorized account directory. `/setup/roles/[userId]` reuses the existing guarded account editor. Legacy Operations and care setup URLs redirect. Everyday client/session pages link into Setup when configuration is needed; primary creation, scheduling and assignment controls remain in place.

The invitation form retains its role selector, short selected-role description, activation/PIN summary and a guide link. The three long role boxes and four-step setup explanation move out of the form into the Setup guide/concise activation text. Invitation API behavior and delivery are unchanged.

Preferences use current database permission helpers to enable each section. Checks fail closed while loading or on lookup failure. Handlers check the relevant capability too. Update requests require a returned row, so a revoked grant producing zero updated rows cannot display success. Existing RLS, device safeguards and subscription write controls remain authoritative.

## Create clients evaluation

Retain Manage clients for creation. The care context and atomic create-with-care-team RPC currently share this authority with editing and care setup. A distinct Create clients grant would need its own storage, creation-specific care context, RPC checks, delegation checks, backfill, and explicit precedence for owners and existing managers. Adding only a UI switch would not enforce separation. This relocation introduces no new grant or silent access removal. A separate creation-only capability remains a future functionality change.

## Verification

94 tests pass with no skips, including the existing care-team PostgreSQL regression and new Setup PostgreSQL regression. The latter runs the unchanged settings policies with owner/admin/manager/director/staff synthetic identities, validates independent client/session grants, direct insertion denial, foreign-business denial, locked/revoked device denial and expired-subscription denial. It also runs existing permission delegation, administrator protection and billing delegation SQL regressions. All data stays in isolated PostgreSQL and rolls back.

Production build and TypeScript pass with synthetic environment settings. Changed-file lint has no errors. Browser checks use loopback-only synthetic Auth and isolated PostgreSQL: Setup navigation, session-type creation, saved duration reload/edit, account-editor links, invitation role selection, and denied editing controls. Desktop and 390×844 mobile checks passed; mobile uses the existing sidebar collapse control and has no horizontal overflow. Denied browser grants are fixture simulations; direct authorization is verified by real RLS in the SQL tests. No real invitations are sent. Existing invitation API tests cover authorization and delivery mocks.

Production was inspected read-only; no production settings, business records, migrations or deployments were changed. The user-reported existing Operations tab was absent from the available browser inventory, so production authenticated UI inspection was not possible. Screenshots and a review summary accompany the draft PR outside the repository.

## Rollout boundary

No migration is required. Separate user approval is required before merge or production deployment. This draft PR is not item 7 rollout approval. Payments, pricing, trial duration, invitation-delivery follow-ups, and My Sessions sidebar changes remain outside scope.
