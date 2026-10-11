# People import direction — 2026-10-10

Recommendation: start with Brightwheel roster exports through the shared CSV/spreadsheet importer, then validate Procare exports. Evaluate Famly as the first API pilot if a customer uses it and has API access. Defer SFTP until a customer or vendor can supply an actual scheduled file feed. These are engineering priorities based on documented access, not a market-share ranking or a promise of vendor connectivity.

## Exporter comparison

| Platform | Documented data access | Recommended ReJoyce approach |
| --- | --- | --- |
| Brightwheel | Student roster export includes names, Brightwheel ID and Student ID. Staff details report includes name, email, role, rooms and account activation status. | First file-import target. Select one stable ID field and preserve it as text; map names and review roles. Export active students explicitly. Source activation status must not activate a ReJoyce account. |
| Procare | Desktop Data Viewer exports CSV; reports include child relationships and employee information. SchoolCare Works also exports directories. | Second file target. Distinguish Desktop, Online and SchoolCare Works; their reports and formats differ. Obtain a synthetic/de-identified sample of the exact report first. |
| Playground | CSV reporting and staff roster downloads; the staff roster includes inactive staff even when filters are applied. | Another file target. Filter inactive people explicitly before import and review roles. Documented partner integrations do not establish a general roster API for ReJoyce. |
| Famly | Public GraphQL API documents children and employee queries; API access depends on package. Site/organization tokens have permissions and expiry. | Strongest documented API pilot among the reviewed options, contingent on actual customer demand, entitlement, and permitted fields. Prefer the public API. Its personal-data export ZIP is not a simple named roster. |
| Lillio (formerly HiMama) | Center-management features include child/family/staff records and customizable report exports. | Later file target after confirming the exact roster report, ID column and staff fields with a sample. General report export marketing does not establish an API or SFTP contract. |

No reviewed source establishes a generally available Brightwheel/Procare/Playground/Lillio roster API or SFTP feed for this project. This is an evidence gap, not a claim those capabilities do not exist. Brightwheel's documented My Food Program integration sends meal/attendance data using MFP credentials and IDs; it is not a Brightwheel roster API. Do not reverse-engineer browser cookies or substitute undocumented endpoints.

## First usable workflow

1. Export only required roster columns. Exclude contacts, medical, billing and other unrelated data. Keep active and inactive populations explicit.
2. Clients: map `external_id`, `first_name`, optional `last_name`/`preferred_name`; choose an active ReJoyce branch. Pick either a stable Brightwheel ID or validated Student ID, never a name or row number. Prefix IDs by source/site when needed, such as `brightwheel:site-a:0001`. Preserve the exact ID on repeat imports; do not add a prefix to IDs already imported.
3. Staff: map `full_name`, `email`, `role`; review source roles against ReJoyce's allowed values. Preview does not create records/accounts or send invitations. Current confirmation requests login invitations; standalone record-only staff import is not implemented.
4. Review invalid/duplicate rows, confirm ready rows, and download the non-PII row report. Existing client IDs and existing staff accounts are skipped; no automatic updates, name matching, account merging or role changes.
5. Review People for email confirmation, PIN setup, active account status and assignments. An accepted invitation request is not proof of delivery, acceptance or scheduling readiness.

The current staff model is `public.users`, linked to Auth accounts. A future record-only importer should use a separate tenant-scoped staff roster with a nullable, unique account link, rather than creating fake Auth accounts or inserting ready users. Its schema, UI and account-link conflict policy need their own review. Account creation and invitation sending must remain explicit actions. Automated sync must never send invitations by default.

## Shared foundation implemented

The single `/team-management/import` screen handles both clients and staff. CSV, TSV and pasted cells use column mapping, canonical row validation, tenant-scoped duplicate preview, and explicit confirmation. Uploads/pastes remain in browser memory; reports contain row numbers/statuses only. `.xlsx`/`.xls` workbooks require CSV/TSV export or pasting cells. Limits remain 1 MB and 100 people; IDs retain leading zeros. Unknown columns are ignored after mapping. Future API/SFTP adapters must map supported text fields into `validatePeopleRows`; this validator is not a public API, authorization check, or server-side write boundary.

Preview is bound to its organization. Confirmation checks current context; staff requests include that organization for the existing endpoint's authoritative check. Client RPC and invitation endpoint retain database/tenant/device/permission/subscription safeguards. Inactive branches cannot be selected. API/SFTP method panels explain prerequisites and offer no live connection or credential entry.

Invitation responses require the expected success shape. Accepted requests are labelled delivery unverified. Failure, malformed response or interruption pauses the batch; the affected row is excluded from automatic continuation. Untouched ready rows can continue. Review People and the individual invitation flow before retrying an uncertain row; re-preview/re-upload is not proof that a timeout sent nothing. Durable invitation reservations remain authoritative. SMTP settings are unchanged.

## API pilot contract to settle first

Choose the actual vendor/product and customer site; confirm authorized read access and sample responses. Define source ID namespace, branch/role mapping, null/type conversions and identity conflicts. Recommended first direction is one-way into ReJoyce, manual pull into preview, create-only/skip existing. This is a proposed pilot policy, not an enabled connection. Review updates, deactivation, deletions and eventual cadence separately.

For Famly, confirm customer package entitlement, token type, site scope, minimum read permissions, expiry/rotation and employee email visibility. Use the documented public queries, pagination and error semantics. Store tokens server-side with encryption/access controls and redacted logs; never in browser storage or reports. Validate tenant ownership at every stage and confirmation, enforce bounded batches and subscription access, and audit results without credentials/PII. Do not implement scheduled sync until idempotency, partial failures, checkpointing and conflict policy are specified.

## SFTP contract to settle first

Name the feed producer and hosting party; confirm hostname/port, SSH host-key fingerprint, authentication method/key rotation, remote folder, filename patterns, CSV/TSV encoding and schema. Define full versus delta files, stable IDs/site scope, cadence/timezone, completion marker or atomic rename, duplicate-file detection, retention/archive policy and failure notifications. Suggested first use is inbound files staged for manual preview, never automatic account invitations. An SFTP server alone does not make a vendor export automatically. No poller, server, credentials, recurring job or infrastructure has been provisioned.

## Suggested next work

Priority 1: synthetic Brightwheel/Procare samples and explicit mapping presets, with a source preview that exposes assumptions; keep ambiguous headings unmapped. Priority 2: durable record-only staff staging and separate account linking/invitation actions. Priority 3: a customer-backed Famly manual API pilot. Priority 4: customer-backed SFTP ingestion. Native workbook parsing, saved mapping profiles, update diffs and multi-branch imports can follow actual usage; they need independent schema/dependency/security review.

## Sources checked

- [Brightwheel student roster](https://help.mybrightwheel.com/en/articles/942385-export-your-student-roster)
- [Brightwheel staff details](https://help.mybrightwheel.com/en/articles/9692872-staff-details-report)
- [Brightwheel My Food Program integration](https://help.mybrightwheel.com/en/articles/12738899-send-meal-attendance-data-to-my-food-program-mfp)
- [Procare Data Viewer exports](https://www.procaresupport.com/procare-desktop/docs/data-export-instructions)
- [Procare report formats](https://www.procaresupport.com/procare-desktop/docs/how-do-i-export-a-report)
- [Playground staff roster](https://help.tryplayground.com/en/articles/12417574-add-paylocity-id-as-a-custom-field)
- [Famly API access](https://help.famly.co/en-us/articles/13859542-api-access)
- [Famly public API reference](https://docs.famly.co/)
- [Famly personal data exports](https://help.famly.co/en/articles/6933266-child-and-staff-in-app-export-and-deletion)
- [Lillio center management](https://www.lillio.com/features/manage-your-center)

## Release

No new migration is required for this foundation. Verify the deployed `portal_enhancements` and `onboarding_progress` migrations before release. New import work requires a separate release decision; previous production approval does not cover it. Production SMTP investigation remains open. Synthetic acceptance checks do not establish real email delivery or vendor access.
