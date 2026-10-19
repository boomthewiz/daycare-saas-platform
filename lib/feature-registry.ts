/** Product inventory only. Never use metadata as an authorization or entitlement decision. */
export type Domain = "shared" | "daycare" | "care_services" | "aba"
export type Maturity = "implemented" | "partial" | "planned" | "blocked"
export type Bundle = "base" | "clinical_addon"
export type FeatureKey =
  | "security.baseline" | "people.accounts" | "people.roster" | "people.import"
  | "operations.preferences" | "operations.schedule" | "operations.groups" | "operations.tasks"
  | "operations.reports" | "onboarding.tours" | "daycare.attendance" | "daycare.classrooms"
  | "daycare.guardians_pickup" | "daycare.daily_care" | "daycare.tuition" | "operations.payroll"
  | "care.eligibility" | "aba.program_setup" | "aba.target_recording" | "aba.behavior_recording"
  | "care.timed_services" | "care.documentation" | "aba.supervision" | "aba.claims" | "service.regulated_readiness"
  | "operations.activity_tags" | "operations.session_choices" | "care.parent_context"
export type AuthorizationReference = keyof typeof authorizationReferences

/** References to existing enforcement, not new grants. Future rules are explicitly unresolved. */
export const authorizationReferences = {
  attendance: { source: "supabase/migrations/20261019194610_p1_activity_and_attendance_activation.sql", rule: "Independent attendance view/record/correct grants and explicit attendance branch scopes; owner/admin-controlled correction delegation and scope edits. Device/account/tenant, version, subscription and close-only continuity checks apply." },
  session_context: { source: "supabase/migrations/20261019194610_p1_activity_and_attendance_activation.sql", rule: "Manage sessions plus existing session creation checks. Current-user/org recents, active saved options, atomic creation/tag snapshots and duplicate-operation protection. Tags confer no clinical authority." },
  baseline: { source: "supabase/migrations/20260919061400_enforce_pin_session_policy.sql", rule: "Tenant RLS, current_organization_id(), session_is_unlocked()/require_unlocked(); preserve device revocation and mandatory PIN." },
  subscription: { source: "supabase/migrations/20260924080336_self_service_organization_onboarding.sql", rule: "subscription_access() and write guards; preserve read/write and record-state distinctions." },
  clients: { source: "supabase/migrations/20261004053317_client_care_teams.sql", rule: "can_access_client(id) for reads; can_manage_clients() for management. Care and session assignments do not grant organization-wide access." },
  users: { source: "supabase/migrations/20261008061322_onboarding_progress.sql", rule: "can_manage_users(); onboarding_progress(true) returns only approved readiness summaries." },
  grants: { source: "lib/permissions.ts", rule: "Supported grants only; database delegation, self/owner/admin protections remain authoritative." },
  schedule: { source: "supabase/migrations/20260919061400_enforce_pin_session_policy.sql", rule: "can_manage_sessions() for administration; assigned-session reads remain separately scoped by RLS." },
  reports: { source: "supabase/migrations/20260919061400_enforce_pin_session_policy.sql", rule: "can_access_reports() includes owner or can_view_reports(). This does not grant access to every source row or staff summary." },
  clinical: { source: "supabase/migrations/20260923185604_complete_service_session_lifecycle.sql", rule: "Session assignment, mutate_session_note action/state checks, can_review_sessions()/note-admin rules, locked records and protected remarks remain distinct." },
  tasks: { source: "app/(dashboard)/tasks/page.tsx", rule: "Legacy tasks RLS remains authoritative; intended current-model ownership and date scope are unresolved." },
  setup: { source: "lib/use-setup-access.ts", rule: "Existing can_manage_clients(), can_manage_sessions(), can_manage_users() RPCs; vocabulary is display configuration only." },
  future: { source: "docs/daycare-foundations-proposal.md", rule: "No enforceable workflow authority exists yet. Design and test dedicated record/action rules before implementation." },
} as const

export type FeatureDefinition = {
  key: FeatureKey
  domains: readonly Domain[]
  proposedBundle: Bundle
  maturity: Maturity
  dependencies: readonly FeatureKey[]
  authorization: readonly AuthorizationReference[]
  sensitivity: "account" | "child" | "clinical" | "learning"
  regulatedServiceReview: "required_if_processing_ephi"
  limitation: string
}

function feature(key: FeatureKey, domains: readonly Domain[], proposedBundle: Bundle, maturity: Maturity,
  dependencies: readonly FeatureKey[], authorization: readonly AuthorizationReference[],
  sensitivity: FeatureDefinition["sensitivity"], limitation: string): FeatureDefinition {
  return { key, domains, proposedBundle, maturity, dependencies, authorization: ["baseline", "subscription", ...authorization], sensitivity, regulatedServiceReview: "required_if_processing_ephi", limitation }
}

/** Maturity describes the named workflow, not the maturity of a proposed report or tour. */
export const features: readonly FeatureDefinition[] = [
  feature("security.baseline", ["shared"], "base", "implemented", [], [], "account", "Baseline safeguards remain required for all bundles; inventory is not a security certification."),
  feature("people.accounts", ["shared"], "base", "implemented", ["security.baseline"], ["users", "grants"], "account", "Invitation acceptance, account readiness and assignment readiness are separate; delivery is not established."),
  feature("people.roster", ["shared", "daycare"], "base", "implemented", ["security.baseline"], ["clients"], "child", "Current clients, status and branch membership only; no enrollment history or guardian model."),
  feature("people.import", ["shared", "daycare"], "base", "partial", ["people.roster"], ["clients", "users"], "child", "Existing import/result downloads; durable import-run history is missing. Source-specific grants still apply."),
  feature("operations.preferences", ["shared"], "base", "implemented", ["security.baseline"], ["setup"], "account", "Branches, vocabulary and themes do not select entitlements, service readiness or legal applicability."),
  feature("operations.schedule", ["shared", "daycare"], "base", "implemented", ["people.roster"], ["schedule"], "child", "Explicit ordinary activity versus clinical intent. Ordinary activities prepare no targets and cannot use clinical execution/notes. Existing callers retain clinical semantics. Scheduled activity is not attendance, staff availability or payroll. Current branch filters are not historical location."),
  feature("operations.groups", ["shared", "daycare"], "base", "partial", ["people.roster", "people.accounts"], ["clients"], "child", "Care groups are selection shortcuts; they do not implement classroom enrollment, shifts, ratios or access grants."),
  feature("operations.tasks", ["shared", "daycare"], "base", "partial", ["people.roster"], ["tasks"], "child", "Legacy children/classrooms references, UTC day selection and console-only load errors need repair before completeness reporting."),
  feature("operations.reports", ["shared"], "base", "partial", ["security.baseline"], ["reports"], "child", "D1–D3 shell, scoped queries, explicit reporting timezone and CSV page export implemented in slice 2; release awaits migrations and authorization. Broader reports remain model-gated."),
  feature("onboarding.tours", ["shared"], "base", "partial", ["security.baseline"], ["setup"], "learning", "Anchored base Setup/People/Reports tours and user/org-scoped browser learning progress implemented. Clinical modules and cross-device persistence remain planned; no product gates added."),
  feature("daycare.attendance", ["daycare"], "base", "partial", ["people.roster"], ["attendance"], "child", "Branch-level check-in/out, independent scopes, append-only event history, seven-date corrections and eligible close-only continuation released October 18. Configuration-only owner/admin activation checklist added in P1 (not yet released). Classroom attribution and absence workflows remain missing; D4 is incomplete."),
  feature("operations.activity_tags", ["shared", "daycare", "care_services"], "base", "implemented", ["operations.schedule"], ["session_context"], "child", "Optional reusable activity tags with shared/daycare/client-care/ABA domain metadata and creation-time session snapshots. A label grants no entitlement, treatment authority or verified outcome."),
  feature("operations.session_choices", ["shared", "daycare", "care_services"], "base", "implemented", ["operations.schedule", "operations.activity_tags"], ["session_context"], "child", "Search configured and previously entered choices, explicitly save new types/locations/tags and reuse ten current-user/org recent successful selections. Dates are never copied or sessions auto-created."),
  feature("care.parent_context", ["care_services", "aba"], "clinical_addon", "partial", ["operations.activity_tags"], ["session_context", "clinical"], "clinical", "Parent-observed/parent-led practice can be optional user-created context labels. Verified caregiver training, competency, consent and clinical outcomes remain separate unimplemented workflows. No add-on gate is enabled."),
  feature("daycare.classrooms", ["daycare"], "base", "blocked", ["daycare.attendance", "operations.groups"], ["future"], "child", "Requires room/enrollment history, capacity, staff presence, shift history and rule configuration."),
  feature("daycare.guardians_pickup", ["daycare"], "base", "blocked", ["people.roster"], ["future"], "child", "Requires explicit relationships, verified pickup authority, revocation and change history; staff accounts are not guardians."),
  feature("daycare.daily_care", ["daycare"], "base", "blocked", ["people.roster"], ["future"], "child", "Meals, naps, incidents, family summaries and ordinary observations require dedicated data, review and sharing controls."),
  feature("daycare.tuition", ["daycare"], "base", "planned", ["people.roster"], ["future"], "child", "No daycare receivables model; SaaS subscriptions are not tuition."),
  feature("operations.payroll", ["shared", "daycare"], "base", "blocked", ["people.accounts"], ["future"], "account", "Requires actual timekeeping and payroll rules; session timers are not workforce hours."),
  feature("care.eligibility", ["care_services", "aba"], "clinical_addon", "implemented", ["people.roster", "people.accounts"], ["clients"], "clinical", "Explicit client care-team eligibility and shared branch rules; ordinary classroom staffing is a separate model."),
  feature("aba.program_setup", ["aba", "care_services"], "clinical_addon", "implemented", ["care.eligibility"], ["clients", "schedule"], "clinical", "Released targets, reusable behavior assignment and session preparation; not a daycare readiness prerequisite."),
  feature("aba.target_recording", ["aba", "care_services"], "clinical_addon", "partial", ["aba.program_setup", "operations.schedule"], ["clinical"], "clinical", "Common response UI does not establish validated mode-aware duration/intensity/interval capture or mastery analytics."),
  feature("aba.behavior_recording", ["aba", "care_services"], "clinical_addon", "partial", ["aba.program_setup", "operations.schedule"], ["clinical"], "clinical", "Counting foundation exists; quick actions submit null duration/intensity. Missing measurements remain missing."),
  feature("care.timed_services", ["care_services", "aba"], "clinical_addon", "implemented", ["operations.schedule"], ["clinical"], "clinical", "Start/pause/resume/finish are therapeutic service controls, not child presence or a payroll clock."),
  feature("care.documentation", ["care_services", "aba"], "clinical_addon", "implemented", ["operations.schedule"], ["clinical"], "clinical", "Clinical note lifecycle and protected remarks; daycare logs need their own model and permissions."),
  feature("aba.supervision", ["aba"], "clinical_addon", "partial", ["care.documentation"], ["clinical", "future"], "clinical", "Supervisor fields are not a complete supervision workflow."),
  feature("aba.claims", ["aba"], "clinical_addon", "blocked", ["care.documentation"], ["future"], "clinical", "Authorizations/utilization/claims need source models; SaaS billing records cannot supply them."),
  feature("service.regulated_readiness", ["shared"], "clinical_addon", "planned", ["security.baseline"], ["future"], "account", "Separate reviewed contracts, operations, data flows and technical controls required. Tags/payment do not establish HIPAA readiness."),
]

export type ReportDefinition = {
  id: string
  title: string
  featureKey: FeatureKey
  researchIds: readonly string[]
  maturity: "implemented" | "planned" | "blocked"
  authorization: readonly AuthorizationReference[]
  interpretation: string
}
function report(id: string, title: string, featureKey: FeatureKey, researchIds: readonly string[], maturity: ReportDefinition["maturity"], authorization: readonly AuthorizationReference[], interpretation: string): ReportDefinition {
  return { id, title, featureKey, researchIds, maturity, authorization: ["baseline", "subscription", "reports", ...authorization], interpretation }
}
/** Report implementation maturity is independent of source workflow maturity. Release status is documented separately. */
export const reports: readonly ReportDefinition[] = [
  report("D1", "People roster and current status", "people.roster", ["R10", "R6"], "implemented", ["clients"], "Current snapshot, not historical enrollment/starts/leavers. No guardian or demographic columns without a source."),
  report("D2", "Staff account and setup readiness", "people.accounts", ["R9"], "implemented", ["users"], "Manage users required in addition to report access. Acceptance, current account status, PIN/account readiness and active branch assignment are separate facts. Branch assignment does not establish classroom or shift readiness; this is not attendance or delivery proof."),
  report("D3", "Schedule and activity overview", "operations.schedule", ["R1", "R3", "R12"], "implemented", ["schedule"], "Recorded scheduled/completed/canceled activity, not attendance or payroll. No historical branch claim from current membership."),
  report("D4", "Attendance and missing check-outs", "daycare.attendance", ["R3"], "blocked", ["attendance", "future"], "A separate attendance workspace now shows branch-level recorded presence/open-visit exceptions and authorized page exports. Full D4 remains blocked by classroom attribution and absence workflows; no ratio/pickup claim."),
  report("D5", "Daily task completion and exceptions", "operations.tasks", ["R15"], "blocked", ["tasks", "future"], "Connect current child/classroom ownership and local-day semantics before reporting completeness."),
  report("D6", "Classroom capacity and staff coverage", "daycare.classrooms", ["R16"], "blocked", ["future"], "Separate enrollment, expected schedule and presence; no licensing-compliance calculation from session overlap."),
  report("D7.care", "Daily care and family summaries", "daycare.daily_care", ["R18"], "blocked", ["future"], "Dedicated care data and review/share controls required."),
  report("D7.pickup", "Authorized pickup records", "daycare.guardians_pickup", ["R18"], "blocked", ["future"], "Verified relationships and pickup event history required."),
  report("clinical.time", "Scheduled versus recorded service time", "care.timed_services", ["R2", "R5"], "planned", ["clinical"], "Specialized individual service activity; not staff hours."),
  report("clinical.notes", "Documentation completion and turnaround", "care.documentation", ["R4", "R11"], "planned", ["clinical"], "Clinical review scope and immutable lifecycle events; baseline security logging stays shared."),
  report("clinical.setup", "Care and program setup coverage", "aba.program_setup", ["R6"], "planned", ["clients"], "Clinical readiness only; not required daycare setup."),
  report("clinical.targets", "Target responses and progress", "aba.target_recording", ["R7"], "blocked", ["clinical"], "Mode-aware capture, stable identities and metric definitions first."),
  report("clinical.behaviors", "Behavior measurement trends", "aba.behavior_recording", ["R8"], "blocked", ["clinical"], "Validated measurements and observation denominators; missing values are not zeros."),
  report("learning.adoption", "Personal onboarding adoption", "onboarding.tours", ["R13"], "blocked", ["future"], "Minimal user/org learning metadata, no child content or staff ranking; authority model unresolved."),
  report("imports.history", "Import history", "people.import", ["R14"], "blocked", ["future"], "Durable run storage required; retain existing result downloads."),
  report("daycare.receivables", "Daycare tuition and receivables", "daycare.tuition", ["R17"], "blocked", ["future"], "Separate daycare financial model required."),
  report("operations.payroll", "Staff payroll", "operations.payroll", ["R17"], "blocked", ["future"], "Actual timekeeping model required."),
  report("clinical.claims", "Clinical authorization utilization and claims", "aba.claims", ["R17"], "blocked", ["future"], "Separate authorization and claims model required."),
  report("clinical.outcomes", "Clinical assessments and outcomes", "aba.target_recording", ["R18", "R1", "R3"], "blocked", ["clinical", "future"], "Structured assessments and sound treatment metrics; ordinary daycare observation is a separate workflow."),
]

export type TutorialDefinition = {
  id: string
  featureKey: FeatureKey
  pageFamily: string
  maturity: "implemented" | "planned"
  authorization: readonly AuthorizationReference[]
  requiredForBaseReadiness: false
}
/** Only the base Setup/People/Reports families have a runtime consumer. No tour changes business readiness. */
export const tutorials: readonly TutorialDefinition[] = [
  { id: "base.welcome", featureKey: "onboarding.tours", pageFamily: "dashboard", authorization: ["baseline"], maturity: "planned", requiredForBaseReadiness: false },
  { id: "base.setup", featureKey: "operations.preferences", pageFamily: "setup", authorization: ["baseline", "setup"], maturity: "implemented", requiredForBaseReadiness: false },
  { id: "base.people", featureKey: "people.roster", pageFamily: "people", authorization: ["baseline", "clients"], maturity: "implemented", requiredForBaseReadiness: false },
  { id: "base.staff", featureKey: "people.accounts", pageFamily: "people", authorization: ["baseline", "users", "grants"], maturity: "implemented", requiredForBaseReadiness: false },
  { id: "base.schedule", featureKey: "operations.schedule", pageFamily: "schedule", authorization: ["baseline", "schedule"], maturity: "planned", requiredForBaseReadiness: false },
  { id: "base.reports", featureKey: "operations.reports", pageFamily: "reports", authorization: ["baseline", "reports"], maturity: "implemented", requiredForBaseReadiness: false },
  { id: "base.daily_work", featureKey: "operations.tasks", pageFamily: "tasks", authorization: ["baseline", "tasks", "future"], maturity: "planned", requiredForBaseReadiness: false },
  { id: "clinical.care_setup", featureKey: "care.eligibility", pageFamily: "care_setup", authorization: ["baseline", "clients"], maturity: "planned", requiredForBaseReadiness: false },
  { id: "clinical.program_setup", featureKey: "aba.program_setup", pageFamily: "client", authorization: ["baseline", "clients"], maturity: "planned", requiredForBaseReadiness: false },
  { id: "clinical.target_recording", featureKey: "aba.target_recording", pageFamily: "session", authorization: ["baseline", "clinical"], maturity: "planned", requiredForBaseReadiness: false },
  { id: "clinical.behavior_recording", featureKey: "aba.behavior_recording", pageFamily: "session", authorization: ["baseline", "clinical"], maturity: "planned", requiredForBaseReadiness: false },
  { id: "clinical.delivery", featureKey: "care.timed_services", pageFamily: "session", authorization: ["baseline", "clinical"], maturity: "planned", requiredForBaseReadiness: false },
  { id: "clinical.documentation", featureKey: "care.documentation", pageFamily: "reviews", authorization: ["baseline", "clinical"], maturity: "planned", requiredForBaseReadiness: false },
]

/** Pure inventory lookup. Returns undefined for unknown keys; does not evaluate access. */
export function getFeature(key: string): FeatureDefinition | undefined {
  return features.find(feature => feature.key === key)
}

/** Resolve shared metadata without conflating a source workflow's maturity with report/tour maturity. */
export function getFeatureInventory(key: string) {
  const feature = getFeature(key)
  return feature ? { ...feature, reports: reports.filter(report => report.featureKey === key), tutorials: tutorials.filter(tutorial => tutorial.featureKey === key) } : undefined
}
