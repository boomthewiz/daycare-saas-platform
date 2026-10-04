# Client care teams (usability item 6)

Owners and existing Manage clients delegates can create clients, replace their care teams, and set up staff branches and groups. Existing grants are retained. The separate Create clients toggle is deferred to the dedicated setup-menu project.

## Selection and access

- A group selects its currently displayed eligible people. The saved assignment consists of explicit person IDs; subsequent group changes never alter it.
- People count once across groups. Individual deselection removes a person everywhere. Explicitly selecting a whole group again adds its eligible people again. Deselecting a whole group removes its people everywhere.
- The summary lists the unique selected people, default scheduling worker, and partially selected groups before saving. Group counts are based on current eligible group members; they can change when setup changes, while saved people remain unchanged.
- New selections require active frontline staff in the same business with an active branch shared by the client. A branch-scoped group's selection also requires membership in that group's branch.
- Care membership grants profile, target, and behavior read access while active staff/shared-active-branch eligibility holds. Session and note access still follow their existing assignments and permissions. Removing care membership does not revoke separately granted session or management access.
- The default scheduling worker must be selected in the care team. Deselecting that worker clears the default; profile saves cannot overwrite it. Session scheduling continues to use the default worker.

## Persistence and security

The migration adds staff_locations, care_groups, care_group_members, client_care_members, and clients.care_team_version. Composite foreign keys enforce business boundaries. Existing default workers are backfilled into explicit care membership and their clients' branch memberships into staff setup. No groups or extra staff assignments are inferred.

Browser writes go through authorized RPCs. New tables have RLS, restrictive unlocked-device policies, explicit grants, and existing subscription-write/tenant guards. Elevated helpers live in the unexposed rejoyce_security schema and check active caller permissions and organization. The care directory returns only staff ID, name, role, status, and branch membership, without emails or authentication fields.

Care-team saves check an expected version and write the exact selected set plus default worker atomically. Setup changes and care-team writes serialize on the organization. Staff-branch/group edits also check their prior state/version. Failed saves retain drafts; explicit reload confirms discarding the local assignment draft.

Staff-branch removal, client-branch changes, staff deactivation, and branch deactivation may remove this care-assignment access path. Saved membership stays explicit; separately granted session/management access remains governed by its existing rules. Unavailable selections remain visible and removable.

## Offline verification

The repository's historical migrations do not contain a complete initial schema. Set REJOYCE_BASELINE_SQL to a schema-only pre-care migration snapshot and REJOYCE_PGLITE_MODULE to a PGlite installation, then run:

```powershell
node --test tests/*.test.cjs
```

The database test loads actual pre-existing schema functions, policies, constraints, and triggers into isolated PostgreSQL, adds synthetic Auth/device fixtures, applies the new migration, verifies legacy backfill, and runs supabase/tests/client_care_teams.sql. That SQL is self-cleaning on success and failure. The offline runner never connects to production.

Browser verification uses the built application and tests/care-team.fixture.cjs. Every care RPC executes the actual migration in isolated PostgreSQL under authenticated role/RLS; HTTP shims provide synthetic Auth and PostgREST transport. Configure a synthetic Supabase URL of http://127.0.0.1:3029 and synthetic public/service keys before building. Run Next on 3027, the fixture script, and open http://127.0.0.1:3028/start. Control flags at 3029/control simulate failed responses, stale-save responses, absent permission, and subscription read-only state. These are test-only HTTP endpoints, never app routes or production handlers.

## Rollout

Production rollout requires separate user approval. Apply 20261004053317_client_care_teams.sql before deploying this frontend; the new selector fails closed if RPCs are unavailable. Verify migration health/security advisors, run the self-cleaning SQL regression with controlled synthetic fixtures, merge/deploy, and verify aliases and authenticated desktop/mobile flows. Users enter any codes or PINs directly.

The additive schema should remain in place during an application rollback so saved multi-person assignments are preserved. A rollback must retain the care-team access predicate and must not restore unrestricted direct primary-worker writes. Diagnose and forward-fix assignment issues; never drop care tables or replace saved person lists as an automatic rollback.

Production data, payments, pricing, trial duration, and the deferred My Sessions sidebar task remain outside this change.
