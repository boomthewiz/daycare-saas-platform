"use client"

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react"
import Link from "next/link"
import {
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  ExternalLink,
  Filter,
  ListChecks,
  LoaderCircle,
  MapPin,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Users,
} from "lucide-react"

import { supabase } from "@/lib/supabase"
import {
  useRouter,
  useSearchParams,
} from "next/navigation"

type ClientOption = {
  id: string
  first_name: string
  last_name: string | null
  preferred_name: string | null
  status: string
  assigned_provider_id: string | null
}

type ProviderOption = {
  id: string
  full_name: string | null
  email: string | null
  role: string
  status: string
}

type SessionTypeOption = {
  id: string
  organization_id: string
  name: string
  code: string
  description: string | null
  default_duration_minutes: number | null
  active: boolean
  sort_order: number
}

type LocationOption = {
  id: string
  organization_id: string
  name: string
  description: string | null
  active: boolean
  sort_order: number
}

type SessionClientJoin = {
  first_name: string
  preferred_name: string | null
}

type SessionProviderJoin = {
  full_name: string | null
  email: string | null
}

type SessionTargetJoin = {
  id: string
}

type SessionRow = {
  id: string
  client_id: string
  provider_id: string | null
  session_type: string
  status: string
  attendance_status: string
  scheduled_start: string | null
  scheduled_end: string | null
  location: string | null
  prepared_at: string | null
  created_at: string
  clients: SessionClientJoin | null
  provider: SessionProviderJoin | null
  session_targets: SessionTargetJoin[]
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
  const router = useRouter()
const searchParams = useSearchParams()

const requestedClientId =
  searchParams.get("client")
  
    const [clients, setClients] =
    useState<ClientOption[]>([])

  const [providers, setProviders] =
    useState<ProviderOption[]>([])

  const [sessionTypes, setSessionTypes] =
    useState<SessionTypeOption[]>([])

  const [locationOptions, setLocationOptions] =
    useState<LocationOption[]>([])

  const [sessions, setSessions] =
    useState<SessionRow[]>([])

  const [clientId, setClientId] = useState("")
  const [providerId, setProviderId] = useState("")
  const [sessionType, setSessionType] = useState("")
  const [scheduledStart, setScheduledStart] = useState("")
  const [scheduledEnd, setScheduledEnd] = useState("")

  const [selectedLocation, setSelectedLocation] =
    useState("")

  const [customLocation, setCustomLocation] =
    useState("")

  const [searchTerm, setSearchTerm] = useState("")
  const [statusFilter, setStatusFilter] =
    useState("all")

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [creating, setCreating] = useState(false)

  const [pageError, setPageError] =
    useState<string | null>(null)

  const [success, setSuccess] =
    useState<CreateSessionResult | null>(null)

  const fetchPageData = useCallback(
    async (showRefreshState = false) => {
      if (showRefreshState) {
        setRefreshing(true)
      } else {
        setLoading(true)
      }

      setPageError(null)

      try {
        const [
          clientResult,
          providerResult,
          sessionTypeResult,
          locationResult,
          sessionResult,
        ] = await Promise.all([
          supabase
  .from("clients")
  .select(`
    id,
    first_name,
    last_name,
    preferred_name,
    status,
    assigned_provider_id
  `)
            .eq("status", "active")
            .order("preferred_name", {
              ascending: true,
              nullsFirst: false,
            })
            .order("first_name", {
              ascending: true,
            }),

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
            .from("session_types")
            .select(`
              id,
              organization_id,
              name,
              code,
              description,
              default_duration_minutes,
              active,
              sort_order
            `)
            .eq("active", true)
            .order("sort_order", {
              ascending: true,
            })
            .order("name", {
              ascending: true,
            }),

          supabase
            .from("organization_locations")
            .select(`
              id,
              organization_id,
              name,
              description,
              active,
              sort_order
            `)
            .eq("active", true)
            .order("sort_order", {
              ascending: true,
            })
            .order("name", {
              ascending: true,
            }),

          supabase
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
              location,
              prepared_at,
              created_at,
              clients (
                first_name,
                preferred_name
              ),
              provider:users!sessions_provider_id_fkey (
                full_name,
                email
              ),
              session_targets (
                id
              )
            `)
            .order("scheduled_start", {
              ascending: true,
            })
            .limit(100),
        ])

        if (clientResult.error) {
          throw new Error(
            clientResult.error.message
          )
        }

        if (providerResult.error) {
          throw new Error(
            providerResult.error.message
          )
        }

        if (sessionTypeResult.error) {
          throw new Error(
            sessionTypeResult.error.message
          )
        }

        if (locationResult.error) {
          throw new Error(
            locationResult.error.message
          )
        }

        if (sessionResult.error) {
          throw new Error(
            sessionResult.error.message
          )
        }

        const loadedClients =
          (clientResult.data ||
            []) as ClientOption[]

        const loadedProviders =
          (providerResult.data ||
            []) as ProviderOption[]

        const loadedSessionTypes =
          (sessionTypeResult.data ||
            []) as SessionTypeOption[]

        const loadedLocations =
          (locationResult.data ||
            []) as LocationOption[]

        const loadedSessions =
          (sessionResult.data ||
            []) as unknown as SessionRow[]

        setClients(loadedClients)
        setProviders(loadedProviders)
        setSessionTypes(loadedSessionTypes)
        setLocationOptions(loadedLocations)
        setSessions(loadedSessions)

        if (requestedClientId) {
  const requestedClient =
    loadedClients.find(
      (client) =>
        client.id === requestedClientId
    )

  if (requestedClient) {
    setClientId(requestedClient.id)

    if (
      requestedClient.assigned_provider_id &&
      loadedProviders.some(
        (provider) =>
          provider.id ===
          requestedClient.assigned_provider_id
      )
    ) {
      setProviderId(
        requestedClient.assigned_provider_id
      )
    }
  }
}

        setSessionType((currentValue) => {
          if (
            currentValue &&
            loadedSessionTypes.some(
              (item) =>
                item.code === currentValue
            )
          ) {
            return currentValue
          }

          return (
            loadedSessionTypes[0]?.code || ""
          )
        })
      } catch (error) {
        console.error(
          "Load session management error:",
          error
        )

        setPageError(
          error instanceof Error
            ? error.message
            : "Unable to load session management."
        )
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    []
  )

  useEffect(() => {
    fetchPageData()
  }, [requestedClientId])

  const sessionTypeNameMap = useMemo(
    () =>
      new Map(
        sessionTypes.map((item) => [
          item.code,
          item.name,
        ])
      ),
    [sessionTypes]
  )

  const filteredSessions = useMemo(() => {
    const normalizedSearch =
      searchTerm.trim().toLowerCase()

    return sessions.filter((session) => {
      const clientName =
        session.clients?.preferred_name ||
        session.clients?.first_name ||
        ""

      const providerName =
        session.provider?.full_name ||
        session.provider?.email ||
        ""

      const sessionTypeName =
        sessionTypeNameMap.get(
          session.session_type
        ) || session.session_type

      const searchableText = [
        clientName,
        providerName,
        session.location,
        sessionTypeName,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()

      const matchesSearch =
        !normalizedSearch ||
        searchableText.includes(
          normalizedSearch
        )

      const matchesStatus =
        statusFilter === "all" ||
        session.status === statusFilter

      return matchesSearch && matchesStatus
    })
  }, [
    searchTerm,
    sessionTypeNameMap,
    sessions,
    statusFilter,
  ])

  const upcomingCount = sessions.filter(
    (session) =>
      ["scheduled", "confirmed"].includes(
        session.status
      )
  ).length

  const activeCount = sessions.filter(
    (session) =>
      ["in_progress", "paused"].includes(
        session.status
      )
  ).length

  const completedCount = sessions.filter(
    (session) =>
      session.status === "completed"
  ).length

  const selectedSessionType =
    sessionTypes.find(
      (item) => item.code === sessionType
    )

    const selectedClient =
  clients.find(
    (client) => client.id === clientId
  ) || null

  const applyDefaultEndTime = (
    startValue: string,
    selectedTypeCode: string
  ) => {
    if (!startValue || !selectedTypeCode) {
      return
    }

    const selectedType =
      sessionTypes.find(
        (item) =>
          item.code === selectedTypeCode
      )

    const duration =
      selectedType?.default_duration_minutes

    if (!duration) {
      return
    }

    const startDate = new Date(startValue)

    if (Number.isNaN(startDate.getTime())) {
      return
    }

    const endDate = new Date(
      startDate.getTime() +
        duration * 60 * 1000
    )

    setScheduledEnd(
      toDateTimeLocalInput(endDate)
    )
  }

  const handleCreateSession = async (
    event: FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault()

    if (
      !clientId ||
      !providerId ||
      !sessionType ||
      !scheduledStart ||
      !scheduledEnd
    ) {
      setPageError(
        "Choose a client, assigned team member, session type, start time, and end time."
      )
      return
    }

    if (
      selectedLocation === "custom" &&
      !customLocation.trim()
    ) {
      setPageError(
        "Enter a custom location or choose a saved location."
      )
      return
    }

    const startDate = new Date(scheduledStart)
    const endDate = new Date(scheduledEnd)

    if (
      Number.isNaN(startDate.getTime()) ||
      Number.isNaN(endDate.getTime())
    ) {
      setPageError(
        "Enter a valid session date and time."
      )
      return
    }

    if (endDate <= startDate) {
      setPageError(
        "The session end must be after its start."
      )
      return
    }

    const finalLocation =
      selectedLocation === "custom"
        ? customLocation.trim()
        : selectedLocation

    setCreating(true)
    setPageError(null)
    setSuccess(null)

    try {
      const { data, error } =
        await supabase.rpc(
          "create_prepared_session",
          {
            requested_client_id: clientId,

            requested_provider_id:
              providerId,

            requested_scheduled_start:
              startDate.toISOString(),

            requested_scheduled_end:
              endDate.toISOString(),

            requested_session_type:
              sessionType,

            requested_location:
              finalLocation || null,
          }
        )

      if (error) {
        throw new Error(error.message)
      }

      const result =
        data as CreateSessionResult

      setSuccess(result)

      if (requestedClientId) {
  setClientId(requestedClientId)

  const requestedClient =
    clients.find(
      (client) =>
        client.id === requestedClientId
    )

  setProviderId(
    requestedClient?.assigned_provider_id || ""
  )
} else {
  setClientId("")
  setProviderId("")
}
      setScheduledStart("")
      setScheduledEnd("")
      setSelectedLocation("")
      setCustomLocation("")

      setSessionType(
        sessionTypes[0]?.code || ""
      )

      await fetchPageData()
    } catch (error) {
      console.error(
        "Create session error:",
        error
      )

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
      <div className="flex min-h-[65vh] items-center justify-center">
        <div className="text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[var(--rj-teal-100)]">
            <LoaderCircle
              size={30}
              className="animate-spin text-[var(--rj-teal-700)]"
            />
          </div>

          <p className="rj-body mt-4 text-[var(--rj-text-secondary)]">
            Loading session management…
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Page Header */}
      <header className="relative overflow-hidden rounded-[var(--rj-radius-xl)] border border-[var(--rj-border)] bg-[var(--rj-surface)] p-6 shadow-[var(--rj-shadow-soft)] sm:p-8">
        <div className="pointer-events-none absolute -right-12 -top-20 h-52 w-52 rounded-full bg-[var(--rj-blue-100)] opacity-65" />

        <div className="pointer-events-none absolute -bottom-28 right-36 h-52 w-52 rounded-full bg-[var(--rj-lavender-100)] opacity-55" />

        <div className="relative flex flex-col justify-between gap-6 lg:flex-row lg:items-center">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full bg-[var(--rj-teal-50)] px-3 py-1.5 text-sm font-bold text-[var(--rj-teal-700)]">
              <Sparkles size={16} />
              Admin Workspace
            </div>

            <h1 className="rj-heading-1 mt-4">
              Sessions
            </h1>

            <p className="rj-body mt-3 text-[var(--rj-text-secondary)]">
              Schedule services using the session
              types, durations, and locations
              configured in Operations.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Link
              href="/operations"
              className="rj-button rj-button-secondary"
            >
              Configure Options
            </Link>

            <button
              type="button"
              onClick={() =>
                fetchPageData(true)
              }
              disabled={refreshing}
              className="rj-button rj-button-primary"
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
          </div>
        </div>
      </header>

      {pageError && (
        <MessageBanner
          success={false}
          title="Something needs attention"
          message={pageError}
        />
      )}

      {success && (
        <section className="rounded-[var(--rj-radius-lg)] border border-[var(--rj-success)]/40 bg-[var(--rj-success-soft)] p-5">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div className="flex gap-3">
              <CheckCircle2
                size={25}
                className="shrink-0 text-[var(--rj-mint-700)]"
              />

              <div>
                <h2 className="font-bold text-[var(--rj-mint-700)]">
                  Session created successfully
                </h2>

                <p className="mt-1 text-sm text-[var(--rj-text-secondary)]">
                  {success.targets_added} active target
                  {success.targets_added === 1
                    ? ""
                    : "s"}{" "}
                  were prepared automatically.
                </p>
              </div>
            </div>

            <Link
              href={`/sessions/${success.session_id}`}
              className="rj-button rj-button-primary"
            >
              Manage Session
              <ExternalLink size={17} />
            </Link>
          </div>
        </section>
      )}

      {/* Summary */}
      <section className="grid gap-4 sm:grid-cols-3">
        <SessionSummaryCard
          label="Upcoming"
          value={upcomingCount}
          description="Scheduled or confirmed"
          icon={CalendarDays}
          background="var(--rj-blue-100)"
          foreground="var(--rj-blue-700)"
        />

        <SessionSummaryCard
          label="Active"
          value={activeCount}
          description="In progress or paused"
          icon={Clock3}
          background="var(--rj-lavender-100)"
          foreground="var(--rj-lavender-700)"
        />

        <SessionSummaryCard
          label="Completed"
          value={completedCount}
          description="Finished sessions"
          icon={CheckCircle2}
          background="var(--rj-mint-100)"
          foreground="var(--rj-mint-700)"
        />
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(340px,430px)_minmax(0,1fr)]">
        {/* Create Session */}
        <section className="rj-card h-fit p-6 xl:sticky xl:top-6">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--rj-teal-100)] text-[var(--rj-teal-700)]">
              <Plus size={23} />
            </div>

            <div>
              <p className="rj-label">
                New Session
              </p>

              <h2 className="rj-heading-2 mt-1">
                Create and prepare
              </h2>
            </div>
          </div>

          <p className="rj-caption mt-3">
            Active client targets are copied into
            the session automatically.
          </p>
{requestedClientId && selectedClient && (
  <div className="mt-4 rounded-[var(--rj-radius-md)] bg-[var(--rj-blue-50)] p-4">
    <div className="flex gap-3">
      <CheckCircle2
        size={20}
        className="shrink-0 text-[var(--rj-blue-700)]"
      />

      <div>
        <p className="text-sm font-bold text-[var(--rj-blue-700)]">
          Creating a session for{" "}
          {getClientName(selectedClient)}
        </p>

        <p className="rj-caption mt-1">
          The client and primary worker were selected
          from the client profile.
        </p>
      </div>
    </div>
  </div>
)}
          <form
            onSubmit={handleCreateSession}
            className="mt-6 space-y-5"
          >
            <FormField label="Client">
              <select
                value={clientId}
                onChange={(event) => {
  const nextClientId =
    event.target.value

  setClientId(nextClientId)

  const nextClient =
    clients.find(
      (client) =>
        client.id === nextClientId
    )

  if (
    nextClient?.assigned_provider_id &&
    providers.some(
      (provider) =>
        provider.id ===
        nextClient.assigned_provider_id
    )
  ) {
    setProviderId(
      nextClient.assigned_provider_id
    )
  }
}}
                className="rj-input"
                required
              >
                <option value="">
                  Select a client
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
            </FormField>

            <FormField label="Assigned frontline worker">
              <select
                value={providerId}
                onChange={(event) =>
                  setProviderId(
                    event.target.value
                  )
                }
                className="rj-input"
                required
              >
                <option value="">
                  Select a team member
                </option>

                {providers.map((provider) => (
                  <option
                    key={provider.id}
                    value={provider.id}
                  >
                    {provider.full_name ||
                      provider.email ||
                      "Unnamed user"}{" "}
                    — {formatLabel(
                      provider.role
                    )}
                  </option>
                ))}
              </select>
            </FormField>

            <FormField label="Session type">
              <select
                value={sessionType}
                onChange={(event) => {
                  const nextType =
                    event.target.value

                  setSessionType(nextType)

                  if (scheduledStart) {
                    applyDefaultEndTime(
                      scheduledStart,
                      nextType
                    )
                  }
                }}
                className="rj-input"
                required
              >
                <option value="">
                  Select a session type
                </option>

                {sessionTypes.map((type) => (
                  <option
                    key={type.id}
                    value={type.code}
                  >
                    {type.name}
                    {type.default_duration_minutes
                      ? ` · ${type.default_duration_minutes} min`
                      : ""}
                  </option>
                ))}
              </select>

              <SessionTypeDescription
                sessionType={
                  selectedSessionType
                }
              />
            </FormField>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
              <FormField label="Start">
                <div className="relative">
                  <CalendarDays
                    size={19}
                    className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--rj-text-muted)]"
                  />

                  <input
                    type="datetime-local"
                    value={scheduledStart}
                    onChange={(event) => {
                      const nextStart =
                        event.target.value

                      setScheduledStart(
                        nextStart
                      )

                      applyDefaultEndTime(
                        nextStart,
                        sessionType
                      )
                    }}
                    className="rj-input pl-12"
                    required
                  />
                </div>
              </FormField>

              <FormField label="End">
                <div className="relative">
                  <Clock3
                    size={19}
                    className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--rj-text-muted)]"
                  />

                  <input
                    type="datetime-local"
                    value={scheduledEnd}
                    onChange={(event) =>
                      setScheduledEnd(
                        event.target.value
                      )
                    }
                    className="rj-input pl-12"
                    required
                  />
                </div>
              </FormField>
            </div>

            <FormField label="Location">
              <div className="relative">
                <MapPin
                  size={19}
                  className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--rj-text-muted)]"
                />

                <select
                  value={selectedLocation}
                  onChange={(event) => {
                    const nextLocation =
                      event.target.value

                    setSelectedLocation(
                      nextLocation
                    )

                    if (
                      nextLocation !== "custom"
                    ) {
                      setCustomLocation("")
                    }
                  }}
                  className="rj-input pl-12"
                >
                  <option value="">
                    No location selected
                  </option>

                  {locationOptions.map(
                    (location) => (
                      <option
                        key={location.id}
                        value={location.name}
                      >
                        {location.name}
                      </option>
                    )
                  )}

                  <option value="custom">
                    Other / custom location
                  </option>
                </select>
              </div>

              {selectedLocation ===
                "custom" && (
                <input
                  type="text"
                  value={customLocation}
                  onChange={(event) =>
                    setCustomLocation(
                      event.target.value
                    )
                  }
                  placeholder="Enter a custom location"
                  className="rj-input mt-3"
                />
              )}
            </FormField>

            <button
              type="submit"
              disabled={
                creating ||
                clients.length === 0 ||
                providers.length === 0 ||
                sessionTypes.length === 0
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
                ? "Preparing session…"
                : "Create Session"}
            </button>
          </form>

          {clients.length === 0 && (
            <EmptyRequirement
              text="Create an active client before scheduling a session."
              href="/team-management"
              linkText="Manage People"
            />
          )}

          {providers.length === 0 && (
            <EmptyRequirement
              text="Create or invite an active frontline worker before scheduling."
              href="/team-management"
              linkText="Manage Team"
            />
          )}

          {sessionTypes.length === 0 && (
            <EmptyRequirement
              text="Create an active session type in Operations before scheduling."
              href="/operations"
              linkText="Open Operations"
            />
          )}
        </section>

        {/* Session List */}
        <section className="rj-card overflow-hidden">
          <div className="border-b border-[var(--rj-border)] p-6">
            <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
              <div>
                <p className="rj-label">
                  Organization Schedule
                </p>

                <h2 className="rj-heading-2 mt-1">
                  Scheduled Sessions
                </h2>

                <p className="rj-caption mt-2">
                  {filteredSessions.length} session
                  {filteredSessions.length === 1
                    ? ""
                    : "s"}{" "}
                  shown
                </p>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <div className="relative">
                  <Search
                    size={18}
                    className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--rj-text-muted)]"
                  />

                  <input
                    type="search"
                    value={searchTerm}
                    onChange={(event) =>
                      setSearchTerm(
                        event.target.value
                      )
                    }
                    placeholder="Search sessions…"
                    className="rj-input min-w-[220px] pl-11"
                  />
                </div>

                <div className="relative">
                  <Filter
                    size={18}
                    className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--rj-text-muted)]"
                  />

                  <select
                    value={statusFilter}
                    onChange={(event) =>
                      setStatusFilter(
                        event.target.value
                      )
                    }
                    className="rj-input min-w-[175px] pl-11"
                  >
                    <option value="all">
                      All statuses
                    </option>

                    <option value="scheduled">
                      Scheduled
                    </option>

                    <option value="confirmed">
                      Confirmed
                    </option>

                    <option value="in_progress">
                      In progress
                    </option>

                    <option value="paused">
                      Paused
                    </option>

                    <option value="completed">
                      Completed
                    </option>

                    <option value="canceled">
                      Canceled
                    </option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          {filteredSessions.length === 0 ? (
            <div className="p-12 text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[var(--rj-blue-100)] text-[var(--rj-blue-700)]">
                <CalendarDays size={28} />
              </div>

              <h3 className="rj-heading-3 mt-4">
                No matching sessions
              </h3>

              <p className="rj-caption mx-auto mt-2 max-w-sm">
                Create a session or adjust your
                search and filter options.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[var(--rj-border)]">
              {filteredSessions.map(
                (session) => (
                  <SessionRowCard
                    key={session.id}
                    session={session}
                    sessionTypeName={
                      sessionTypeNameMap.get(
                        session.session_type
                      ) ||
                      formatLabel(
                        session.session_type
                      )
                    }
                  />
                )
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function SessionSummaryCard({
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
    <article className="rj-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="rj-label">
            {label}
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
            background,
            color: foreground,
          }}
        >
          <Icon size={23} />
        </div>
      </div>
    </article>
  )
}

function SessionRowCard({
  session,
  sessionTypeName,
}: {
  session: SessionRow
  sessionTypeName: string
}) {
  const clientName =
    session.clients?.preferred_name ||
    session.clients?.first_name ||
    "Client"

  const providerName =
    session.provider?.full_name ||
    session.provider?.email ||
    "Unassigned"

  const targetCount =
    session.session_targets?.length || 0

  const isPrepared =
    Boolean(session.prepared_at) &&
    targetCount > 0

  return (
    <article className="p-5 transition-colors hover:bg-[var(--rj-surface-muted)] sm:p-6">
      <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-center">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-bold">
              {clientName}
            </h3>

            <StatusBadge
              status={session.status}
            />

            <span
              className={`rj-badge ${
                isPrepared
                  ? "rj-badge-success"
                  : "rj-badge-warning"
              }`}
            >
              {isPrepared
                ? "Prepared"
                : "Needs targets"}
            </span>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <SessionDetail
              icon={CalendarDays}
              label="Schedule"
              value={formatDateRange(
                session.scheduled_start,
                session.scheduled_end
              )}
            />

            <SessionDetail
              icon={Users}
              label="Assigned to"
              value={providerName}
            />

            <SessionDetail
              icon={ListChecks}
              label="Prepared targets"
              value={`${targetCount} target${
                targetCount === 1 ? "" : "s"
              }`}
            />

            <SessionDetail
              icon={MapPin}
              label="Location"
              value={
                session.location ||
                "Not specified"
              }
            />
          </div>

          <p className="rj-caption mt-4">
            {sessionTypeName}
            {" · "}
            Attendance:{" "}
            {formatLabel(
              session.attendance_status
            )}
          </p>
        </div>

        <div className="flex shrink-0 flex-col gap-3 sm:flex-row">
          <Link
            href={`/session/${session.id}`}
            className="rj-button rj-button-secondary"
          >
            Open Workspace
            <ExternalLink size={17} />
          </Link>

          <Link
            href={`/sessions/${session.id}`}
            className="rj-button rj-button-primary"
          >
            Manage
            <ChevronRight size={18} />
          </Link>
        </div>
      </div>
    </article>
  )
}

function SessionDetail({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof CalendarDays
  label: string
  value: string
}) {
  return (
    <div className="flex gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--rj-blue-50)] text-[var(--rj-blue-700)]">
        <Icon size={17} />
      </div>

      <div className="min-w-0">
        <p className="text-xs font-bold uppercase tracking-wide text-[var(--rj-text-muted)]">
          {label}
        </p>

        <p className="mt-1 truncate text-sm font-semibold text-[var(--rj-text-primary)]">
          {value}
        </p>
      </div>
    </div>
  )
}

function StatusBadge({
  status,
}: {
  status: string
}) {
  const className = (() => {
    if (status === "completed") {
      return "rj-badge-success"
    }

    if (
      status === "in_progress" ||
      status === "paused"
    ) {
      return "rj-badge-warning"
    }

    if (
      status === "canceled" ||
      status === "client_absent" ||
      status === "provider_absent" ||
      status === "no_show"
    ) {
      return "rj-badge-danger"
    }

    return "rj-badge-info"
  })()

  return (
    <span className={`rj-badge ${className}`}>
      {formatLabel(status)}
    </span>
  )
}

function FormField({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="rj-label">
        {label}
      </span>

      <div className="mt-2">
        {children}
      </div>
    </label>
  )
}

function SessionTypeDescription({
  sessionType,
}: {
  sessionType:
    | SessionTypeOption
    | undefined
}) {
  if (!sessionType?.description) {
    return null
  }

  return (
    <div className="mt-3 rounded-[var(--rj-radius-md)] bg-[var(--rj-blue-50)] p-3">
      <p className="text-sm text-[var(--rj-text-secondary)]">
        {sessionType.description}
      </p>
    </div>
  )
}

function EmptyRequirement({
  text,
  href,
  linkText,
}: {
  text: string
  href: string
  linkText: string
}) {
  return (
    <div className="mt-4 rounded-[var(--rj-radius-md)] bg-[var(--rj-warning-soft)] p-4">
      <p className="text-sm font-semibold text-[#926c22]">
        {text}
      </p>

      <Link
        href={href}
        className="mt-2 inline-flex text-sm font-bold text-[var(--rj-teal-700)]"
      >
        {linkText}
      </Link>
    </div>
  )
}

function MessageBanner({
  success,
  title,
  message,
}: {
  success: boolean
  title: string
  message: string
}) {
  return (
    <div
      className={`rounded-[var(--rj-radius-md)] p-4 ${
        success
          ? "bg-[var(--rj-success-soft)]"
          : "bg-[var(--rj-danger-soft)]"
      }`}
    >
      <div className="flex gap-3">
        {success ? (
          <CheckCircle2
            size={21}
            className="shrink-0 text-[var(--rj-mint-700)]"
          />
        ) : (
          <CircleAlert
            size={21}
            className="shrink-0 text-[var(--rj-danger)]"
          />
        )}

        <div>
          <p
            className={`font-bold ${
              success
                ? "text-[var(--rj-mint-700)]"
                : "text-[var(--rj-danger)]"
            }`}
          >
            {title}
          </p>

          <p className="mt-1 text-sm text-[var(--rj-text-secondary)]">
            {message}
          </p>
        </div>
      </div>
    </div>
  )
}

function getClientName(
  client: ClientOption
): string {
  if (client.preferred_name?.trim()) {
    return client.preferred_name
  }

  return [client.first_name, client.last_name]
    .filter(Boolean)
    .join(" ")
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
    return "Not scheduled"
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

function toDateTimeLocalInput(
  date: Date
): string {
  const offset =
    date.getTimezoneOffset() * 60_000

  return new Date(
    date.getTime() - offset
  )
    .toISOString()
    .slice(0, 16)
}