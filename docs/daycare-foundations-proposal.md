# Daycare foundations proposal

Design only, October 17, 2026. No schema or workflow below exists as a result of this proposal. Review this bounded attendance proposal before implementing broader classroom, guardian or daily-care systems.

## Proposed first boundary: child presence ledger

Reuse tenant-scoped client identity. Add dedicated attendance visits and append-only events; do not repurpose therapeutic sessions, timers or care-group membership. A visit identifies organization, child and opening event. An event records organization, visit, child, event kind (check-in/check-out/absence/correction/void), effective timestamp, server-recorded timestamp, authenticated actor, event-time branch/room, reason, idempotency key and any superseded event. Preserve original event values; expose corrections with reasons and actors. An absence is an explicit declaration, not inferred from a missing check-in or canceled session.

Define attendance-recording and correction authority separately from viewing, scheduling, clinical care assignment and user management. Decide the supported grants and default-deny delegation policy before creating them. Every endpoint must derive organization from authenticated context, require an unlocked valid device/account, apply subscription rules and verify child/room/visit tenant relationships. A child being visible through a clinical session is insufficient authority to record daycare presence.

Serialize attendance transitions for the child/visit; transactionally prevent duplicate open visits and check-out before check-in. Idempotent retries return the same result. Transfers close one room-presence interval and open the next atomically. Corrections must rebuild the effective timeline with overlap/order validation without destroying the original ledger. Late entries preserve effective and recording times. Choose backdating limits and correction review policy with the product owner before implementation.

Reports select effective events as of a declared cutoff and organization timezone. Open visits are missing-check-out exceptions; do not silently invent closing times at midnight. Day-spanning visits must be handled explicitly. Missing data remains unknown. First acceptance tests: foreign child/room/visit rejection, unauthorized correction and read/export denial, locked/revoked devices, restricted subscription behavior, concurrent duplicate check-ins, retry idempotency, correction chains, voids, transfers, out-of-order entries, DST/midnight and visits spanning days. Audit actor identity must be server-derived.

## Classroom and staff history: separate follow-up

Add rooms with tenant/branch identity, effective-dated capacity and configured rule versions. Model child classroom enrollment intervals separately from planned bookings and actual room-presence intervals. Model staff planned shifts separately from verified staff-presence intervals, qualification history and explicit coverage assignments. Existing care groups remain selection shortcuts.

Prevent inconsistent overlapping assignments where the selected product rule forbids them; preserve historical versions and correction actors. Capacity/ratio reports require aligned effective-time windows, child presence, staff presence, qualifications and the applicable reviewed rules. Unknown capacity/staff presence must produce an exception, never a reassuring zero or a compliance badge. Define who may change capacity/rules, correct historical presence and export coverage. Acceptance includes transfers, multiple branches, retroactive corrections, inactive rooms and configuration changes. No ratio engine is included in the first attendance implementation.

## Guardians and pickup: separate child-safety workflow

Create guardian identities and explicit child relationships with effective dates, authority type/scope, verification method, verifier/time and revocation history. Guardian accounts are distinct from employee accounts; neither a shared surname nor staff membership grants pickup authority. Pickup events must reference authority effective at the pickup time and record staff verification without placing identity-document secrets in general notes. Specify custody/restriction handling, urgent revocation, verification failures, emergency exceptions and review/training with the product owner before launch. Define narrowly scoped staff/guardian access and export/redaction rules; test cross-child/tenant denials, revoked authority, concurrent updates and historical correction. This does not ship a family portal implicitly.

## Daily care and sharing: separate follow-up

Use typed meal/nap/care/incident events with organization/child, effective/recorded time, actor and correction history. Distinguish drafts, reviewed entries and explicitly shared family summaries. Separate internal incident access from routine family-visible care entries; authorized relationships determine recipient scope. Define approval and rescission rules, attachment storage/access and retention before implementation. Test unauthorized read/share/export, revoked relationships and corrected already-shared entries. No automatic family messages are part of Reports. Ordinary developmental observations need their own semantics; clinical treatment protocols are not reused as daycare logs.

## Product decisions before implementation

Resolve organization timezone/default/backdating semantics, first attendance roles and delegation, branch/room requirements, correction approval, offline behavior (online-only is the proposed first boundary), visit closure rules and retention. Obtain review of the attendance scope first. Broader classroom/shift, guardians/pickup and daily-care proposals remain independent; no assumption that all ship together.
