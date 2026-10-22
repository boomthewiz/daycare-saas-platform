# Form fields

Text entries use the shared `.rj-input` treatment: a plain surface, rounded border, normal `0.875rem 1rem` inset, muted placeholder and visible focus ring. This is the approved default for new and edited forms (October 21, 2026).

- Keep decorative icons outside text, search, email, password, number and multiline entry fields. Use the same plain treatment for adjacent date/time and status-filter controls.
- Keep visible labels, existing useful placeholders, help/error text, accessible names and required/disabled/readonly semantics. A placeholder does not replace a label.
- Preserve functional controls: native date/time pickers, select arrows, search clear controls and password reveal buttons. Keep their hit areas clear of text.
- Use the normal shared inset; do not add icon-only `pl-10`/`pl-11`/`pl-12`, global padding increases or `!important` fixes. If a functional adornment needs space, design and verify its layout explicitly.
- Navigation, action-button, card and status icons remain appropriate outside entry fields.

Verify empty, populated and disabled states at narrow mobile and desktop widths, keyboard focus and relevant native controls. `tests/form-fields.browser.cjs` covers the affected routes with synthetic data; `docs/form-field-cleanup-2026-10-20.md` records its coverage limits.
