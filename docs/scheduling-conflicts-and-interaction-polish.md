# Scheduling conflicts and interaction polish

Prepared October 24, 2026 (America/Chicago). Feature branch `feat/scheduling-conflicts` is based on service-model PR #43 (`3a8188e`), whose required CI passed. No merge, production migration or deployment is authorized by this work.

## Conflict-detection milestone

The server reads both legacy clinical/individual rows and group Activity snapshots using the current tenant and scheduling grant. Half-open UTC intervals exclude adjacent bookings. Scheduled, confirmed, in-progress, paused and completed clinical rows occupy their saved interval; canceled, absent and no-show rows do not. Group scheduled/confirmed rows occupy their interval. Missing ends produce uncertainty warnings rather than invented availability. Counts are event counts, never participant totals. The public DTO exposes counts and an opaque review ID; it does not expose event IDs, names, titles, locations or clinical details.

Creation and rescheduling in the current UI use a reviewed writer for clinical sessions, individual Activities and group Activities. It obtains the existing organization lock, re-reads current participants and conflicts, and compares the exact actor-bound proposal and snapshot. Reviews expire after ten minutes. Changed/expired reviews return a new review rather than saving. Every indicated category needs explicit acknowledgement and a 10–500 character reason. Child overlaps may be planned pull-outs; no participant is automatically removed. Staff overlap gets priority review. Unknown ends require a separate acknowledgement.

Acknowledgements, actor, timestamp, proposed details and conflict/version snapshot are private audit records linked to the resulting scheduled record. They commit with the save. Successful creation retries resolve the original operation receipt without another acknowledgement. Existing stale versions, Class archive/roster validation, clinical preparation checks, subscription/device/tenant authority and cancellation fences remain in place. Historical/started clinical lifecycle rules are explicitly reproduced for the new definer edit endpoint, because the old direct-write trigger intentionally skips definer RPCs. Metadata edits retain exact timestamps.

### Scope and limitation

This is conflict detection and reviewed scheduling, not a universal overlap prohibition or a claim of conflict-free scheduling. The new UI's reviewed entrypoints transactionally recheck both storage models, but older RPC and direct-table clients remain compatible and can bypass this new review path. A future hardening pass must cover those entrypoints, imports/integrations and concurrent legacy-versus-reviewed writes before claiming universal enforcement. Acknowledgement does not establish attendance, staffing coverage, ratios, payroll or billing.

The forward migration `20261024082651_schedule_conflict_reviews.sql` creates two private RPC-only RLS tables, invoker public wrappers and narrowly scoped private implementations. Unacknowledged review drafts older than one day are pruned for the current actor during later checks; acknowledged audit snapshots are retained. Review this migration separately and reconcile prior production/local migration timestamps by name/definition before any release.

## Conventional interaction enhancements implemented

- Shared enabled buttons press gently to 98.5% for 120ms. Calendar drag cells never transform.
- Only navigable Setup cards get interactive feedback; static cards remain still. Their press is smaller (99.5%).
- Hover feedback is restricted to fine pointers with hover support, avoiding persistent touchscreen hover effects.
- Disabled/ARIA-disabled shared buttons do not get enabled press/hover effects.
- All new spatial press effects require `prefers-reduced-motion: no-preference`; existing reduced-motion support remains.
- Shared buttons, navigable cards and calendar buttons get a clear 3px keyboard focus ring.
- Default primary actions use the existing darker teal token (#397f89) with white text: approximately 4.59:1 contrast. Ocean/lavender palettes remain intact.
- Native conflict dialog provides modal focus containment, Escape cancellation and focus restoration. Focus begins at the review heading.
- Review choices use full-width 44px minimum checkbox rows, visible labels and a plain textarea with help text.
- Dialog width, height and overflow adapt to narrow screens; action buttons wrap without hiding content.
- A checked review card gains a quiet confirmation tint while retaining its text and checkbox state.
- Conflict dialogs and opted-in activity notices use a short opacity entrance only when motion is allowed. No permanent pulse, confetti or automatic scrolling is added.

These are conservative implementation choices using common interaction patterns. WCAG supplies accessibility constraints, not mandatory animation timings or a universal visual style. References: [Animation from interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions), [reduced-motion technique C39](https://www.w3.org/WAI/WCAG22/Techniques/css/C39.html), [target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum), and [minimum text contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum).

## Optional proposals requiring product/design approval

These are not implemented:

1. **Illustrated empty states:** small custom illustrations on empty Classes/Schedule pages. Approve illustration style and which pages before adding brand artwork.
2. **Tiny onboarding celebration:** a one-time checkmark flourish when setup is complete. Approve the tone and trigger; avoid celebrations on clinical, attendance or billing actions.
3. **Calendar workflow accent colors:** distinct restrained ABA/individual/group accents alongside the existing semantic badges. Approve the palette and validate color-vision/contrast behavior; text must remain primary.
4. **Mobile sticky scheduling action bar:** keep the main action visible on long forms. Approve placement after keyboard, safe-area, zoom and occlusion testing.
5. **Compact/comfortable density preference:** optional personal spacing for busy schedules. Approve the preference model and minimum touch/zoom behavior; never shrink the default targets.
6. **Personal theme or in-app motion preference:** useful beyond the OS setting, but requires a user-scoped preference contract and clear organization-versus-user precedence.
7. **Undo for cancellation:** requires a reviewed server policy, receipt handling and rechecking overlaps. A visual toast alone cannot safely restore a canceled record.
8. **Permission-aware conflict drilldown or alternate-slot suggestions:** could aid review, but requires a separate information-disclosure and availability policy. Suggestions must not imply verified staffing or conflict-free booking.

## Verification

Targeted synthetic tests cover cross-workflow overlaps, adjacency, DST/midnight, unknown ends, event counts, saved snapshots, record self-exclusion, reviewed create/edit, reason/checkbox requirements, stale/expired/other-actor reviews, private DTOs, access denials, stale record versions, receipts/cancel fences and historical/started clinical guards. Native race coverage adds two overlapping saves that initially observed no conflict, requiring the second reviewed transaction to return a fresh warning.

The extended real-UI/synthetic-database browser flow covers cancel-without-save, acknowledged save/audit, private warnings and dialog layouts at 320/375/768/1280px. Shared-style browser checks exercise enabled press feedback, disabled inertness, reduced-motion behavior and keyboard focus. Existing service-model, roster, attendance, recovery, field and walkthrough checks remain required.
