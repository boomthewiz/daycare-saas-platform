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
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  Clock3,
  ListChecks,
  LoaderCircle,
  MapPin,
  Play,
  RefreshCw,
  Sparkles,
  UserRound,
} from "lucide-react"

import { supabase } from "@/lib/supabase"

type SessionStatus =
  | "scheduled"
  | "confirmed"
  | "in_progress"
  | "paused"
  | "completed"
  | "canceled"
  | "client_absent"
  | "provider_absent"
  | "no_show"

type SessionClient = {
  first_name: string
  preferred_name: string | null
}

type SessionTarget = {
  id: string
  status: "pending" | "active" | "completed" | "skipped"
}

type AssignedSession = {
  id: string
  client_id: string
  provider_id: string | null
  session_type: string
  status: SessionStatus
  attendance_status: string
  scheduled_start: string | null
  scheduled_end: string | null
  started_at: string | null
  completed_at: string | null
  location: string | null
  prepared_at: string | null
  clients: SessionClient | null
  session_targets: SessionTarget[]
}

export default function MySessionsPage() {
  const [sessions, setSessions] =
    useState<AssignedSession[]>([])

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const [pageError, setPageError] =
    useState<string | null>(null)

  const loadSessions = useCallback(
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

        /*
         * RLS already limits frontline staff to sessions
         * assigned to their user ID.
         *
         * The provider_id filter makes the intent explicit
         * and avoids requesting unrelated rows.
         */
        const { data, error } = await supabase
          .from("sessions")
          .select(`
            id,
            client_id,
            provider_id,
            session_type,
            status,
            attendance_status,
            scheduled_start,
            scheduled_end,
            started_at,
            completed_at,
            location,
            prepared_at,
            clients (
              first_name,
              preferred_name
            ),
            session_targets (
              id,
              status
            )
          `)
          .eq("provider_id", user.id)
          .order("scheduled_start", {
            ascending: true,
          })

        if (error) {
          throw new Error(error.message)
        }

        setSessions(
          (data || []) as unknown as AssignedSession[]
        )
      } catch (error) {
        console.error(
          "Load assigned sessions error:",
          error
        )

        setPageError(
          error instanceof Error
            ? error.message
            : "Unable to load your sessions."
        )
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    []
  )

  useEffect(() => {
    loadSessions()
  }, [loadSessions])

  const now = new Date()

  const activeSession = useMemo(
    () =>
      sessions.find((session) =>
        ["in_progress", "paused"].includes(
          session.status
        )
      ) || null,
    [sessions]
  )

  const nextSession = useMemo(() => {
    if (activeSession) {
      return activeSession
    }

    return (
      sessions.find((session) => {
        if (
          !session.scheduled_start ||
          !["scheduled", "confirmed"].includes(
            session.status
          )
        ) {
          return false
        }

        return (
          new Date(session.scheduled_start).getTime() >=
          now.getTime() - 30 * 60 * 1000
        )
      }) || null
    )
  }, [activeSession, now, sessions])

  const todaySessions = useMemo(
    () =>
      sessions.filter((session) =>
        isSameLocalDay(
          session.scheduled_start,
          new Date()
        )
      ),
    [sessions]
  )

  const todayRemaining = useMemo(
    () =>
      todaySessions.filter(
        (session) =>
          ![
            "completed",
            "canceled",
            "client_absent",
            "provider_absent",
            "no_show",
          ].includes(session.status)
      ),
    [todaySessions]
  )

  const completedSessions = useMemo(
    () =>
      sessions
        .filter(
          (session) =>
            session.status === "completed"
        )
        .sort((a, b) => {
          const aTime = a.completed_at
            ? new Date(a.completed_at).getTime()
            : 0

          const bTime = b.completed_at
            ? new Date(b.completed_at).getTime()
            : 0

          return bTime - aTime
        }),
    [sessions]
  )

  const upcomingSessions = useMemo(
    () =>
      sessions.filter((session) => {
        if (!session.scheduled_start) return false

        if (
          !["scheduled", "confirmed"].includes(
            session.status
          )
        ) {
          return false
        }

        return (
          new Date(session.scheduled_start).getTime() >=
          now.getTime() - 30 * 60 * 1000
        )
      }),
    [now, sessions]
  )

  if (loading) {
    return <MySessionsLoading />
  }

  return (
    <main className="rj-page min-h-screen">
      <div className="rj-mobile-shell pb-[calc(var(--rj-bottom-nav-height)+var(--rj-space-8)+env(safe-area-inset-bottom))]">
        <div className="space-y-6 px-5 py-6">
          {/* Header */}
          <header className="relative overflow-hidden rounded-[var(--rj-radius-xl)] border border-[var(--rj-border)] bg-white p-6 shadow-[var(--rj-shadow-soft)]">
            <div className="pointer-events-none absolute -right-14 -top-16 h-44 w-44 rounded-full bg-[var(--rj-blue-100)] opacity-70" />

            <div className="pointer-events-none absolute -bottom-20 right-20 h-40 w-40 rounded-full bg-[var(--rj-lavender-100)] opacity-55" />

            <div className="relative">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <span className="inline-flex items-center gap-2 rounded-full bg-[var(--rj-teal-50)] px-3 py-1.5 text-sm font-bold text-[var(--rj-teal-700)]">
                    <Sparkles size={15} />
                    Care Workspace
                  </span>

                  <h1 className="rj-heading-1 mt-4">
                    My Sessions
                  </h1>

                  <p className="rj-body mt-2 text-[var(--rj-text-secondary)]">
                    See what is next and continue active
                    documentation.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => loadSessions(true)}
                  disabled={refreshing}
                  aria-label="Refresh sessions"
                  className="rj-icon-button shrink-0"
                >
                  {refreshing ? (
                    <LoaderCircle
                      size={20}
                      className="animate-spin"
                    />
                  ) : (
                    <RefreshCw size={20} />
                  )}
                </button>
              </div>
            </div>
          </header>

          {pageError && (
            <div className="rounded-[var(--rj-radius-md)] bg-[var(--rj-danger-soft)] p-4">
              <div className="flex gap-3">
                <CircleAlert
                  size={21}
                  className="shrink-0 text-[var(--rj-danger)]"
                />

                <div>
                  <p className="font-bold text-[var(--rj-danger)]">
                    Unable to load everything
                  </p>

                  <p className="rj-caption mt-1">
                    {pageError}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Daily count */}
          <section className="grid grid-cols-2 gap-4">
            <MobileStatCard
              label="Today"
              value={todaySessions.length}
              description="Scheduled sessions"
              icon={CalendarDays}
              background="var(--rj-blue-100)"
              foreground="var(--rj-blue-700)"
            />

            <MobileStatCard
              label="Remaining"
              value={todayRemaining.length}
              description="Still to complete"
              icon={Clock3}
              background="var(--rj-lavender-100)"
              foreground="var(--rj-lavender-700)"
            />
          </section>

          {/* Main next-session card */}
          <section>
            <div className="mb-3">
              <p className="rj-label">
                Your Next Step
              </p>

              <h2 className="rj-heading-2 mt-1">
                {activeSession
                  ? "Continue Session"
                  : "Next Session"}
              </h2>
            </div>

            {nextSession ? (
              <FeaturedSessionCard
                session={nextSession}
              />
            ) : (
              <div className="rj-card p-7 text-center">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[var(--rj-mint-100)] text-[var(--rj-mint-700)]">
                  <CheckCircle2 size={28} />
                </div>

                <h3 className="rj-heading-3 mt-4">
                  You are caught up
                </h3>

                <p className="rj-caption mx-auto mt-2 max-w-sm">
                  Your next assigned session will appear here
                  when it is scheduled.
                </p>
              </div>
            )}
          </section>

          {/* Today's remaining sessions */}
          <SessionSection
            title="Today’s Schedule"
            description="Your remaining assigned sessions"
            sessions={todayRemaining.filter(
              (session) =>
                session.id !== nextSession?.id
            )}
            emptyMessage="No other sessions remain today."
          />

          {/* Upcoming sessions */}
          <SessionSection
            title="Coming Up"
            description="Future assigned sessions"
            sessions={upcomingSessions.filter(
              (session) =>
                session.id !== nextSession?.id &&
                !isSameLocalDay(
                  session.scheduled_start,
                  new Date()
                )
            )}
            emptyMessage="No additional sessions are scheduled."
          />

          {/* Completed */}
          <SessionSection
            title="Recently Completed"
            description="Open a completed session to finish or review its note"
            sessions={completedSessions.slice(0, 5)}
            emptyMessage="Completed sessions will appear here."
            completed
          />
        </div>
      </div>
    </main>
  )
}

function FeaturedSessionCard({
  session,
}: {
  session: AssignedSession
}) {
  const targetCount =
    session.session_targets?.length || 0

  const prepared =
    Boolean(session.prepared_at) &&
    targetCount > 0

  const active = ["in_progress", "paused"].includes(
    session.status
  )

  return (
    <article className="relative overflow-hidden rounded-[var(--rj-radius-xl)] border border-[var(--rj-teal-100)] bg-white p-6 shadow-[var(--rj-shadow-medium)]">
      <div className="pointer-events-none absolute -right-12 -top-16 h-44 w-44 rounded-full bg-[var(--rj-teal-100)] opacity-65" />

      <div className="relative">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="rj-caption">
              {formatDateRange(
                session.scheduled_start,
                session.scheduled_end
              )}
            </p>

            <h3 className="rj-heading-1 mt-2">
              {getClientName(session.clients)}
            </h3>

            <p className="rj-body mt-2 text-[var(--rj-text-secondary)]">
              {formatLabel(session.session_type)}
            </p>
          </div>

          <SessionStatusBadge
            status={session.status}
          />
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3">
          <SessionInfoTile
            icon={ListChecks}
            label="Targets"
            value={`${targetCount} prepared`}
          />

          <SessionInfoTile
            icon={MapPin}
            label="Location"
            value={session.location || "Not specified"}
          />
        </div>

        {!prepared && (
          <div className="mt-4 rounded-[var(--rj-radius-md)] bg-[var(--rj-warning-soft)] p-4">
            <div className="flex gap-3">
              <CircleAlert
                size={20}
                className="shrink-0 text-[#926c22]"
              />

              <div>
                <p className="text-sm font-bold text-[#926c22]">
                  Targets are not ready
                </p>

                <p className="rj-caption mt-1">
                  Contact an administrator before beginning
                  this session.
                </p>
              </div>
            </div>
          </div>
        )}

        <Link
          href={
            session.status === "completed"
              ? `/session/${session.id}/complete`
              : `/session/${session.id}`
          }
          className={`rj-button mt-6 w-full ${
            prepared || active
              ? "rj-button-primary"
              : "rj-button-secondary pointer-events-none opacity-55"
          }`}
          aria-disabled={!prepared && !active}
        >
          {active ? (
            <Play size={20} />
          ) : (
            <ArrowRight size={20} />
          )}

          {active
            ? "Continue Session"
            : session.status === "completed"
              ? "Review Documentation"
              : "Prepare and Start"}
        </Link>
      </div>
    </article>
  )
}

function SessionSection({
  title,
  description,
  sessions,
  emptyMessage,
  completed = false,
}: {
  title: string
  description: string
  sessions: AssignedSession[]
  emptyMessage: string
  completed?: boolean
}) {
  return (
    <section>
      <div className="mb-3">
        <p className="rj-label">
          {description}
        </p>

        <h2 className="rj-heading-2 mt-1">
          {title}
        </h2>
      </div>

      {sessions.length === 0 ? (
        <div className="rj-card p-5 text-center">
          <p className="rj-caption">
            {emptyMessage}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {sessions.map((session) => (
            <CompactSessionCard
              key={session.id}
              session={session}
              completed={completed}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function CompactSessionCard({
  session,
  completed,
}: {
  session: AssignedSession
  completed: boolean
}) {
  const targetCount =
    session.session_targets?.length || 0

  const prepared =
    Boolean(session.prepared_at) &&
    targetCount > 0

  return (
    <Link
      href={
        completed
          ? `/session/${session.id}/complete`
          : `/session/${session.id}`
      }
      className="rj-card rj-card-interactive block p-5"
    >
      <div className="flex items-center gap-4">
        <div
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${
            completed
              ? "bg-[var(--rj-success-soft)] text-[var(--rj-mint-700)]"
              : "bg-[var(--rj-blue-100)] text-[var(--rj-blue-700)]"
          }`}
        >
          {completed ? (
            <CheckCircle2 size={23} />
          ) : (
            <CalendarDays size={23} />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <h3 className="truncate font-bold">
              {getClientName(session.clients)}
            </h3>

            <ArrowRight
              size={18}
              className="shrink-0 text-[var(--rj-text-muted)]"
            />
          </div>

          <p className="rj-caption mt-1">
            {formatDateRange(
              session.scheduled_start,
              session.scheduled_end
            )}
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <SessionStatusBadge
              status={session.status}
            />

            <span
              className={`rj-badge ${
                prepared
                  ? "rj-badge-success"
                  : "rj-badge-warning"
              }`}
            >
              {prepared
                ? `${targetCount} targets`
                : "Needs targets"}
            </span>
          </div>
        </div>
      </div>
    </Link>
  )
}

function MobileStatCard({
  label,
  value,
  description,
  icon: Icon,
  background,
  foreground,
}: {
  label: string
  value: number
  description: string
  icon: typeof CalendarDays
  background: string
  foreground: string
}) {
  return (
    <article className="rj-card p-4">
      <div
        className="flex h-10 w-10 items-center justify-center rounded-full"
        style={{
          background,
          color: foreground,
        }}
      >
        <Icon size={20} />
      </div>

      <p className="mt-4 text-2xl font-extrabold">
        {value}
      </p>

      <p className="mt-1 font-bold">
        {label}
      </p>

      <p className="rj-caption mt-1">
        {description}
      </p>
    </article>
  )
}

function SessionInfoTile({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof CalendarDays
  label: string
  value: string
}) {
  return (
    <div className="rounded-[var(--rj-radius-md)] bg-[var(--rj-surface-muted)] p-4">
      <Icon
        size={19}
        className="text-[var(--rj-teal-700)]"
      />

      <p className="mt-3 text-xs font-bold uppercase tracking-wide text-[var(--rj-text-muted)]">
        {label}
      </p>

      <p className="mt-1 truncate text-sm font-bold">
        {value}
      </p>
    </div>
  )
}

function SessionStatusBadge({
  status,
}: {
  status: SessionStatus
}) {
  let className = "rj-badge-info"

  if (status === "completed") {
    className = "rj-badge-success"
  } else if (
    status === "in_progress" ||
    status === "paused"
  ) {
    className = "rj-badge-warning"
  } else if (
    status === "canceled" ||
    status === "client_absent" ||
    status === "provider_absent" ||
    status === "no_show"
  ) {
    className = "rj-badge-danger"
  }

  return (
    <span className={`rj-badge ${className}`}>
      {formatLabel(status)}
    </span>
  )
}

function MySessionsLoading() {
  return (
    <main className="rj-page flex min-h-screen items-center justify-center">
      <div className="text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[var(--rj-teal-100)]">
          <LoaderCircle
            size={30}
            className="animate-spin text-[var(--rj-teal-700)]"
          />
        </div>

        <p className="rj-body mt-4 text-[var(--rj-text-secondary)]">
          Loading your sessions…
        </p>
      </div>
    </main>
  )
}

function getClientName(
  client: SessionClient | null
): string {
  return (
    client?.preferred_name?.trim() ||
    client?.first_name ||
    "Assigned client"
  )
}

function isSameLocalDay(
  dateValue: string | null,
  comparisonDate: Date
): boolean {
  if (!dateValue) return false

  const date = new Date(dateValue)

  return (
    date.getFullYear() ===
      comparisonDate.getFullYear() &&
    date.getMonth() ===
      comparisonDate.getMonth() &&
    date.getDate() ===
      comparisonDate.getDate()
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

function formatDateRange(
  start: string | null,
  end: string | null
): string {
  if (!start) {
    return "Time not scheduled"
  }

  const startDate = new Date(start)
  const endDate = end ? new Date(end) : null

  const dateText =
    new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(startDate)

  const startTime =
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
    }).format(startDate)

  const endTime = endDate
    ? new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        minute: "2-digit",
      }).format(endDate)
    : null

  return endTime
    ? `${dateText} · ${startTime}–${endTime}`
    : `${dateText} · ${startTime}`
}