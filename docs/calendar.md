# Workspace calendar

The dashboard opens in week view on desktop and day view below 640px. Day, week and custom date ranges are selectable; custom ranges cover 1–31 days. Ranges longer than seven days, and multi-day mobile views, use a daily agenda. Times follow the browser's local timezone, displayed beside the controls.

Select a half-hour slot to open the existing scheduling form with a validated local start time. The configured session type suggests the end time. Review the client, worker, service and duration before saving through `create_prepared_session`. Scheduling requires both `can_manage_sessions` and organization write access. This uses the existing single-client session model.

Sessions load for the selected range with pagination and stable ordering, including sessions spanning midnight. Client branch filtering uses inner joins through client locations. Existing row-level policies determine visible records. Overlapping events use separate columns. Arrow keys move between slots; Enter opens scheduling. Mobile slots have 44px targets. Existing sessions open administrative details for schedulers and the delivery workspace for other staff.

Today's sidebar totals count sessions starting today, including completed/cancelled records, and follow the client branch filter. Refresh and successful creation update the totals. The calendar replaces the welcome/statistics/action cards; the greeting is in the desktop top bar. People category badges show total and active counts for the currently filtered records.

The mobile down arrow opens a full-screen native navigation dialog. The up arrow and Escape close it. Focus remains in the dialog while open and returns to its trigger on close.

The automatic read-only banner is hidden. Each page has an optional Access info control explaining role permissions and, when relevant, subscription restrictions or access-check failures. Its retry action preserves recovery. Disabled write controls and database checks remain authoritative.

Validation: `tests/calendar.test.cjs` covers local date validation, DST, overnight events, overlap allocation and pagination. `tests/calendar.browser.cjs` uses loopback-only synthetic adapters to verify slot selection/save, branches, date ranges, errors, keyboard navigation, mobile dialog, counters and owner/staff/delegated/read-only access. Existing session-heartbeat browser checks verify PIN locks and unsaved fields. No production customer data is used.
