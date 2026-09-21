# Company branches and client assignments

## Current behavior

A company remains one organization and one tenant boundary. Its owner can manage multiple branches through the same login.

- Add and maintain branches in **Operations → Branches**, backed by the existing `organization_locations` table.
- The header's **Client branch** selector offers active branches and **All branches**. Its preference is stored per user and company on that browser.
- Selecting a branch filters the People page's client list and supplies the initial branch when **Add Client** is opened.
- The client form provides a dropdown with checkboxes for one or several branches. Staff may manually change the defaults. A later header selection does not overwrite an open form.
- In the all-branches view there is no automatic assignment to every branch; the creator must choose at least one.
- Client creation and branch assignment are one database transaction. Validation failures leave no partial client.
- Existing assignments can be edited in **Client → Overview → Client branches**.
- Inactive branches cannot be newly assigned. Existing inactive assignments can be retained or removed; deactivation does not delete client history.
- If no branches exist, the client form explains where to create one. No company or branch records were invented during rollout.

## Security and migration

Applied migration: `20260921003120_client_branch_memberships.sql`.

`client_locations` models many-to-many client/branch assignments. Composite foreign keys bind both sides to the same organization. RLS requires an unlocked device and preserves the existing client visibility and management rules. Browser roles cannot truncate or arbitrarily update membership rows. Established organization IDs remain immutable.

The two public RPCs are SECURITY INVOKER, have pinned empty search paths, and exclude anonymous execution:
- `create_client_with_locations` creates the client and assignments atomically.
- `set_client_locations` replaces the assignment set under a client-row lock, validating branches against current membership and the caller's organization.

The existing direct client-insert interface remains compatible with older application code and fixtures; it can create an unassigned client. The current creation form requires branches and uses the atomic RPC. Existing clients are not assigned invented defaults.

The Operations locations list was empty when this change was applied. It now represents company branches; room-level hierarchy can be added separately when needed.

## Verification

- The migration's self-cleaning synthetic tests passed before commit and again after application.
- Tests cover multi-branch assignment, duplicate IDs, empty/null selection, foreign branches and clients, transaction rollback, inactive assignments, staff read/write restrictions, delegated client-management permission, locked-session denial, anonymous grants, and deletion integrity.
- The previous tenant-isolation regression passed, including the 11-role isolation matrix and valid session/note-review lifecycle.
- Three application behavior tests cover the initial default, manual override surviving a context switch, the all-branches state, invalid saved preferences, and per-account/company preference keys.
- All 33 branch/PIN/device application tests passed.
- TypeScript passed. Lint had no errors; six pre-existing unused-import warnings remain in the existing Operations and client workspace pages.
- Security advisors reported no new warning categories; the existing [authenticated SECURITY DEFINER notices](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) and [leaked-password protection setting](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) remain.
- No customer client/branch records were created or edited by the rollout. Synthetic fixtures were rolled back.

The component behavior tests exercise the actual People component with mocked hooks and data access. They are not a substitute for a signed-in browser walkthrough.

## Saved roadmap and scope

The branch selector currently controls the client list and new-client defaults. It is not a global filter for every dashboard, session, task, or report, and it does not grant or revoke access.

The user wants more customizable staff permissions later. Extend permission capabilities separately from location scope: support staff assigned to one or several branches, owner-wide access, and explicit delegation rules. Do not infer branch access from a browser preference.

Future work should bind scheduled sessions to branch IDs (the current location field is still text), add branch-aware scheduling/reporting, and define any room-within-branch hierarchy. Preserve company tenant isolation when introducing those capabilities.

Onboarding should guide owners through their first branch and new staff through required PIN setup, including [the saved initial-PIN acceptance check (#9)](https://github.com/boomthewiz/daycare-saas-platform/issues/9).
