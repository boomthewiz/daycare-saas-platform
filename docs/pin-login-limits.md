# PIN login attempt limits

Deploy the limit_pin_login_attempts database migration before the updated staff-login route. The new route fails closed if the limiter is unavailable. No new environment variable or paid service is required.

Each account gets five failed or pending attempts in a rolling 15-minute window and 20 in a rolling 24-hour window. The database reserves an attempt before account lookup or bcrypt comparison, serializing admission with a transaction advisory lock. Successful session creation removes only its own reservation. Failed, interrupted, or abandoned attempts expire automatically; denied requests do not extend the window. Unknown usernames use the same limiter. Username case and whitespace variants share a key while authentication retains its existing exact match.

The table stores a SHA-256 username key, random attempt ID and timestamp, never a PIN, hash of a PIN, session link, or raw username. These keys are pseudonymous, not anonymous. An account/time index bounds lookups; each admitted request cleans up at most 100 expired records. Inactive expired records may remain until subsequent traffic. Only service_role can access the table and RPC. Browser roles cannot inspect or reset counters. The RPC is SECURITY INVOKER with a pinned search path.

HTTP 429 responses include Retry-After and a readable wait time. The existing login screen displays the server error. This account-based limit survives server restarts and distributed attackers. It does not replace network-level flood protection or stronger credentials. An attacker who knows a username can temporarily exhaust that account's PIN allowance; existing email authentication remains a separate recovery path. Do not weaken the limit or add a public reset-counter endpoint to work around this.

Validation: node --test tests/pin-security.test.cjs; TypeScript and targeted lint checks; supabase/tests/pin_login_limits.sql against the deployed database. The SQL test rolls back synthetic data. Concurrent admission must also be checked using independent transactions.

On September 18, 2026, migration 20260918212259 was applied to Rejoyce App. All 14 route tests, TypeScript, targeted linting and the live SQL tests passed. Ten concurrently dispatched database transactions admitted five attempts and rejected five; the five synthetic reservations were deleted afterward. Security advisor counts remained unchanged. The local build could not complete because the sandbox blocked Google Fonts requests and workspace-root traversal; deployment build verification is required.

Migration history: the earlier CLI-generated 20260918041744_restrict_pin_hash_reads.sql was applied remotely as version 20260918211548. Reconcile this and earlier remote audit migrations before a blanket CLI database push.

