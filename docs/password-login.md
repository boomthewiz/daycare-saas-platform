# Optional password login

Email code remains the default on `/login`. “Use password instead” switches to email/password without requesting an email; switching back preserves the email-code cooldown. Passwords are cleared after submission and never persisted in browser storage by ReJoyce.

Profile offers “Set or change password.” It requires an active, unlocked device session with full authentication in the last ten minutes, using the same server-side freshness gate as PIN changes. New passwords require at least 12 characters and at most 72 UTF-8 bytes (the bcrypt limit). Supabase stores the password; ReJoyce does not store it in its tables or logs. Supabase's configured password and reauthentication policies remain authoritative. Password managers and paste are supported.

`POST /api/password-login` uses a fresh Supabase client per request and the existing atomic login-attempt limiter. After Auth verifies the password, the server binds the returned identity/session to the existing one-use device proof gate. The legacy `email_login_challenges` table and `complete_email` action are reused; their privileges remain service-role-only. User-supplied identity and organization fields are ignored. Inactive accounts and denied trust do not receive session tokens. First-time users must still complete PIN setup. Organization isolation, subscription restrictions and application permissions remain unchanged.

`POST /api/account-password` verifies the bearer identity and recent unlocked session, then calls Auth's user-update endpoint with that user's access token and the public API key. It never uses an administrator password override. Password update errors are displayed without exposing provider details or claiming success.

Forgot-password recovery uses the existing email-code flow and takes established accounts to Profile to choose a replacement password. It still depends on email delivery. An already locked-out user who never set a password needs working email or a separately verified support recovery process; this feature does not bypass identity verification. Initial PIN setup still precedes Profile access.

No SMTP settings, email templates, public signup behavior or database migrations are changed. Password login still depends on Supabase Auth availability. Authentication settings that require a current password or additional reauthentication may reject a password update; the application reports the failure rather than overriding that policy.

Validation: server tests cover failed credentials, rate limits, verified identity binding, inactive accounts, proof failure, stale/locked sessions, Unicode byte limits and bearer-scoped updates. The synthetic browser harness covers default email login, password switching during an email outage, successful/failed login, Profile password setup, recovery, read-only subscription access to account security settings and mobile layouts. Auth/email responses are mocked; no real emails or credentials are used. Hosted Auth verification remains a release check once a usable test project is available.

References: [Supabase password login](https://supabase.com/docs/guides/auth/passwords), [password security](https://supabase.com/docs/guides/auth/password-security), and the installed Auth client implementation for the user-update REST endpoint.
