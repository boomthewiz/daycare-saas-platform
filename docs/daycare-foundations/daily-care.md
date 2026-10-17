# Daily care and family sharing: separate proposed scope

Design only. Routine care records and incidents need their own definitions and access; they are not renamed clinical session notes or ABA behavior events. No daily-care record, recipient or message is created by this proposal.

## Model and state

Use typed records for meal, nap, routine care, incident and ordinary developmental observation. Common fields include organization/child, effective/recorded time, recorded actor, branch/room when known, version and correction references. Type-specific fields must distinguish “not recorded,” “not applicable” and a measured zero; do not force every event through a generic clinical measurement protocol.

| Proposed entity | Purpose |
| --- | --- |
| Care record/revisions | Typed facts and actor-attributed corrections. An active revision points to immutable prior versions. |
| Incident detail | Separate restricted fields, access policy and review workflow. Do not expose it through routine daily-log joins. |
| Evidence/attachments | Tenant/child-scoped references, allowed file types/sizes, lifecycle, access checks and audit. Public permanent URLs are unsuitable for protected child records. |
| Daily summary | A defined child/day/timezone and a frozen set of reviewed record revisions. It is not a live query that silently changes after sharing. |
| Share/access record | Explicit recipient relationship, summary/revision, authorizer, time and channel. Access checks use current recipient rights. Delivery/receipt is separate from accepted send requests. |

Proposed ordinary state progression is draft → submitted for review → reviewed → explicitly shared summary. Define which low-risk types may skip review before implementing such a shortcut. Incidents retain their separate restricted review path. Revisions after review require an explicit new review/share decision; an existing family summary does not silently gain new content or recipients.

## Authority and recipient boundaries

Separate recording, reviewing, incident access, sharing and export capabilities, with explicit child/branch scope. A person who can record a meal does not automatically review an incident or send a family summary. Clinical reviewer authority is unrelated. Staff must have current record authority and a valid unlocked device; privileged internal helpers still check tenant, action, child scope and record state.

Family access depends on verified relationships from the guardian workstream. Pickup authority alone does not grant information access. Re-evaluate recipient access at viewing/download time and at the server's share commit. Revoked recipients cannot keep using hosted links; distinguish this from files/messages already delivered outside the portal, which cannot be silently recalled. No automatic email, invitation or sharing is part of the initial design scope.

## Correction, time and retention

Care corrections retain old/new values, actor/time and a reason where required. Preserve whether a previously shared summary contained the old revision, and provide an explicit correction notice/review process if sharing is later implemented. Configure local-day attribution using organization timezone; nap intervals can cross midnight and DST. Unknown room attribution stays unknown.

Agree retention/archival rules for routine logs, incidents, attachments and shared summaries before release; do not assume the same duration or visibility for all. A child profile's deactivation or subscription change must not cascade-delete records or weaken access checks. Define authorized continuity/export separately from new recording/sharing.

## Bounded later implementation and acceptance

Recommended later first phase is staff-only routine meal/nap/care capture and correction history, with no incidents, attachments or family sharing until their separate requirements are reviewed. A family summary report waits for a real summary/recipient model; it cannot reuse a clinical note's access assumptions.

Tests must exercise cross-child/tenant/branch reads and exports, protected incident joins, current recipient rights, draft/review/version transitions, concurrent correction/share, midnight/overnight naps, missing versus zero values, attachment access/revocation and expired subscription behavior. Verify that tours never record or share an event. D7 care/family reports stay blocked until their actual source workflows and review/share boundaries are implemented.
