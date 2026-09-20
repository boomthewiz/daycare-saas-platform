# Required initial PIN setup review

The setup screen now checks trusted device-session state before showing the form. Missing or expired full authentication shows a clear email-confirmation action; inactive accounts show administrator guidance. Users with a configured PIN return to the protected dashboard. Required setup has no skip action.

The form explains four-digit daily PIN versus six-digit email code, labels both masked inputs, supports numeric keyboards and form submission, confirms the PIN, shows errors inline, clears entered credentials after submission and replaces the setup history entry after success. Sign-out revokes the device session before clearing local Auth state. Auth changes recheck setup eligibility.

Validation: 30 authentication tests pass, including verified email sign-in returning setup, recent authentication permitting initial PIN storage, and expired setup authentication refusing writes. TypeScript and targeted ESLint pass. The previously run rollback-only database regression proves that missing PIN and reset-required states deny protected reads/RPC access with the production policy enabled.

Remaining acceptance check for issue #5: walk through a genuinely newly invited account on desktop and mobile, including email delivery, mismatched PIN confirmation, expired authentication, connection failure, reload/back navigation and successful first dashboard entry. Automated backend tests are not a substitute for that full browser journey. No existing user's PIN was reset for testing.
