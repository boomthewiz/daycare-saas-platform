# Import existing exports from five childcare programs

Select CSV / spreadsheet, choose clients or staff, then choose **Exported from**. Upload the source CSV/TSV without renaming headings or rearranging columns. ReJoyce suggests mappings, ignores unmapped fields and previews the normalized records before confirmation. Source selection supplies guidance and mapping suggestions; it does not connect to the vendor.

## Brightwheel

Use the student **Export roster** action and include First Name, Last Name and **Brightwheel ID**, which ReJoyce prefers over the customizable Student ID when both are present. If only Student ID is exported, ensure it is stable, populated and unique before using it. Choose active students in the source export.

Use **Reporting → Reports → Staff → Staff details** for staff. Name, Email and Role are documented export fields. Select CSV if the export offers multiple formats. Map each exported role to a ReJoyce role explicitly. Account activation status is ignored and never makes a ReJoyce account ready. Extra contacts, rooms, medical or other columns are not imported.

Brightwheel documents selectable field labels, not a single immutable byte-level CSV schema. Customized/localized headings can be mapped manually. Tested examples use synthetic data shaped around the documented field labels; they are not captured production exports.

Sources: [student roster](https://help.mybrightwheel.com/en/articles/942385-export-your-student-roster), [staff details](https://help.mybrightwheel.com/en/articles/9692872-staff-details-report).

## Procare

For Desktop, use Data Viewer CSV exports such as Child Information/Relationships and Employee Information. Procare Desktop, Online and SchoolCare Works have different reports; select the appropriate source report and inspect all suggested columns. Select a stable child-specific ID, never an account/family ID shared by siblings. Exact headers are not exhaustively documented, so unsupported variants remain manually mappable.

Sources: [Desktop export instructions](https://www.procaresupport.com/procare-desktop/docs/data-export-instructions), [report formats](https://www.procaresupport.com/procare-desktop/docs/how-do-i-export-a-report).

## Playground

Use the customizable Student Data report or staff Download roster CSV. Review a child/student identifier for client mapping; do not map an unrelated payroll ID. Staff roster downloads include inactive people even with filters. Map an appropriate source Status column to exclude them, or review/filter the population in the source before confirming it contains only the people intended for import/invitation.

Sources: [report types](https://help.tryplayground.com/en/articles/13510608-reports-overview), [staff roster download](https://help.tryplayground.com/en/articles/12417574-add-paylocity-id-as-a-custom-field).

## Famly

Use Reports → Custom lists for Children or Staff and download CSV. Choose Current people, include names, and include staff email. Include a stable child ID if available in that report; if it is missing, map another stable child-specific ID or maintain IDs in a spreadsheet. Custom lists are configurable; no fixed header schema is assumed. The personal-data ZIP export is not a named roster and is not supported here.

Sources: [Custom lists](https://help.famly.co/en/articles/4912329-create-a-custom-list), [personal-data export](https://help.famly.co/en/articles/6933266-child-and-staff-in-app-export-and-deletion).

## Lillio / HiMama

Use an available child/staff roster or custom report exported as CSV. The official center-management page confirms custom report export and person records but does not define a fixed roster header schema. Suggestions recognize conservative child/name/email/role headings; review actual columns. Missing identifiers/emails remain requirements, not fabricated values.

Source: [center-management reports](https://www.lillio.com/features/manage-your-center).

## Shared mapping and safety rules

- No source guesses IDs from names, email contacts or row numbers. Ambiguous aliases remain unmapped. Guardian/parent email headings are never automatically mapped to staff email.
- Staff names may use one full-name column or an explicit first/last combination. For clients with only one name column, explicitly map the full value to first name to preserve it without guessing a split.
- Every distinct exported staff role must be explicitly mapped. Leave unwanted roles unmapped; those rows are invalid. Owner/admin invitations remain individual actions. Review the delegation implications of manager/director roles.
- Optional source Status mapping accepts only active/current/enrolled, case-insensitively. Blank, inactive and unknown statuses are excluded before duplicate detection. If there is no status mapping, source exports require an explicit population-review checkbox before preview.
- Optional ID namespace is applied inside the importer, so source files need no prefix edits. Use a stable source/site namespace for new imports, e.g. `brightwheel.site1:00001`. Leave the namespace blank if earlier imports used raw IDs; changing ID columns or prefixes can create duplicates. Preview exposes the final stored ID.
- Column order and unrelated columns are preserved in the uploaded file; only mapped text values are sent on confirmation. Existing limits remain 1 MB and 100 people per batch. Larger exports must be divided into batches while retaining original IDs.
- CSV and TSV are directly supported. XLSX/XLS, ZIP, XML and PDF are not native inputs; use the program's CSV export option or paste spreadsheet cells. Source-specific profiles do not imply compatibility with every historical/localized/custom file variant.
- Validation, preview, tenant isolation, permission/device/subscription checks and repeat-safe client creation are shared. No updates, automatic merges, branch inference, source account-status activation or vendor sync were added.
- Staff previews send nothing. Confirmation requests invitations through the existing guarded endpoint. Delivery remains unverified; failures pause the batch and untouched rows can continue. SMTP configuration is unchanged.

## Verification and release

Unit tests cover original Brightwheel labels with reordered and extra columns, preferred ID selection, ambiguity, all five profiles, guardian-field rejection, explicit roles, split names, source inactivity and stable namespaces. Browser tests load synthetic CSV fixtures for all five sources and check population review and Brightwheel role/status preview without writes. Existing database and invitation tests verify authoritative isolation/security. Synthetic fixtures establish the implemented mapping contract, not vendor-certified or real-account acceptance.

No new migration is required. Changes remain on the import work branch for a separate release review; API/SFTP and real invitations are not enabled or tested.
