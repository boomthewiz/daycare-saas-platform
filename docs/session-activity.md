# Session activity and PIN lock

The session guard records trusted foreground key, pointer, touch and wheel events. Programmatic scrolling, automatic fetches and token refreshes do not renew access. Clicking Save already counts as foreground activity; no per-save heartbeat endpoint or database write was added.

A single one-minute gate controls immediate and trailing heartbeats. Activity recorded during the gate is sent when it opens, including after typing stops. Successful renewals also satisfy the periodic status check. Background tabs send neither heartbeat nor status polling. Server expiry, five-minute local inactivity, seven-day PIN and thirty-day authentication deadlines still apply; expired server leases cannot be revived by activity.

The policy response is cached for one minute per mounted guard. Only one routine status/activity request may be in flight. Lock and PIN unlock supersede older responses. Sign-out covers the workspace immediately, blocks routine checks and invalidates earlier responses. A failed sign-out leaves the workspace covered with an honest retry message.

The device-session route uses one atomic RPC for status, activity, lock and logout. PIN unlock retains the preliminary state check, rate limiter, bcrypt verification and atomic deadline recheck. No schema or SMTP change is needed.

Usage estimate: continuously active input previously produced approximately six activity requests plus two status checks per minute, each paired with a policy request (about 960 HTTP requests/hour/tab). The new scheduled path uses about sixty device requests plus sixty policy requests/hour/tab, approximately 87.5% fewer. Each non-PIN device request now performs one session RPC rather than two. Initialization, visibility transitions, PIN unlock and manual actions are additional. These are code-derived bounds, not measured invoice savings; other application requests are unaffected.

Validation: synthetic component lifecycle tests cover throttling, idle expiry with mounted unsaved work, hidden tabs, request overlap, stale responses and sign-out. Route tests verify one RPC and server-verified ownership. The full synthetic database/security suite, TypeScript and webpack build pass. ESLint reports only the two existing internal-location navigation warnings. A synthetic mobile browser pass verifies trusted editing activity, heartbeat throttling, PIN lock/unlock, preserved unsaved input and five-minute idle lock. Network adapters are synthetic; no live customer session is used.
