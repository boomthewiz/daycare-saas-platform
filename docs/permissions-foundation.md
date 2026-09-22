# Permission settings foundation

`lib/permissions.ts` defines the supported per-user grants, their labels, descriptions, and who may edit each grant. It supplies typed keys, database selection columns, fresh default-deny values, a strict normalizer, and UI editor checks.

The team member editor renders from this catalog and saves only catalogued boolean grants plus the explicitly selected target identity. New invitations use the same default-deny values. Missing, malformed, inherited, and unknown fields cannot enable grants through normalization.

## Authorization boundary

The catalog supports settings presentation; it is not a replacement for database authorization. Existing RLS and the billing/delegation triggers check every browser write using current database state. A catalog edit alone must never create a new enforceable permission.

Owners/admins control delegation authority. Other editors need both Manage users and May delegate permissions. Billing and delegation remain owner/admin controlled. Existing self, owner-account, tenant, and session restrictions apply. Non-owner administrators retain the existing Manage users requirement.

## Extending settings

For each new capability, first define the product rule, add its database storage and enforcement, and verify denial and allowed cases with database tests. Then register its typed definition and editor icon, connect the protected operation, and add integration coverage. New grants default to false. Grant changes must not be inferred from role names or user-editable Auth metadata.

Future organization presets or role templates can feed the same grant model after their precedence and delegation rules are approved. This change does not activate presets, custom roles, implicit inheritance, or a generic permission-writing endpoint. Existing legacy navigation-only flags in `config/navigation.ts` are not promoted to enforceable capabilities by this catalog.

The invitation authorization choice (role, Manage users, or both) and broader role hierarchy remain pending. PIN onboarding verification remains tracked separately in issue #9.
