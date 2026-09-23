# Service sessions and documentation

The lifecycle separates delivery of service from review of its documentation. Existing assignment, frontline-role, tenant and device-session rules still apply. Owners retain organization review authority; other accounts need the current `can_review_sessions` grant to approve, return or lock notes.

## Supported workflow

| State | Available actions |
| --- | --- |
| Scheduled or confirmed session | Managers prepare assignments, schedule and targets. Assigned frontline providers start service. |
| In progress or paused session | Assigned frontline providers save observations and draft notes. Service controls pause, resume and finish. Submission is unavailable. |
| Completed session, no note/draft/returned note | The assigned frontline author saves or submits the note. Submitting saves the displayed text and changes status in one transaction. |
| Submitted note | Users with review permission return with required feedback, approve, or lock as unapproved. |
| Returned note | Its assigned author edits and resubmits. Saving keeps the returned status and feedback visible. |
| Approved note | Text is read-only. Reviewers may lock it. Only owners/admins may revert approval to submitted, after which a reviewer may return it. |
| Locked note | Text and status remain unchanged until an owner/admin unlocks it. Unlock restores the exact prior status: approved or submitted (unapproved). |

Owners/admins may append a separate remark to an existing note in any state, including locked. Each remark has its own author and timestamp, cannot be edited/deleted by application users, and does not update **any** field on `session_notes`, including its version or timestamps. Admin-only reversal/unlock/remarks do not implicitly grant normal review permission.

There is one note per session. Another provider cannot take over a note. Existing self-review policy is unchanged; this phase does not introduce a new separation-of-duties rule. There is no post-approval direct text editing. Locked drafts/returned notes are not introduced: locking is available for submitted or approved records.

## Screens and failure handling

- The session workspace links to documentation during service. Drafts are saved explicitly; unsaved text is kept in the open tab, not browser persistent storage. The previous microphone button only toggled a visual state and did not record audio; it is replaced with the real note workflow.
- `/session/[sessionId]/complete` is the shared provider documentation screen. It shows reviewer feedback, note history and separate remarks. Recorded data can be loaded and deliberately used as a draft without silently overwriting text.
- `/reviews/[sessionId]` is the missing review-detail destination from the existing queue. Admins can reach records for remarks/reversal/unlock even without a normal review grant; server checks remain authoritative.
- `/my-sessions/history` pages through completed/canceled/absent/no-show sessions. The review queue can load older notes; displayed counts/search describe the notes currently loaded.
- Note mutation requests include an expected version and a unique operation ID. Stale versions fail without overwriting data. Retrying the same operation and payload does not duplicate a write or history event. Reusing an operation ID for different content is rejected.
- Failed writes retain text and offer a retry of that exact request. Reloading warns before replacing unsaved text. A confirmed write followed by a failed history refresh is reported as saved; it does not offer to repeat the write. Full page closure still discards unsaved work.
- Session completion is safe to repeat without changing the completion timestamp. Provider actions serialize with assignment changes and collection writes. Starting a paused session is rejected; resume accounts for paused duration.
- Managers cannot directly manufacture completion, reset service timing, change assignments/schedule after service starts, or edit historical sessions/targets. Preparation reordering is atomic and checks the expected positions.

## Data and history

`session_note_history` records the acting user's name/ID, action, time and the resulting note snapshot, including its structured service data. Each save/review/status transition is recorded in the same transaction as the note write. Existing notes receive a clearly labeled baseline; earlier history is not reconstructed. Existing locked notes are known to have been approved under the prior implementation and are backfilled accordingly without changing their timestamps.

History and remarks are readable only to the assigned provider, current reviewers, or owners/admins in the same organization with an unlocked device. Application users have no direct insert/update/delete access. Foreign keys prevent silent cascade deletion of a note/session that has history or remarks. Any later retention/deletion product requires a separate design; this phase provides no purge controls.

The new public RPCs are security-invoker wrappers around narrowly authorized private functions with an empty search path. The six former note-write RPCs are revoked from `PUBLIC`, `anon`, and `authenticated` so an old client cannot bypass versioning or the completion requirement. No new role/delegation grants are introduced.

## Validation and rollout

- `node --test tests/*.test.cjs`: 60 application tests, including the action/authority matrix and failure messages.
- TypeScript and focused ESLint for changed application files.
- `supabase/tests/service_session_lifecycle.sql`: synthetic provider/reviewer/admin/owner, atomic submit, stale write, duplicate retry, feedback, locked remarks/timestamp invariance, target preparation, service timing, cross-tenant and locked-device checks. Entire fixture transaction rolls back.
- Updated tenant relationship regression uses the new note RPC and checks historical deletion protection alongside the existing tenant matrix.
- `tests/session-notes.browser.cjs`: headless Chrome interaction tests with synthetic, intercepted Supabase responses. This tests rendering and failure behavior; it is not a production browser acceptance test. Requires Playwright available to Node and a dev server configured with `NEXT_PUBLIC_SUPABASE_URL=https://workflow-test.supabase.co` and a synthetic public key. It never uses production credentials.
- Production build uses synthetic configuration values and performs no authenticated production workflow.

The database migration and application changes are one coordinated release. Apply the migration immediately before deploying this application version; cached older clients must reload because their former note RPCs are intentionally denied. Do not roll the UI back alone after the migration. Restore compatibility only with a reviewed migration that retains the completion, authority and concurrency guarantees. Production rollout and real-account browser acceptance remain separate from the transactional regression and mocked browser validation.
