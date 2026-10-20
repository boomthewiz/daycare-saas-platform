"use client"

import { usePortal } from "@/components/PortalProvider"

import SessionChoiceManager from "@/components/SessionChoiceManager"
import { useEffectiveCapabilities } from "@/components/EffectiveCapabilitiesProvider"
import { recoveryKey, validOperation } from "@/lib/session-save-recovery"
import PageGuide from "@/components/PageGuide"
import SearchableChoice from "@/components/SearchableChoice"
import SessionContextChoices, { useSessionContext } from "@/components/SessionContextChoices"
import SessionPeopleWarning from "@/components/SessionPeopleWarning"
import SubscriptionWriteControls, { useOrganizationWriteAccess } from "@/components/SubscriptionWriteControls"

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
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
  ListChecks,
  LoaderCircle,
  MapPin,
  Plus,
  RefreshCw,
  Sparkles,
  Users,
} from "lucide-react"

import { supabase } from "@/lib/supabase"
import { parseCalendarDraft, localDateTime } from "@/lib/calendar"
import {
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
  workflow_intent: "activity" | "clinical"
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
  workflow_intent?: "activity" | "clinical"
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
  const { t } = usePortal()
  const {data:caps}=useEffectiveCapabilities()
  const { allowed: canWrite } = useOrganizationWriteAccess()
  const [peopleReadiness, setPeopleReadiness] = useState<{ missing_clients: boolean; missing_staff: boolean } | null>(null)

const searchParams = useSearchParams()

const requestedClientId =
  searchParams.get("client")
const requestedStart = parseCalendarDraft(searchParams.get("start"))
  
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
  const [intent, setIntent] = useState<"activity" | "clinical">("activity")
  const [sessionType, setSessionType] = useState("")
  const [scheduledStart, setScheduledStart] = useState(requestedStart)
  const [scheduledEnd, setScheduledEnd] = useState("")
  const [canSchedule, setCanSchedule] = useState(false)
  const [permissionError, setPermissionError] = useState("")
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const contextChoices = useSessionContext(canSchedule,undefined,selectedTags)
  const [newTypeDuration,setNewTypeDuration] = useState("60")
  const sessionOperation = useRef<{key:string;id:string}|null>(null)
  const appliedDraft = useRef<string | null>(null)
  const [recoveryAttempt,setRecoveryAttempt]=useState<string|null>(null)
  const [recoveryReady,setRecoveryReady]=useState(false)
  const [recoveryError,setRecoveryError]=useState("")
  const [recoveredSession,setRecoveredSession]=useState("")
  const saveScope=caps?.sessions?`${caps.organizationId}:${caps.userId}`:""
  const scopeRef=useRef(saveScope)
  useEffect(()=>{
    scopeRef.current=saveScope;sessionOperation.current=null;setRecoveryAttempt(null);setRecoveryReady(false);setRecoveryError("");setRecoveredSession("")
    if(!caps?.sessions)return
    const key=recoveryKey(caps.organizationId,caps.userId)
    const read=()=>{try{const value=localStorage.getItem(key);if(value&&!validOperation(value))throw new Error("Invalid save-recovery marker. Contact an administrator before creating another session.");setRecoveryAttempt(value);setRecoveryReady(true)}catch{setRecoveryError("Browser save recovery is unavailable. Enable local storage before saving a session.")}}
    read();window.addEventListener("storage",read)
    return()=>{scopeRef.current="";window.removeEventListener("storage",read)}
  },[saveScope,caps?.organizationId,caps?.userId,caps?.sessions])
  const recoverAttempt=async(cancel=false)=>{
    if(!caps||!recoveryAttempt)return
    const scope=saveScope;setCreating(true);setRecoveryError("")
    try{
      const result=await supabase.rpc("recover_session_creation",{p_operation:recoveryAttempt,p_cancel:cancel})
      if(scopeRef.current!==scope)return
      if(result.error)throw new Error(result.error.message)
      if(result.data.state==="unconfirmed"){setRecoveryError("No committed receipt yet. Check again, retry unchanged details in this tab, or cancel this attempt before creating another. Cancellation blocks a delayed save.");return}
      if(!["committed","canceled"].includes(result.data.state))throw new Error("Unrecognized recovery response")
      const key=recoveryKey(caps.organizationId,caps.userId)
      if(localStorage.getItem(key)===recoveryAttempt)localStorage.removeItem(key)
      if(result.data.state==="committed")setRecoveredSession(result.data.session_id)
      setRecoveryAttempt(null);sessionOperation.current=null;await fetchPageData(true)
    }catch(cause){if(scopeRef.current===scope)setRecoveryError(cause instanceof Error?cause.message:"Unable to verify save outcome.")}
    finally{if(scopeRef.current===scope)setCreating(false)}
  }


  useEffect(() => {
    appliedDraft.current = null
    setScheduledStart(requestedStart)
    setScheduledEnd("")
  }, [requestedStart])

  useEffect(() => {
    if (!requestedStart || appliedDraft.current === requestedStart || scheduledStart !== requestedStart || scheduledEnd) return
    const duration = sessionTypes.find(type => type.code === sessionType)?.default_duration_minutes
    if (duration && duration > 0) {
      appliedDraft.current = requestedStart
      setScheduledEnd(localDateTime(new Date(new Date(requestedStart).getTime() + duration * 60000)))
    }
  }, [requestedStart, scheduledStart, scheduledEnd, sessionType, sessionTypes])

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
          readinessResult,
          permissionResult,
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
              workflow_intent,
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
          supabase.rpc("session_people_readiness"),
          supabase.rpc("can_manage_sessions"),
        ])
        setCanSchedule(!permissionResult.error && permissionResult.data === true)
        setPermissionError(permissionResult.error ? "Unable to check scheduling permissions. Refresh to try again." : "")
        if (readinessResult.error) throw new Error("Unable to check people setup. Refresh to try again.")
        setPeopleReadiness(readinessResult.data)

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
    [requestedClientId]
  )

  useEffect(() => {
    fetchPageData()
  }, [fetchPageData])

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
    event?: {preventDefault:()=>void}
  ) => {
    event?.preventDefault()

    if (!canSchedule || !canWrite) {
      setPageError("Scheduling is unavailable with your current access. Ask your primary administrator to review permissions and the account subscription.")
      return
    }

    if(!recoveryReady||!caps?.sessions){setPageError("Verify save-recovery access before creating a session.");return}
    if(recoveryAttempt&&!sessionOperation.current){setRecoveryError("Resolve the previous save attempt first.");return}
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
      const payload = { p_intent:intent,p_child:clientId,p_provider:providerId,p_start:startDate.toISOString(),p_end:endDate.toISOString(),p_type:sessionType,p_location:finalLocation||null,p_tags:selectedTags }
      const fingerprint=JSON.stringify(payload)
      if(recoveryAttempt&&sessionOperation.current?.key!==fingerprint)throw new Error("Retry unchanged details or cancel the unconfirmed attempt first.")
      if(sessionOperation.current?.key!==fingerprint)sessionOperation.current={key:fingerprint,id:crypto.randomUUID()}
      const key=recoveryKey(caps.organizationId,caps.userId),existing=localStorage.getItem(key)
      if(existing&&existing!==sessionOperation.current.id){sessionOperation.current=null;setRecoveryAttempt(existing);throw new Error("Another save needs recovery before creating a session.")}
      localStorage.setItem(key,sessionOperation.current.id)
      const requestScope=saveScope
      const {data,error}=await supabase.rpc("create_scheduled_context_session",{...payload,p_operation:sessionOperation.current.id})
      if(scopeRef.current!==requestScope)return
      if (error) {
        throw new Error(error.message)
      }
      if(localStorage.getItem(key)===sessionOperation.current.id)localStorage.removeItem(key)
      setRecoveryAttempt(null);setRecoveryError("")

      const result =
        data as CreateSessionResult

      sessionOperation.current=null
      setSelectedTags([])
      void contextChoices.refresh()
      setSuccess(result)
      window.dispatchEvent(new Event("rejoyce:schedule-changed"))

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
      if(sessionOperation.current)setRecoveryAttempt(sessionOperation.current.id)
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

          <p className="rj-body mt-4 text-[var(--rj-text-secondary)]">{t("Loading session management…")}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {!pageError && peopleReadiness && <SessionPeopleWarning missingClients={peopleReadiness.missing_clients} missingStaff={peopleReadiness.missing_staff} />}
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

            <h1 className="rj-heading-1 mt-4">{t("Sessions")}</h1>

            <p className="rj-body mt-3 text-[var(--rj-text-secondary)]">{t("Schedule services using the session types, durations, and locations configured in Setup.")}</p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Link
              href="/setup/preferences"
              className="rj-button rj-button-secondary"
            >
              Setup options
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
      <PageGuide guide="sessions" />

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
                <h2 className="font-bold text-[var(--rj-mint-700)]">{t("Session created successfully")}</h2>

                <p className="mt-1 text-sm text-[var(--rj-text-secondary)]">
                  {success.workflow_intent === "activity" ? "Activity scheduled. No clinical targets prepared; this is not recorded attendance." : `${success.targets_added} active targets prepared automatically.`}
                </p>
              </div>
            </div>

            <Link
              href={`/sessions/${success.session_id}`}
              className="rj-button rj-button-primary"
            >{t("Manage Session")}<ExternalLink size={17} />
            </Link>
          </div>
        </section>
      )}

      {recoveredSession&&<p role="status">Recovered the committed save. <Link className="underline" href={`/sessions/${recoveredSession}`}>Open recovered session</Link></p>}
      {recoveryError&&<p role="alert">{recoveryError}</p>}
      {recoveryAttempt&&<section className="rj-card space-y-2 p-4" aria-label="Recover interrupted session save"><h2 className="rj-heading-2">Resolve an interrupted save</h2><p>Only an opaque operation ID is stored in this browser. Check the server receipt before creating another session.</p><button className="rj-button rj-button-secondary" disabled={creating} onClick={()=>void recoverAttempt()}>Check save outcome</button> <button className="rj-button rj-button-secondary" disabled={creating||!canWrite} onClick={()=>void recoverAttempt(true)}>Cancel unconfirmed attempt</button> {sessionOperation.current&&<button className="underline" disabled={creating} onClick={()=>void handleCreateSession()}>Retry unchanged save</button>}</section>}
      <SessionChoiceManager onChanged={()=>void contextChoices.refresh()} />
      {/* Summary */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
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
          description={t("Finished sessions")}
          icon={CheckCircle2}
          background="var(--rj-mint-100)"
          foreground="var(--rj-mint-700)"
        />
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(340px,430px)_minmax(0,1fr)]">
        {/* Create Session */}
        <section id="create-session" className="rj-card h-fit p-6 xl:sticky xl:top-6">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--rj-teal-100)] text-[var(--rj-teal-700)]">
              <Plus size={23} />
            </div>

            <div>
              <p className="rj-label">{t("New Session")}</p>

              <h2 className="rj-heading-2 mt-1">
                Schedule an activity or clinical session
              </h2>
            </div>
          </div>

          <p className="rj-caption mt-3">{intent === "clinical" ? "Clinical preparation copies active client targets. Existing clinical permissions and safeguards apply." : "Schedule one child’s activity without treatment targets. Attendance is recorded separately."}</p>
{requestedClientId && selectedClient && (
  <div className="mt-4 rounded-[var(--rj-radius-md)] bg-[var(--rj-blue-50)] p-4">
    <div className="flex gap-3">
      <CheckCircle2
        size={20}
        className="shrink-0 text-[var(--rj-blue-700)]"
      />

      <div>
        <p className="text-sm font-bold text-[var(--rj-blue-700)]">{t("Creating a session for")}{" "}
          {getClientName(selectedClient)}
        </p>

        <p className="rj-caption mt-1">{t("The client and primary worker were selected from the client profile.")}</p>
      </div>
    </div>
  </div>
)}
          {permissionError && <p role="alert" className="mt-3 text-sm text-red-700">{permissionError}</p>}
          {!canSchedule && !permissionError && <p className="mt-3 text-sm text-gray-500" title="Ask your account's primary administrator to review your scheduling permissions.">Scheduling requires permission from your primary administrator.</p>}
          <fieldset disabled={!canSchedule||!recoveryReady||!!recoveryAttempt} className="contents"><SubscriptionWriteControls><form
            onSubmit={handleCreateSession}
            className="mt-6 space-y-5"
          >
            <label className="block">Scheduling workflow<select className="rj-input" value={intent} onChange={event=>setIntent(event.target.value as "activity" | "clinical")}><option value="activity">Ordinary daycare activity</option><option value="clinical">Clinical session with preparation</option></select></label>
            {contextChoices.error && <p role="alert">Saved choices unavailable: {contextChoices.error} <button type="button" className="underline" onClick={()=>void contextChoices.refresh()}>Retry choices</button></p>}
            <p className="text-sm">Search current saved choices. Recent selections are suggestions, not automatic changes. Child and staff creation still use the separately authorized People workflow.</p>
            <SearchableChoice label={t("Client")} value={clientId} required options={clients.map(client=>({value:client.id,label:getClientName(client),recent:!!contextChoices.data?.recent.some(recent=>recent.child_id===client.id)}))} onChange={id=>{setClientId(id);const assigned=clients.find(client=>client.id===id)?.assigned_provider_id;if(assigned&&providers.some(provider=>provider.id===assigned))setProviderId(assigned)}} />
            <SearchableChoice label={t("Assigned frontline worker")} value={providerId} required options={providers.map(provider=>({value:provider.id,label:provider.full_name||provider.email||"Unnamed user",recent:!!contextChoices.data?.recent.some(recent=>recent.provider_id===provider.id)}))} onChange={setProviderId} />
            <SearchableChoice label={t("Session type")} value={sessionType} required options={sessionTypes.map(type=>({value:type.code,label:`${type.name}${type.default_duration_minutes?` · ${type.default_duration_minutes} min`:""}`,recent:!!contextChoices.data?.recent.some(recent=>recent.session_type===type.code)}))} onChange={code=>{setSessionType(code);if(scheduledStart)applyDefaultEndTime(scheduledStart,code)}} createLabel="Create and save activity type" onCreate={async label=>{const duration=Number(newTypeDuration);if(!Number.isInteger(duration)||duration<1||duration>1440)throw new Error("Choose a whole duration from 1 to 1440 minutes.");const result=await supabase.rpc("save_session_type_choice",{p_label:label,p_duration:duration});if(result.error)throw new Error(result.error.message);await fetchPageData(true);setSessionType(result.data.code);if(scheduledStart)setScheduledEnd(localDateTime(new Date(new Date(scheduledStart).getTime()+duration*60000)))}} />
            <label className="block text-sm">Duration for a new activity type (minutes)<input type="number" min={1} max={1440} step={1} className="rj-input" value={newTypeDuration} onChange={event=>setNewTypeDuration(event.target.value)}/></label>
            <Link href="/setup/preferences?tab=session-types" className="inline-block underline">Create and save a new activity type in Setup</Link>
            <SessionTypeDescription sessionType={selectedSessionType} />
            {!!contextChoices.data?.recent.length && <details className="rounded-xl border p-3"><summary className="cursor-pointer font-semibold">Reuse recent session details</summary><p className="text-sm">Only your last ten successful selections in this organization are included. Applying one changes details below but never copies a date or creates a session.</p><div className="mt-3 space-y-2">{contextChoices.data.recent.map(recent=><button key={recent.id} type="button" className="block w-full rounded border p-3 text-left" onClick={()=>{if(!clients.some(client=>client.id===recent.child_id)||!providers.some(provider=>provider.id===recent.provider_id)||!sessionTypes.some(type=>type.code===recent.session_type))return;setIntent(recent.workflow_intent || "clinical");setClientId(recent.child_id);setProviderId(recent.provider_id);setSessionType(recent.session_type);if(locationOptions.some(location=>location.name===recent.location)){setSelectedLocation(recent.location||"");setCustomLocation("")}else{setSelectedLocation(recent.location?"custom":"");setCustomLocation(recent.location||"")}setSelectedTags(recent.tag_ids.filter(id=>contextChoices.data?.choices.some(choice=>choice.id===id&&choice.kind==="tag"&&choice.active!==false)));if(scheduledStart)setScheduledEnd(localDateTime(new Date(new Date(scheduledStart).getTime()+recent.duration_minutes*60000)))}}>Use {getClientName(clients.find(client=>client.id===recent.child_id)!)} · {sessionTypes.find(type=>type.code===recent.session_type)?.name} · {recent.duration_minutes} min · {recent.location||"No location"}</button>)}</div></details>}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-1">
              <FormField label="Start">
                <div className="relative">
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
                    className="rj-input"
                    required
                  />
                </div>
              </FormField>

              <FormField label="End">
                <div className="relative">
                  <input
                    type="datetime-local"
                    value={scheduledEnd}
                    onChange={(event) =>
                      setScheduledEnd(
                        event.target.value
                      )
                    }
                    className="rj-input"
                    required
                  />
                </div>
              </FormField>
            </div>

            <SearchableChoice savedKind="location" label="Location" value={selectedLocation==="custom"?customLocation:selectedLocation} options={[...new Set([...(selectedLocation==="custom"&&customLocation?[customLocation]:[]),...locationOptions.map(location=>location.name),...sessions.map(session=>session.location).filter((value):value is string=>!!value),...(contextChoices.data?.choices.filter(choice=>choice.kind==="location"&&choice.active!==false).map(choice=>choice.label)||[]),...(contextChoices.data?.recent.map(recent=>recent.location).filter((value):value is string=>!!value)||[])])].map(value=>({value,label:value,recent:!!contextChoices.data?.recent.some(recent=>recent.location===value)}))} onChange={value=>{if(locationOptions.some(location=>location.name===value)){setSelectedLocation(value);setCustomLocation("")}else{setSelectedLocation(value?"custom":"");setCustomLocation(value)}}} createLabel="Create and save location choice" onCreate={async label=>{const result=await supabase.rpc("save_session_choice",{p_kind:"location",p_label:label,p_domain:"shared"});if(result.error)throw new Error(result.error.message);const latest=await contextChoices.refresh([result.data as string]);const saved=latest?.choices.find(choice=>choice.id===result.data);if(!saved)throw new Error("Location saved; reload choices before selecting it.");setSelectedLocation("custom");setCustomLocation(saved.label)}} />
            <p className="text-sm">A saved location choice is a scheduling label, not an attendance branch or classroom. Session times use the timezone configured on this device.</p>
            <SessionContextChoices context={contextChoices.data} selected={selectedTags} onChange={setSelectedTags} onSaved={contextChoices.refresh} disabled={creating||!canWrite||!canSchedule} />

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
                ? t("Preparing session…")
                : t("Create Session")}
            </button>
          </form></SubscriptionWriteControls></fieldset>

          {clients.length === 0 && (
            <EmptyRequirement
              text={t("Create an active client before scheduling a session.")}
              href="/team-management"
              linkText="Manage People"
            />
          )}

          {providers.length === 0 && (
            <EmptyRequirement
              text={t("Create or invite an active frontline worker before scheduling.")}
              href="/team-management"
              linkText="Manage Team"
            />
          )}

          {sessionTypes.length === 0 && (
            <EmptyRequirement
              text={t("Create an active session type in Setup before scheduling.")}
              href="/setup/preferences"
              linkText="Open Setup"
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

                <h2 className="rj-heading-2 mt-1">{t("Scheduled Sessions")}</h2>

                <p className="rj-caption mt-2">
                  {filteredSessions.length}{t(filteredSessions.length === 1 ? " session" : " sessions")}{" "}
                  shown
                </p>
              </div>

              <div className="flex flex-col flex-wrap gap-3 sm:flex-row">
                <div className="relative">
                  <input
                    type="search"
                    value={searchTerm}
                    onChange={(event) =>
                      setSearchTerm(
                        event.target.value
                      )
                    }
                    placeholder={t("Search sessions…")}
                    className="rj-input min-w-0"
                  />
                </div>

                <div className="relative">
                  <select
                    value={statusFilter}
                    onChange={(event) =>
                      setStatusFilter(
                        event.target.value
                      )
                    }
                    className="rj-input min-w-0"
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

              <h3 className="rj-heading-3 mt-4">{t("No matching sessions")}</h3>

              <p className="rj-caption mx-auto mt-2 max-w-sm">{t("Create a session or adjust your search and filter options.")}</p>
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
  const { t } = usePortal()

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

  const isActivity = session.workflow_intent === "activity"
  const isPrepared =
    Boolean(session.prepared_at) &&
    targetCount > 0

  return (
    <article className="p-5 transition-colors hover:bg-[var(--rj-surface-muted)] sm:p-6">
      <div className="flex flex-col justify-between gap-5">
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
                isActivity || isPrepared
                  ? "rj-badge-success"
                  : "rj-badge-warning"
              }`}
            >
              {isActivity ? "Activity scheduled" : isPrepared
                ? "Prepared"
                : t("Needs targets")}
            </span>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
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
              label={isActivity ? "Workflow" : t("Prepared targets")}
              value={isActivity ? "Ordinary activity — no targets required" : `${targetCount} ${t(targetCount === 1 ? "target" : "targets")}`}
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
            {isActivity ? "Attendance recorded separately" : "Recorded session participation:"}{" "}
            {!isActivity && formatLabel(
              session.attendance_status
            )}
          </p>
        </div>

        <div className="flex shrink-0 flex-col flex-wrap gap-3 sm:flex-row">
          <Link
            href={isActivity ? `/activity/${session.id}` : `/session/${session.id}`}
            className="rj-button rj-button-secondary"
          >
            {isActivity ? "View activity" : "Open Workspace"}
            <ExternalLink size={17} />
          </Link>

          <Link href={`/sessions/${session.id}/edit`} className="rj-button rj-button-secondary">{t("Edit session")}</Link>
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
