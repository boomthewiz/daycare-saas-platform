# Guardians and authorized pickup: separate proposed scope

Design only. Attendance check-out records a staff action; it must not display “authorized pickup verified” until the workflow below exists and has been reviewed. No family account, invitation or communication is created by the attendance proposal.

## Distinct identities and records

Model an adult contact separately from a staff account and separately from a login identity. One adult may have several child relationships with different access and pickup rights. A staff member's job account, name match or shared address is not evidence of a guardian relationship.

| Proposed record | Required meaning/history |
| --- | --- |
| Adult contact | Tenant-scoped identity/contact details, verification status and recorded actor/time. Avoid duplicate contacts while keeping uncertain identity matches explicit. |
| Child relationship | Child/adult, relationship type, effective dates and separately specified information-access, communication and pickup authority. One does not imply the others. |
| Pickup authorization | Scope, validity window, approving actor, verification evidence reference, revocation time/reason and immutable revision history. |
| Restricted evidence | Protected supporting-document reference and tightly scoped access/audit. Do not put identity-document numbers, document images or custody details in routine attendance notes or CSV. |
| Pickup event | Child/visit, adult identity reference, staff verifier, event time, verified authorization version and method, result and exceptional-review reference where applicable. |

All child/contact/evidence relationships need tenant-aware foreign keys and explicit read/write/share scopes. Current rights determine whether an adult may view records now; preserved event-time authorization explains what staff relied on then. Historical authorization does not give a revoked contact continuing portal access.

## Review and revocation

Define who can create a contact, verify identity, approve pickup authority, handle restrictions, revoke access and correct a pickup event. Do not let a family user self-approve a new pickup adult or grant access to another child. Employee user-management authority alone does not establish authority to change child pickup rights.

Before launch, select the operational procedure for identity verification, conflicting instructions/restrictions, emergency exceptions, failed verification, disputed events and workforce training. Those are product/operating decisions; this proposal does not invent custody authority or a legal override. An emergency override, if later approved, needs an explicit authorized actor, reason, durable audit and review path. It cannot be a generic “skip verification” button.

Re-read effective authorization immediately before committing pickup. Race revocation and pickup transactions; the committed decision must have an unambiguous order/version. Revocation immediately blocks future use; cached browser lists are insufficient. Correct a mistaken pickup record through a revision, keeping the original verifier/result. Never rewrite it to imply a check happened when it did not.

## Bounded later implementation and acceptance

Recommended first later phase is staff-only contact/relationship administration and verified authorization history, without family login or automatic messages. Add pickup recording only after staff verification and exception handling are selected. Family self-service, invitations and communications require separate scope approval.

Required tests include foreign tenant/child/adult/evidence denial; same adult with different rights for siblings; expired/revoked authority; staff/contact identity separation; duplicate identity handling; simultaneous revocation/pickup; device lock and permission loss; evidence redaction; correction history; restricted export; and no hidden sharing when a relationship changes. D7 pickup stays blocked until these models, procedures and authority checks are implemented.
