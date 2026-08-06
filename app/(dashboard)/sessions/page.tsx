"use client"

import { FormEvent, useCallback, useEffect, useState } from "react"
import Link from "next/link"
import {
  CalendarDays,
  CheckCircle2,
  Clock3,
  ExternalLink,
  LoaderCircle,
  MapPin,
  Plus,
  RefreshCw,
  UserRound,
  Users,
} from "lucide-react"

import { supabase } from "@/lib/supabase"

type ClientOption = {
  id: string
  first_name: string
  last_name: string | null
  preferred_name: string | null
  status: string
}

type ProviderOption = {
  id: string
  full_name: string | null
  email: string | null
  role: string
  status: string
}

type SessionRow = {
  id: string
  client_id: string
  provider_id: string | null
  status: string
  scheduled_start: string | null
  scheduled_end: string | null
  location: string | null
  prepared_at: string | null
  clients:
    | {
        first_name: string
        preferred_name: string | null
      }
    | null
  users:
    | {
        full_name: string | null
        email: string | null
      }
    | null
}

type CreateSessionResult = {
  session_id: string
  client_id: string
  provider_id: string
  scheduled_start: string
  scheduled_end: string
  status: string
  targets_added: number
}

const FRONTLINE_ROLES = [
  "therapist",
  "teacher",
  "educator",
  "assistant",
  "aide",
  "caregiver",
  "staff",
]

export default function AdminSessionsPage() {
  const [clients, setClients] = useState<ClientOption[]>([])
  const [providers, setProviders] = useState<ProviderOption[]>([])
  const [sessions, setSessions] = useState<SessionRow[]>([])

  const [clientId, setClientId] = useState("")
  const [providerId, setProviderId] = useState("")
  const [scheduledStart, setScheduledStart] = useState("")
  const [scheduledEnd, setScheduledEnd] = useState("")
  const [sessionType, setSessionType] =
    useState("direct_therapy")
  const [location, setLocation] = useState("")

  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [pageError, setPageError] = useState<string | null>(null)
  const [success, setSuccess] =
    useState<CreateSessionResult | null>(null)

  const fetchPageData = useCallback(async () => {
    setLoading(true)
    setPageError(null)

    try {
      const [clientResult, providerResult, sessionResult] =
        await Promise.all([
          supabase
            .from("clients")
            .select(`
              id,
              first_name,
              last_name,
              preferred_name,
              status
            `)
            .eq("status", "active")
            .order("preferred_name", {
              ascending: true,
              nullsFirst: false,
            })
            .order("first_name", { ascending: true }),

          supabase
            .from("users")
            .select(`
              id,
              full_name,
              email,
              role,
              status
            `)
            .eq("status", "active")
            .in("role", FRONTLINE_ROLES)
            .order("full_name", {
              ascending: true,
              nullsFirst: false,
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
              location,
              prepared_at,
              clients (
                first_name,
                preferred_name
              ),
              users!sessions_provider_id_fkey (
                full_name,
                email
              )
            `)
            .order("scheduled_start", { ascending: true })
            .limit(25),
        ])

      if (clientResult.error) {
        throw new Error(clientResult.error.message)
      }

      if (providerResult.error) {
        throw new Error(providerResult.error.message)
      }

      if (sessionResult.error) {
        throw new Error(sessionResult.error.message)
      }

      setClients(
        (clientResult.data || []) as ClientOption[]
      )

      setProviders(
        (providerResult.data || []) as ProviderOption[]
      )

      setSessions(
        (sessionResult.data || []) as unknown as SessionRow[]
      )
    } catch (error) {
      console.error("Load session management error:", error)

      setPageError(
        error instanceof Error
          ? error.message
          : "Unable to load session management."
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchPageData()
  }, [fetchPageData])

  const handleCreateSession = async (
    event: FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault()

    if (
      !clientId ||
      !providerId ||
      !scheduledStart ||
      !scheduledEnd
    ) {
      setPageError(
        "Choose a client, provider, start time, and end time."
      )
      return
    }

    const startDate = new Date(scheduledStart)
    const endDate = new Date(scheduledEnd)

    if (
      Number.isNaN(startDate.getTime()) ||
      Number.isNaN(endDate.getTime())
    ) {
      setPageError("Enter a valid session date and time.")
      return
    }

    if (endDate <= startDate) {
      setPageError(
        "The session end must be after its start."
      )
      return
    }

    setCreating(true)
    setPageError(null)
    setSuccess(null)

    try {
      const { data, error } = await supabase.rpc(
        "create_prepared_session",
        {
          requested_client_id: clientId,
          requested_provider_id: providerId,
          requested_scheduled_start:
            startDate.toISOString(),
          requested_scheduled_end:
            endDate.toISOString(),
          requested_session_type: sessionType,
          requested_location: location.trim() || null,
        }
      )

      if (error) {
        throw new Error(error.message)
      }

      const result = data as CreateSessionResult

      setSuccess(result)

      setClientId("")
      setProviderId("")
      setScheduledStart("")
      setScheduledEnd("")
      setLocation("")

      await fetchPageData()
    } catch (error) {
      console.error("Create session error:", error)

      setPageError(
        error instanceof Error
          ? error.message
          : "Unable to create the session."
      )
    } finally {
      setCreating(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center">
          <LoaderCircle
            size={34}
            className="mx-auto animate-spin text-[var(--rj-teal-700)]"
          />

          <p className="rj-body mt-4 text-[var(--rj-text-secondary)]">
            Loading sessions…
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="rj-card p-6 sm:p-8">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-center">
          <div>
            <p className="rj-label">
              Administration
            </p>

            <h1 className="rj-heading-1 mt-1">
              Session Management
            </h1>

            <p className="rj-body mt-2 max-w-2xl text-[var(--rj-text-secondary)]">
              Schedule a session, assign a frontline team
              member, and prepare the client’s active targets.
            </p>
          </div>

          <button
            type="button"
            onClick={fetchPageData}
            className="rj-button rj-button-secondary"
          >
            <RefreshCw size={19} />
            Refresh
          </button>
        </div>
      </header>

      {pageError && (
        <div className="rounded-[var(--rj-radius-md)] bg-[var(--rj-danger-soft)] p-4 text-[var(--rj-danger)]">
          <p className="font-bold">
            Something needs attention
          </p>

          <p className="mt-1 text-sm">
            {pageError}
          </p>
        </div>
      )}

      {success && (
        <section className="rounded-[var(--rj-radius-lg)] border border-[var(--rj-success)] bg-[var(--rj-success-soft)] p-5">
          <div className="flex gap-3">
            <CheckCircle2
              size={24}
              className="shrink-0 text-[var(--rj-mint-700)]"
            />

            <div className="min-w-0 flex-1">
              <h2 className="font-bold text-[var(--rj-mint-700)]">
                Session created successfully
              </h2>

              <p className="mt-1 text-sm text-[var(--rj-text-secondary)]">
                {success.targets_added} active target
                {success.targets_added === 1 ? "" : "s"} added
                to the prepared session.
              </p>

              <Link
                href={`/session/${success.session_id}`}
                className="mt-4 inline-flex items-center gap-2 font-bold text-[var(--rj-teal-700)]"
              >
                Open mobile session
                <ExternalLink size={17} />
              </Link>
            </div>
          </div>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_1fr]">
        <section className="rj-card p-6">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--rj-teal-100)] text-[var(--rj-teal-700)]">
              <Plus size={23} />
            </div>

            <div>
              <h2 className="rj-heading-2">
                Create session
              </h2>

              <p className="rj-caption mt-1">
                The client’s active targets are added automatically.
              </p>
            </div>
          </div>

          <form
            onSubmit={handleCreateSession}
            className="mt-6 space-y-5"
          >
            <label className="block">
              <span className="rj-label">
                Client
              </span>

              <select
                value={clientId}
                onChange={(event) =>
                  setClientId(event.target.value)
                }
                className="rj-input mt-2"
                required
              >
                <option value="">
                  Choose a client
                </option>

                {clients.map((client) => (
                  <option
                    key={client.id}
                    value={client.id}
                  >
                    {getClientName(client)}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="rj-label">
                Assigned educator/provider
              </span>

              <select
                value={providerId}
                onChange={(event) =>
                  setProviderId(event.target.value)
                }
                className="rj-input mt-2"
                required
              >
                <option value="">
                  Choose a team member
                </option>

                {providers.map((provider) => (
                  <option
                    key={provider.id}
                    value={provider.id}
                  >
                    {provider.full_name ||
                      provider.email ||
                      "Unnamed user"}{" "}
                    — {formatRole(provider.role)}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="rj-label">
                Session type
              </span>

              <select
                value={sessionType}
                onChange={(event) =>
                  setSessionType(event.target.value)
                }
                className="rj-input mt-2"
              >
                <option value="direct_therapy">
                  Direct service
                </option>

                <option value="education_support">
                  Education support
                </option>

                <option value="classroom_support">
                  Classroom support
                </option>

                <option value="care_session">
                  Care session
                </option>

                <option value="assessment">
                  Assessment
                </option>
              </select>
            </label>

            <label className="block">
              <span className="rj-label">
                Start
              </span>

              <div className="relative mt-2">
                <CalendarDays
                  size={19}
                  className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--rj-text-muted)]"
                />

                <input
                  type="datetime-local"
                  value={scheduledStart}
                  onChange={(event) =>
                    setScheduledStart(event.target.value)
                  }
                  className="rj-input pl-12"
                  required
                />
              </div>
            </label>

            <label className="block">
              <span className="rj-label">
                End
              </span>

              <div className="relative mt-2">
                <Clock3
                  size={19}
                  className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--rj-text-muted)]"
                />

                <input
                  type="datetime-local"
                  value={scheduledEnd}
                  onChange={(event) =>
                    setScheduledEnd(event.target.value)
                  }
                  className="rj-input pl-12"
                  required
                />
              </div>
            </label>

            <label className="block">
              <span className="rj-label">
                Location
              </span>

              <div className="relative mt-2">
                <MapPin
                  size={19}
                  className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--rj-text-muted)]"
                />

                <input
                  type="text"
                  value={location}
                  onChange={(event) =>
                    setLocation(event.target.value)
                  }
                  placeholder="Room, classroom, clinic…"
                  className="rj-input pl-12"
                />
              </div>
            </label>

            <button
              type="submit"
              disabled={
                creating ||
                clients.length === 0 ||
                providers.length === 0
              }
              className="rj-button rj-button-primary w-full"
            >
              {creating ? (
                <LoaderCircle
                  size={20}
                  className="animate-spin"
                />
              ) : (
                <CalendarDays size={20} />
              )}

              {creating
                ? "Creating session…"
                : "Create and prepare session"}
            </button>
          </form>

          {clients.length === 0 && (
            <p className="rj-caption mt-4">
              Create an active client before scheduling a session.
            </p>
          )}

          {providers.length === 0 && (
            <p className="rj-caption mt-4">
              Add an active frontline team member before
              scheduling a session.
            </p>
          )}
        </section>

        <section className="rj-card overflow-hidden">
          <div className="border-b border-[var(--rj-border)] p-6">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--rj-blue-100)] text-[var(--rj-blue-700)]">
                <Users size={23} />
              </div>

              <div>
                <h2 className="rj-heading-2">
                  Upcoming sessions
                </h2>

                <p className="rj-caption mt-1">
                  Showing the next 25 organization sessions.
                </p>
              </div>
            </div>
          </div>

          {sessions.length === 0 ? (
            <div className="p-10 text-center">
              <CalendarDays
                size={34}
                className="mx-auto text-[var(--rj-text-muted)]"
              />

              <p className="mt-4 font-bold">
                No sessions scheduled
              </p>

              <p className="rj-caption mt-1">
                Your first prepared session will appear here.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[var(--rj-border)]">
              {sessions.map((session) => (
                <article
                  key={session.id}
                  className="p-5"
                >
                  <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <UserRound
                          size={18}
                          className="text-[var(--rj-teal-700)]"
                        />

                        <h3 className="truncate font-bold">
                          {session.clients?.preferred_name ||
                            session.clients?.first_name ||
                            "Client"}
                        </h3>

                        <span className="rj-badge rj-badge-info">
                          {formatStatus(session.status)}
                        </span>
                      </div>

                      <p className="rj-caption mt-2">
                        {formatDateRange(
                          session.scheduled_start,
                          session.scheduled_end
                        )}
                      </p>

                      <p className="rj-caption mt-1">
                        Assigned to{" "}
                        {session.users?.full_name ||
                          session.users?.email ||
                          "Unassigned"}
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
                      Open
                      <ExternalLink size={17} />
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function getClientName(client: ClientOption): string {
  if (client.preferred_name?.trim()) {
    return client.preferred_name
  }

  return [client.first_name, client.last_name]
    .filter(Boolean)
    .join(" ")
}

function formatRole(role: string): string {
  return role
    .split("_")
    .map(
      (word) =>
        word.charAt(0).toUpperCase() +
        word.slice(1)
    )
    .join(" ")
}

function formatStatus(status: string): string {
  return status
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

  const date = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(startDate)

  const startTime = new Intl.DateTimeFormat("en-US", {
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
    ? `${date} · ${startTime}–${endTime}`
    : `${date} · ${startTime}`
}