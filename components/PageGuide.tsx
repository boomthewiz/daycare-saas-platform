"use client"
import Link from "next/link"
import { usePortal } from "@/components/PortalProvider"

type Step = { title: string; text: string; href?: string }
const guides = {
  setup: {
    title: "Start setting up your workspace",
    steps: [
      { title: "Review business preferences", text: "Check your branches and reusable session types first. Keep the supplied terminology unless different labels would help your team.", href: "/setup/preferences" },
      { title: "Prepare team access", text: "Invite staff and review each person's grants. Assign staff to active branches before selecting them for client care teams. Groups and classes are optional selection shortcuts.", href: "/setup/roles" },
      { title: "Connect clients to everyday work", text: "In Team, add clients, choose their branches and explicitly save their care teams. Add targets on the client record, then schedule a session and prepare its targets.", href: "/team-management" },
    ],
    access: "Manage sessions allows branch and session-type changes. Manage clients allows target categories and care-team setup. Either grant allows terminology changes. Manage users allows invitations and account management; changing grants also requires delegation authority. Read-only subscription access prevents organization changes.",
  },
  preferences: {
    title: "Choose the settings you need first",
    steps: [
      { title: "Branches, then session types", text: "Create active branches for where your team works. Review session types and their required default duration of 1–1,440 whole minutes. The scheduling form uses these defaults to suggest an end time for a new session." },
      { title: "Optional categories and terminology", text: "Target categories organize reusable client targets. Terminology records your preferred labels, although some older pages still use standard labels. These settings do not rename existing records." },
      { title: "Connect staff and clients", text: "Assign staff branches in care-team setup and client branches in Team. Changing a group does not update saved client assignments. Disabling an option removes it from active choices; existing session times stay unchanged.", href: "/setup/care-teams" },
    ],
    access: "Manage sessions is required for branches and session types; Manage clients for target categories; either for terminology. Current grants and subscription access determine which editing controls are enabled.",
  },
  care: {
    title: "Connect branches before choosing care teams",
    steps: [
      { title: "Assign staff branches", text: "Select active staff, choose where they work and save. If a branch is missing, create it in business preferences first.", href: "/setup/preferences" },
      { title: "Optionally create groups or classes", text: "Choose a branch and eligible members. People may belong to several groups. Groups make selecting people easier and do not grant client access." },
      { title: "Save each client's care team", text: "Open Team, choose the client's active branches, select eligible staff and save the care team. Staff need an explicit assignment and a shared active branch for care-team client access. Session assignments follow their own rules.", href: "/team-management" },
    ],
    access: "Manage clients is required to edit staff branches and groups. Account invitations and grants are managed separately under Roles and permissions. Read-only subscription access disables saves.",
  },
  roles: {
    title: "Give people the access their work needs",
    steps: [
      { title: "Review account roles", text: "Choose the role that describes the person's work. Management actions depend on supported per-person grants; choosing an administrative role does not automatically enable every management action." },
      { title: "Invite and review grants", text: "With Manage users, invite a team member or open an account below. Grant changes also require delegation authority. Owner accounts, your own grants and administrator accounts have additional protections." },
      { title: "Assign care branches separately", text: "Once staff are active, set their branches and explicitly assign them to clients. Groups and role labels alone do not grant client care access.", href: "/setup/care-teams" },
    ],
    access: "You can revisit the role definitions here. Account management requires Manage users; protected grants remain limited to the existing owner and administrator rules. Custom roles and role-wide grant templates are unavailable.",
  },
  team: {
    title: "Prepare a client for daily care",
    steps: [
      { title: "Review branches and staff", text: "Use Setup to create active branches and assign staff branches before selecting a client care team.", href: "/setup/care-teams" },
      { title: "Add or open a client", text: "Choose the client's branches, select eligible staff and save. Groups help select people; the saved client care team determines assignments. The header's client branch filter narrows this list." },
      { title: "Prepare targets and sessions", text: "Open the client record to add targets and behavior definitions, then use Sessions to schedule and copy the targets needed for that session.", href: "/sessions" },
    ],
    access: "Manage clients is required to add clients and manage care assignments. Invitations require Manage users, and scheduling requires Manage sessions. The database checks access on every save.",
  },
  client: {
    title: "Start with the client's care plan",
    steps: [
      { title: "Check profile, branches and care team", text: "Review the client details and saved assignments first. Care-team members must share an active branch. Saving a group elsewhere does not update this client's team." },
      { title: "Add reusable targets", text: "Use targets for the work you plan to document. Categories come from Setup; behavior definitions are optional when behavior tracking is needed." },
      { title: "Schedule and prepare a session", text: "Create the session in Sessions, then prepare its targets. Upcoming and completed sessions on this record link to their saved details.", href: "/sessions" },
    ],
    access: "Manage clients controls client changes. Session preparation requires Manage sessions. Staff care access, session assignments and note review permissions are checked separately; seeing a record does not grant editing authority.",
  },
  sessions: {
    title: "Schedule, prepare, then deliver care",
    steps: [
      { title: "Check reusable settings", text: "Active service types, default durations and locations come from Setup. Configure missing options there before scheduling.", href: "/setup/preferences" },
      { title: "Choose client, provider and time", text: "Select a service type and start time. Its default duration suggests an end time; review both times before saving. Changing Setup defaults does not reschedule saved sessions." },
      { title: "Review prepared targets and run the session", text: "Active client targets are copied when you create a session. Open the saved session to review or adjust its prepared targets. Assigned staff use My Sessions to run care, record responses and submit notes. Reviewers use Reviews after submission." },
    ],
    access: "Manage sessions is required to schedule and prepare sessions. Assigned staff delivery and Review session notes are separate permissions. Subscription access and device protection still apply.",
  },
  session: {
    title: "Review this session before making changes",
    steps: [
      { title: "Check saved details", text: "Review provider, service type and scheduled times. Active service types come from Setup; the saved type remains visible if it has been retired." },
      { title: "Prepare the targets needed", text: "Add existing client targets to this session. The session holds prepared copies; changes to reusable client targets do not silently replace session records." },
      { title: "Save deliberately", text: "Use Edit and Save for allowed changes. Choosing another type in this editor preserves the saved start and end times; reschedule explicitly if needed. Started and historical sessions restrict changes. Assigned staff deliver care through the session workspace." },
    ],
    access: "Manage sessions is required to edit. Saved records, started-session restrictions, subscription access and device safeguards remain authoritative. Note review uses its separate permission.",
  },
} satisfies Record<string, { title: string; steps: Step[]; access: string }>

export default function PageGuide({ guide }: { guide: keyof typeof guides }) {
  const { t } = usePortal()
  const content: { title: string; steps: Step[]; access: string } = guides[guide]
  return <details className="rj-card min-w-0 p-4 sm:p-5">
    <summary className="cursor-pointer rounded-md font-bold text-[var(--rj-teal-700)]">Getting started: {t(content.title)}</summary>
    <ol className="mt-4 list-decimal space-y-4 pl-5">
      {content.steps.map(step => <li key={step.title} className="pl-1"><p className="font-semibold">{t(step.title)}</p><p className="rj-caption mt-1">{t(step.text)}</p>{step.href && <Link href={step.href} className="mt-2 inline-block font-semibold underline">Open {step.href === "/setup/preferences" ? "business preferences" : step.href === "/setup/care-teams" ? "care-team setup" : step.href === "/setup/roles" ? "roles and permissions" : step.href === "/sessions" ? t("Sessions") : "People"}</Link>}</li>)}
    </ol>
    <p className="rj-caption mt-4 rounded-lg bg-[var(--rj-surface-muted)] p-3"><strong>Your access: </strong>{content.access}</p>
  </details>
}
