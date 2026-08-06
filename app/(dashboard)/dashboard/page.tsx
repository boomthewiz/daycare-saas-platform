"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react"
import Link from "next/link"
import {
  ArrowRight,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  Clock3,
  LoaderCircle,
  RefreshCw,
  Settings2,
  Sparkles,
  UserRound,
  Users,
} from "lucide-react"

import { supabase } from "@/lib/supabase"

type UserRole =
  | "owner"
  | "admin"
  | "manager"
  | "director"
  | "therapist"
  | "teacher"
  | "educator"
  | "assistant"
  | "aide"
  | "caregiver"
  | "staff"

type UserProfile = {
  id: string
  full_name: string | null
  role: UserRole
  organization_id: string | null
}

type ClientRecord = {
  id: string
  first_name: string
  preferred_name: string | null
  status: string
}

type TeamMemberRecord = {
  id: string
  full_name: string | null
  email: string | null
  role: UserRole
  status: string
}

type SessionRecord = {
  id: string
  client_id: string
  provider_id: string | null
  status: string
  scheduled_start: string | null
  scheduled_end: string | null
  location: string | null
}

type DashboardSession = SessionRecord & {
  clientName: string
  providerName: string
}

const ADMIN_ROLES: UserRole[] = [
  "owner",
  "admin",
  "manager",
  "director",
]

export default function DashboardPage() {
  const [profile, setProfile] =
    useState<UserProfile | null>(null)

  const [clients, setClients] =
    useState<ClientRecord[]>([])

  const [teamMembers, setTeamMembers] =
    useState<TeamMemberRecord[]>([])

  const [sessions, setSessions] =
    useState<DashboardSession[]>([])

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const [pageError, setPageError] =
    useState<string | null>(null)

  const isAdmin =
    profile !== null &&
    ADMIN_ROLES.includes(profile.role)

  const loadDashboard = useCallback(
    async (showRefreshState = false) => {
      if (showRefreshState) {
        setRefreshing(true)
      } else {
        setLoading(true)
      }

      setPageError(null)

      try {
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser()

        if (userError) {
          throw new Error(userError.message)
        }

        if (!user) {
          throw new Error(
            "Your login session could not be found."
          )
        }

        const {
          data: profileData,
          error: profileError,
        } = await supabase
          .from("users")
          .select(`
            id,
            full_name,
            role,
            organization_id
          `)
          .eq("id", user.id)
          .single()

        if (profileError) {
          throw new Error(profileError.message)
        }

        const currentProfile =
          profileData as UserProfile

        setProfile(currentProfile)

        const userIsAdmin =
          ADMIN_ROLES.includes(currentProfile.role)

        /*
         * Administrators can see organization-wide data.
         * Frontline staff will receive only rows allowed by RLS.
         */
        const [
          clientResult,
          teamResult,
          sessionResult,
        ] = await Promise.all([
          supabase
            .from("clients")
            .select(`
              id,
              first_name,
              preferred_name,
              status
            `)
            .eq("status", "active")
            .order("preferred_name", {
              ascending: true,
              nullsFirst: false,
            }),

          userIsAdmin
            ? supabase
                .from("users")
                .select(`
                  id,
                  full_name,
                  email,
                  role,
                  status
                `)
                .eq("status", "active")
            : Promise.resolve({
                data: [],
                error: null,
              }),

          supabase
            .from("sessions")
            .select(`
              id,
              client_id,
              provider_id,
              status,
              scheduled_start,
              scheduled_end,
              location
            `)
            .gte(
              "scheduled_start",
              new Date(
                new Date().setHours(0, 0, 0, 0)
              ).toISOString()
            )
            .order("scheduled_start", {
              ascending: true,
            })
            .limit(12),
        ])

        if (clientResult.error) {
          throw new Error(clientResult.error.message)
        }

        if (teamResult.error) {
          throw new Error(teamResult.error.message)
        }

        if (sessionResult.error) {
          throw new Error(sessionResult.error.message)
        }

        const loadedClients =
          (clientResult.data || []) as ClientRecord[]

        const loadedTeam =
          (teamResult.data || []) as TeamMemberRecord[]

        const loadedSessions =
          (sessionResult.data || []) as SessionRecord[]

        setClients(loadedClients)
        setTeamMembers(loadedTeam)

        const clientMap = new Map(
          loadedClients.map((client) => [
            client.id,
            getClientName(client),
          ])
        )

        /*
         * Frontline users may not have permission to load
         * every organization user. Their own assigned session
         * will still appear with a neutral provider label.
         */
        const providerMap = new Map(
          loadedTeam.map((member) => [
            member.id,
            member.full_name ||
              member.email ||
              "Team member",
          ])
        )

        const formattedSessions =
          loadedSessions.map((session) => ({
            ...session,

            clientName:
              clientMap.get(session.client_id) ||
              "Assigned client",

            providerName: session.provider_id
              ? providerMap.get(session.provider_id) ||
                (session.provider_id === user.id
                  ? currentProfile.full_name ||
                    "You"
                  : "Assigned team member")
              : "Unassigned",
          }))

        setSessions(formattedSessions)
      } catch (error) {
        console.error(
          "Dashboard loading error:",
          error
        )

        setPageError(
          error instanceof Error
            ? error.message
            : "Unable to load the dashboard."
        )
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    []
  )

  useEffect(() => {
    loadDashboard()
  }, [loadDashboard])

  const todaySessions = useMemo(() => {
    const today = new Date()

    return sessions.filter((session) => {
      if (!session.scheduled_start) {
        return false
      }

      const sessionDate = new Date(
        session.scheduled_start
      )

      return (
        sessionDate.getFullYear() ===
          today.getFullYear() &&
        sessionDate.getMonth() ===
          today.getMonth() &&
        sessionDate.getDate() ===
          today.getDate()
      )
    })
  }, [sessions])

  const completedToday = todaySessions.filter(
    (session) => session.status === "completed"
  ).length

  const upcomingSessions = sessions.filter(
    (session) =>
      ![
        "completed",
        "canceled",
        "client_absent",
        "provider_absent",
        "no_show",
      ].includes(session.status)
  )

  const firstName =
    profile?.full_name?.trim().split(/\s+/)[0] ||
    "there"

  if (loading) {
    return <DashboardLoadingState />
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Welcome Header */}
      <header className="relative overflow-hidden rounded-[var(--rj-radius-xl)] border border-[var(--rj-border)] bg-[var(--rj-surface)] p-6 shadow-[var(--rj-shadow-soft)] sm:p-8">
        <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-[var(--rj-mint-100)] opacity-70" />

        <div className="pointer-events-none absolute -bottom-24 right-28 h-52 w-52 rounded-full bg-[var(--rj-lavender-100)] opacity-55" />

        <div className="relative flex flex-col justify-between gap-6 lg:flex-row lg:items-center">
          <div className="max-w-2xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-[var(--rj-teal-50)] px-3 py-1.5 text-sm font-bold text-[var(--rj-teal-700)]">
              <Sparkles size={16} />
              ReJoyce Workspace
            </div>

            <h1 className="rj-heading-1">
              Welcome back, {firstName}
            </h1>

            <p className="rj-body mt-3 text-[var(--rj-text-secondary)]">
              {isAdmin
                ? "Prepare sessions, support your team, and keep daily care moving smoothly."
                : "Review your assigned sessions and stay focused on the people in your care."}
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() =>
                loadDashboard(true)
              }
              disabled={refreshing}
              className="rj-button rj-button-secondary"
            >
              {refreshing ? (
                <LoaderCircle
                  size={19}
                  className="animate-spin"
                />
              ) : (
                <RefreshCw size={19} />
              )}

              Refresh
            </button>

            {isAdmin ? (
              <Link
                href="/sessions"
                className="rj-button rj-button-primary"
              >
                <CalendarDays size={20} />
                Create Session
              </Link>
            ) : (
              <Link
                href="/my-sessions"
                className="rj-button rj-button-primary"
              >
                <CalendarDays size={20} />
                View My Sessions
              </Link>
            )}
          </div>
        </div>
      </header>

      {pageError && (
        <div className="rounded-[var(--rj-radius-md)] border border-[var(--rj-danger)]/20 bg-[var(--rj-danger-soft)] p-4">
          <div className="flex gap-3">
            <CircleAlert
              size={22}
              className="shrink-0 text-[var(--rj-danger)]"
            />

            <div>
              <p className="font-bold text-[var(--rj-danger)]">
                We couldn’t load everything
              </p>

              <p className="mt-1 text-sm text-[var(--rj-text-secondary)]">
                {pageError}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Statistics */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <DashboardStatCard
          title="Today’s Sessions"
          value={todaySessions.length}
          description="Scheduled for today"
          icon={CalendarDays}
          tone="blue"
        />

        <DashboardStatCard
          title="Completed"
          value={completedToday}
          description="Finished today"
          icon={CheckCircle2}
          tone="mint"
        />

        <DashboardStatCard
          title="Active Clients"
          value={clients.length}
          description={
            isAdmin
              ? "Organization total"
              : "Currently assigned"
          }
          icon={UserRound}
          tone="lavender"
        />

        <DashboardStatCard
          title="Team Members"
          value={
            isAdmin
              ? teamMembers.length
              : 1
          }
          description={
            isAdmin
              ? "Active organization users"
              : "Your active account"
          }
          icon={Users}
          tone="teal"
        />
      </section>

      {isAdmin && (
        <section>
          <div className="mb-4 flex items-end justify-between gap-4">
            <div>
              <p className="rj-label">
                Administration
              </p>

              <h2 className="rj-heading-2 mt-1">
                Quick Actions
              </h2>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <QuickActionCard
              title="Create Session"
              description="Schedule and prepare targets for a team member."
              href="/sessions"
              icon={CalendarDays}
              tone="teal"
            />

            <QuickActionCard
              title="Manage Clients"
              description="Add client records, targets, and behavior definitions."
              href="/clients"
              icon={UserRound}
              tone="blue"
            />

            <QuickActionCard
              title="Manage Team"
              description="Invite users and update account access."
              href="/team-management"
              icon={Users}
              tone="lavender"
            />

            <QuickActionCard
              title="Operations"
              description="Configure organization workflows and resources."
              href="/operations"
              icon={Settings2}
              tone="mint"
            />
          </div>
        </section>
      )}

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.55fr)]">
        {/* Upcoming Sessions */}
        <div className="rj-card overflow-hidden">
          <div className="flex flex-col justify-between gap-4 border-b border-[var(--rj-border)] p-6 sm:flex-row sm:items-center">
            <div>
              <p className="rj-label">
                Schedule
              </p>

              <h2 className="rj-heading-2 mt-1">
                Upcoming Sessions
              </h2>
            </div>

            <Link
              href={
                isAdmin
                  ? "/sessions"
                  : "/my-sessions"
              }
              className="inline-flex items-center gap-2 font-bold text-[var(--rj-teal-700)]"
            >
              View all
              <ArrowRight size={18} />
            </Link>
          </div>

          {upcomingSessions.length === 0 ? (
            <div className="p-10 text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[var(--rj-blue-100)] text-[var(--rj-blue-700)]">
                <CalendarDays size={28} />
              </div>

              <h3 className="rj-heading-3 mt-4">
                No upcoming sessions
              </h3>

              <p className="rj-caption mx-auto mt-2 max-w-sm">
                {isAdmin
                  ? "Create a session to begin connecting your admin and frontline workspaces."
                  : "Assigned sessions will appear here when they are scheduled."}
              </p>

              {isAdmin && (
                <Link
                  href="/sessions"
                  className="rj-button rj-button-primary mt-6"
                >
                  <CalendarDays size={19} />
                  Create First Session
                </Link>
              )}
            </div>
          ) : (
            <div className="divide-y divide-[var(--rj-border)]">
              {upcomingSessions
                .slice(0, 6)
                .map((session) => (
                  <SessionListItem
                    key={session.id}
                    session={session}
                    isAdmin={isAdmin}
                  />
                ))}
            </div>
          )}
        </div>

        {/* Daily Overview */}
        <aside className="rj-card p-6">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--rj-lavender-100)] text-[var(--rj-lavender-700)]">
              <BarChart3 size={23} />
            </div>

            <div>
              <p className="rj-label">
                Daily Overview
              </p>

              <h2 className="rj-heading-3 mt-1">
                Today at a glance
              </h2>
            </div>
          </div>

          <div className="mt-6 space-y-5">
            <OverviewRow
              label="Scheduled"
              value={todaySessions.length}
              background="var(--rj-blue-100)"
            />

            <OverviewRow
              label="Completed"
              value={completedToday}
              background="var(--rj-mint-100)"
            />

            <OverviewRow
              label="Remaining"
              value={Math.max(
                0,
                todaySessions.length -
                  completedToday
              )}
              background="var(--rj-lavender-100)"
            />
          </div>

          <div className="mt-7 rounded-[var(--rj-radius-md)] bg-[var(--rj-surface-muted)] p-4">
            <div className="flex gap-3">
              <Clock3
                size={21}
                className="shrink-0 text-[var(--rj-sage-700)]"
              />

              <div>
                <p className="font-bold">
                  Keep documentation current
                </p>

                <p className="rj-caption mt-1">
                  Completing notes immediately after each
                  session helps keep records accurate.
                </p>
              </div>
            </div>
          </div>
        </aside>
      </section>
    </div>
  )
}

function DashboardLoadingState() {
  return (
    <div className="flex min-h-[65vh] items-center justify-center">
      <div className="text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[var(--rj-teal-100)]">
          <LoaderCircle
            size={30}
            className="animate-spin text-[var(--rj-teal-700)]"
          />
        </div>

        <p className="rj-body mt-4 text-[var(--rj-text-secondary)]">
          Preparing your workspace…
        </p>
      </div>
    </div>
  )
}

function DashboardStatCard({
  title,
  value,
  description,
  icon: Icon,
  tone,
}: {
  title: string
  value: number
  description: string
  icon: typeof CalendarDays
  tone: "blue" | "mint" | "lavender" | "teal"
}) {
  const tones = {
    blue: {
      background: "var(--rj-blue-100)",
      foreground: "var(--rj-blue-700)",
    },

    mint: {
      background: "var(--rj-mint-100)",
      foreground: "var(--rj-mint-700)",
    },

    lavender: {
      background: "var(--rj-lavender-100)",
      foreground: "var(--rj-lavender-700)",
    },

    teal: {
      background: "var(--rj-teal-100)",
      foreground: "var(--rj-teal-700)",
    },
  }

  const selectedTone = tones[tone]

  return (
    <article className="rj-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="rj-label">
            {title}
          </p>

          <p className="mt-2 text-3xl font-extrabold tracking-tight">
            {value}
          </p>

          <p className="rj-caption mt-1">
            {description}
          </p>
        </div>

        <div
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full"
          style={{
            background:
              selectedTone.background,
            color: selectedTone.foreground,
          }}
        >
          <Icon size={23} />
        </div>
      </div>
    </article>
  )
}

function QuickActionCard({
  title,
  description,
  href,
  icon: Icon,
  tone,
}: {
  title: string
  description: string
  href: string
  icon: typeof CalendarDays
  tone: "teal" | "blue" | "lavender" | "mint"
}) {
  const tones = {
    teal: {
      background: "var(--rj-teal-100)",
      foreground: "var(--rj-teal-700)",
    },

    blue: {
      background: "var(--rj-blue-100)",
      foreground: "var(--rj-blue-700)",
    },

    lavender: {
      background: "var(--rj-lavender-100)",
      foreground:
        "var(--rj-lavender-700)",
    },

    mint: {
      background: "var(--rj-mint-100)",
      foreground: "var(--rj-mint-700)",
    },
  }

  const selectedTone = tones[tone]

  return (
    <Link
      href={href}
      className="rj-card rj-card-interactive group p-5"
    >
      <div
        className="flex h-12 w-12 items-center justify-center rounded-full"
        style={{
          background:
            selectedTone.background,
          color: selectedTone.foreground,
        }}
      >
        <Icon size={23} />
      </div>

      <h3 className="rj-heading-3 mt-5">
        {title}
      </h3>

      <p className="rj-caption mt-2">
        {description}
      </p>

      <div
        className="mt-5 inline-flex items-center gap-2 font-bold"
        style={{
          color: selectedTone.foreground,
        }}
      >
        Open
        <ArrowRight
          size={17}
          className="transition-transform group-hover:translate-x-1"
        />
      </div>
    </Link>
  )
}

function SessionListItem({
  session,
  isAdmin,
}: {
  session: DashboardSession
  isAdmin: boolean
}) {
  return (
    <article className="p-5 transition-colors hover:bg-[var(--rj-surface-muted)]">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-bold">
              {session.clientName}
            </h3>

            <SessionStatusBadge
              status={session.status}
            />
          </div>

          <p className="rj-caption mt-2">
            {formatSessionTime(
              session.scheduled_start,
              session.scheduled_end
            )}
          </p>

          <p className="rj-caption mt-1">
            {isAdmin
              ? `Assigned to ${session.providerName}`
              : "Assigned to you"}
          </p>

          {session.location && (
            <p className="rj-caption mt-1">
              {session.location}
            </p>
          )}
        </div>

        <Link
          href={`/session/${session.id}`}
          className="rj-button rj-button-secondary shrink-0"
        >
          Open Session
          <ArrowRight size={17} />
        </Link>
      </div>
    </article>
  )
}

function SessionStatusBadge({
  status,
}: {
  status: string
}) {
  const completed = status === "completed"

  const active =
    status === "in_progress" ||
    status === "paused"

  const badgeClass = completed
    ? "rj-badge-success"
    : active
      ? "rj-badge-warning"
      : "rj-badge-info"

  return (
    <span className={`rj-badge ${badgeClass}`}>
      {formatLabel(status)}
    </span>
  )
}

function OverviewRow({
  label,
  value,
  background,
}: {
  label: string
  value: number
  background: string
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <span
          className="h-3 w-3 rounded-full"
          style={{ background }}
        />

        <span className="font-semibold">
          {label}
        </span>
      </div>

      <span className="text-xl font-extrabold">
        {value}
      </span>
    </div>
  )
}

function getClientName(
  client: ClientRecord
): string {
  return (
    client.preferred_name?.trim() ||
    client.first_name ||
    "Client"
  )
}

function formatLabel(value: string): string {
  return value
    .split("_")
    .map(
      (word) =>
        word.charAt(0).toUpperCase() +
        word.slice(1)
    )
    .join(" ")
}

function formatSessionTime(
  start: string | null,
  end: string | null
): string {
  if (!start) {
    return "Time not scheduled"
  }

  const startDate = new Date(start)
  const endDate = end
    ? new Date(end)
    : null

  const dateText =
    new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(startDate)

  const startText =
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
    }).format(startDate)

  const endText = endDate
    ? new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        minute: "2-digit",
      }).format(endDate)
    : null

  return endText
    ? `${dateText} · ${startText}–${endText}`
    : `${dateText} · ${startText}`
}