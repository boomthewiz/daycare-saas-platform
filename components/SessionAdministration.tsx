"use client"

import { usePortal } from "@/components/PortalProvider"

import PageGuide from "@/components/PageGuide"
import SubscriptionWriteControls from "@/components/SubscriptionWriteControls"

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { useUnsavedSessionChanges } from "@/lib/use-unsaved-session-changes"
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  CalendarDays,
  Check,
  CheckCircle2,
  CircleAlert,
  ExternalLink,
  FileText,
  ListChecks,
  LoaderCircle,
  PauseCircle,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Sparkles,
  Trash2,
  Users,
  XCircle,
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

type AttendanceStatus =
  | "unconfirmed"
  | "present"
  | "absent"
  | "late"
  | "canceled"

type SessionRecord = {
  id: string
  organization_id: string
  client_id: string
  provider_id: string | null
  supervisor_id: string | null
  session_type: string
  status: SessionStatus
  attendance_status: AttendanceStatus
  scheduled_start: string | null
  scheduled_end: string | null
  started_at: string | null
  paused_at: string | null
  completed_at: string | null
  total_paused_seconds: number
  location: string | null
  was_supervised: boolean
  prepared_by: string | null
  prepared_at: string | null
  created_at: string
  updated_at: string
}

type ClientRecord = {
  id: string
  first_name: string
  last_name: string | null
  preferred_name: string | null
  status: string
}

type ProviderRecord = {
  id: string
  full_name: string | null
  email: string | null
  role: string
  status: string
}

type SessionTargetRecord = {
  id: string
  session_id: string
  client_target_id: string | null
  title: string
  instruction: string | null
  category: string | null
  target_type: string
  response_mode: string
  materials: string | null
  sort_order: number
  status: "pending" | "active" | "completed" | "skipped"
  completed_at: string | null
}

type ClientTargetRecord = {
  id: string
  client_id: string
  title: string
  instruction: string | null
  category: string | null
  target_type: string
  response_mode: string
  materials: string | null
  sort_order: number
  status: string
}

type SessionNoteRecord = {
  id: string
  status: string
  submitted_at: string | null
  reviewed_at: string | null
}

type TargetResponseRecord = {
  id: string
  session_target_id: string
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

type ConfiguredSessionType = { id: string; code: string; name: string; active: boolean }

const SESSION_STATUSES: {
  value: SessionStatus
  label: string
}[] = [
  {
    value: "scheduled",
    label: "Scheduled",
  },
  {
    value: "confirmed",
    label: "Confirmed",
  },
  {
    value: "in_progress",
    label: "In progress",
  },
  {
    value: "paused",
    label: "Paused",
  },
  {
    value: "completed",
    label: "Completed",
  },
  {
    value: "canceled",
    label: "Canceled",
  },
  {
    value: "client_absent",
    label: "Client absent",
  },
  {
    value: "provider_absent",
    label: "Provider absent",
  },
  {
    value: "no_show",
    label: "No show",
  },
]

const ATTENDANCE_STATUSES: {
  value: AttendanceStatus
  label: string
}[] = [
  {
    value: "unconfirmed",
    label: "Unconfirmed",
  },
  {
    value: "present",
    label: "Present",
  },
  {
    value: "absent",
    label: "Absent",
  },
  {
    value: "late",
    label: "Late",
  },
  {
    value: "canceled",
    label: "Canceled",
  },
]

export default function SessionAdministration({ editing = false }: { editing?: boolean }) {
  const { t } = usePortal()

  const router = useRouter()
  const [canManage, setCanManage] = useState(false)
  const params = useParams<{ sessionId: string }>()

  const sessionId = params.sessionId

  const [session, setSession] =
    useState<SessionRecord | null>(null)

  const [client, setClient] =
    useState<ClientRecord | null>(null)

  const [providers, setProviders] =
    useState<ProviderRecord[]>([])

  const [sessionTargets, setSessionTargets] =
    useState<SessionTargetRecord[]>([])

  const [availableTargets, setAvailableTargets] =
    useState<ClientTargetRecord[]>([])

  const [sessionNote, setSessionNote] =
    useState<SessionNoteRecord | null>(null)

  const [targetResponses, setTargetResponses] =
    useState<TargetResponseRecord[]>([])

  // Editable session fields
  const [providerId, setProviderId] = useState("")
  const [sessionType, setSessionType] =
    useState("direct_therapy")
  const [scheduledStart, setScheduledStart] = useState("")
  const [scheduledEnd, setScheduledEnd] = useState("")
  const [location, setLocation] = useState("")
  const [status, setStatus] =
    useState<SessionStatus>("scheduled")
  const [attendanceStatus, setAttendanceStatus] =
    useState<AttendanceStatus>("unconfirmed")
  const [wasSupervised, setWasSupervised] = useState(false)

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [savingSession, setSavingSession] = useState(false)
  const [preparingTargets, setPreparingTargets] =
    useState(false)

  const [addingTargetId, setAddingTargetId] =
    useState<string | null>(null)

  const [updatingTargetId, setUpdatingTargetId] =
    useState<string | null>(null)

  const [configuredTypes, setConfiguredTypes] = useState<ConfiguredSessionType[]>([])
  const [typeError, setTypeError] = useState("")
  const [pageError, setPageError] =
    useState<string | null>(null)

  const [successMessage, setSuccessMessage] =
    useState<string | null>(null)

  const loadPage = useCallback(
    async (showRefreshState = false) => {
      if (!sessionId) return

      if (showRefreshState) {
        setRefreshing(true)
      } else {
        setLoading(true)
      }

      setPageError(null)

      try {
        const permission = await supabase.rpc("can_manage_sessions")
        if (permission.error) throw new Error(permission.error.message)
        setCanManage(permission.data === true)
        const {
          data: sessionData,
          error: sessionError,
        } = await supabase
          .from("sessions")
          .select(`
            id,
            organization_id,
            client_id,
            provider_id,
            supervisor_id,
            session_type,
            status,
            attendance_status,
            scheduled_start,
            scheduled_end,
            started_at,
            paused_at,
            completed_at,
            total_paused_seconds,
            location,
            was_supervised,
            prepared_by,
            prepared_at,
            created_at,
            updated_at
          `)
          .eq("id", sessionId)
          .single()

        if (sessionError) {
          throw new Error(sessionError.message)
        }

        const loadedSession =
          sessionData as SessionRecord

        const [
          clientResult,
          providerResult,
          sessionTargetResult,
          clientTargetResult,
          noteResult,
          responseResult,
          typeResult,
        ] = await Promise.all([
          supabase
            .from("clients")
            .select(`
              id,
              first_name,
              last_name,
              preferred_name,
              status
            `)
            .eq("id", loadedSession.client_id)
            .single(),

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
            .eq("organization_id", loadedSession.organization_id)
            .in("role", FRONTLINE_ROLES)
            .order("full_name", {
              ascending: true,
              nullsFirst: false,
            }),

          supabase
            .from("session_targets")
            .select(`
              id,
              session_id,
              client_target_id,
              title,
              instruction,
              category,
              target_type,
              response_mode,
              materials,
              sort_order,
              status,
              completed_at
            `)
            .eq("session_id", sessionId)
            .order("sort_order", {
              ascending: true,
            }),

          supabase
            .from("client_targets")
            .select(`
              id,
              client_id,
              title,
              instruction,
              category,
              target_type,
              response_mode,
              materials,
              sort_order,
              status
            `)
            .eq("client_id", loadedSession.client_id)
            .eq("status", "active")
            .order("sort_order", {
              ascending: true,
            }),

          supabase
            .from("session_notes")
            .select(`
              id,
              status,
              submitted_at,
              reviewed_at
            `)
            .eq("session_id", sessionId)
            .maybeSingle(),

          supabase
            .from("target_responses")
            .select(`
              id,
              session_target_id
            `)
            .eq("session_id", sessionId),
          supabase.from("session_types").select("id,code,name,active")
            .eq("organization_id", loadedSession.organization_id)
            .order("sort_order").order("name"),
        ])

        if (clientResult.error) {
          throw new Error(clientResult.error.message)
        }

        if (providerResult.error) {
          throw new Error(providerResult.error.message)
        }

        if (sessionTargetResult.error) {
          throw new Error(
            sessionTargetResult.error.message
          )
        }

        if (clientTargetResult.error) {
          throw new Error(
            clientTargetResult.error.message
          )
        }

        if (noteResult.error) {
          throw new Error(noteResult.error.message)
        }

        if (responseResult.error) {
          throw new Error(responseResult.error.message)
        }

        setTypeError(typeResult.error ? "Unable to load configured service types. Refresh before changing the type." : "")
        setConfiguredTypes(typeResult.error ? [] : (typeResult.data || []) as ConfiguredSessionType[])

        const loadedSessionTargets =
          (sessionTargetResult.data ||
            []) as SessionTargetRecord[]

        const loadedClientTargets =
          (clientTargetResult.data ||
            []) as ClientTargetRecord[]

        const includedClientTargetIds = new Set(
          loadedSessionTargets
            .map((target) => target.client_target_id)
            .filter(
              (targetId): targetId is string =>
                Boolean(targetId)
            )
        )

        setSession(loadedSession)
        setClient(clientResult.data as ClientRecord)

        setProviders(
          (providerResult.data ||
            []) as ProviderRecord[]
        )

        setSessionTargets(loadedSessionTargets)

        setAvailableTargets(
          loadedClientTargets.filter(
            (target) =>
              !includedClientTargetIds.has(target.id)
          )
        )

        setSessionNote(
          (noteResult.data as SessionNoteRecord | null) ||
            null
        )

        setTargetResponses(
          (responseResult.data ||
            []) as TargetResponseRecord[]
        )

        // Populate form state
        setProviderId(loadedSession.provider_id || "")
        setSessionType(
          loadedSession.session_type ||
            "direct_therapy"
        )
        setScheduledStart(
          toDateTimeLocal(loadedSession.scheduled_start)
        )
        setScheduledEnd(
          toDateTimeLocal(loadedSession.scheduled_end)
        )
        setLocation(loadedSession.location || "")
        setStatus(loadedSession.status)
        setAttendanceStatus(
          loadedSession.attendance_status
        )
        setWasSupervised(
          loadedSession.was_supervised
        )
      } catch (error) {
        console.error(
          "Load session detail error:",
          error
        )

        setPageError(
          error instanceof Error
            ? error.message
            : "Unable to load this session."
        )
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [sessionId]
  )

  useEffect(() => {
    loadPage()
  }, [loadPage])

  const clientName = useMemo(() => {
    if (!client) return "Client"

    return (
      client.preferred_name?.trim() ||
      [client.first_name, client.last_name]
        .filter(Boolean)
        .join(" ")
    )
  }, [client])

  const selectedProvider = useMemo(
    () =>
      providers.find(
        (provider) => provider.id === providerId
      ) || null,
    [providerId, providers]
  )

  const responseCountByTarget = useMemo(() => {
    const counts = new Map<string, number>()

    targetResponses.forEach((response) => {
      counts.set(
        response.session_target_id,
        (counts.get(response.session_target_id) ||
          0) + 1
      )
    })

    return counts
  }, [targetResponses])

  const completedTargetCount =
    sessionTargets.filter(
      (target) => target.status === "completed"
    ).length

  const hasStarted = Boolean(session?.started_at)
  const historical = !!session && ['completed','canceled','client_absent','provider_absent','no_show'].includes(session.status)

  const canEditPreparation = canManage && !hasStarted && !historical &&
    (session?.status === "scheduled" || session?.status === "confirmed")

  const dirty = editing && !!session && session.id === sessionId && (
    providerId !== (session.provider_id || "") || sessionType !== session.session_type ||
    scheduledStart !== toDateTimeLocal(session.scheduled_start) ||
    scheduledEnd !== toDateTimeLocal(session.scheduled_end) ||
    location !== (session.location || "") || status !== session.status ||
    attendanceStatus !== session.attendance_status || wasSupervised !== session.was_supervised
  )
  const { confirmLeave, discardDialog } = useUnsavedSessionChanges(dirty, savingSession, editing)
  const cancelEditing = async () => {
    if (await confirmLeave()) router.push(`/sessions/${sessionId}`)
  }

  const handleSaveSession = async (
    event: FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault()

    if (!session || session.id !== sessionId || historical || !canManage || savingSession) return

    if (!hasStarted && (
      !providerId ||
      !scheduledStart ||
      !scheduledEnd
    )) {
      setPageError(
        "An assigned team member, start time, and end time are required."
      )
      return
    }

    const startDate = new Date(scheduledStart)
    const endDate = new Date(scheduledEnd)

    if (!hasStarted && (
      Number.isNaN(startDate.getTime()) ||
      Number.isNaN(endDate.getTime())
    )) {
      setPageError(
        "Enter a valid start and end time."
      )
      return
    }

    if (!hasStarted && endDate <= startDate) {
      setPageError(
        "The session end must be after its start."
      )
      return
    }

    setSavingSession(true)
    setPageError(null)
    setSuccessMessage(null)

    try {
      const { error } = await supabase
        .from("sessions")
        .update({
          // Do not round or resend locked schedule fields during metadata edits.
          ...(hasStarted ? {} : {
            provider_id: providerId,
            session_type: sessionType,
            scheduled_start: startDate.toISOString(),
            scheduled_end: endDate.toISOString(),
            status,
          }),
          location: location.trim() || null,
          attendance_status: attendanceStatus,
          was_supervised: wasSupervised,
        })
        .eq("id", session.id)
        .eq("organization_id", session.organization_id)
        .eq("updated_at", session.updated_at)
        .select("id").single()

      if (error) {
        throw new Error(error.code === "PGRST116" ? "This session changed or your access is no longer available. Your changes have not been saved. Reload to review the latest record." : error.message)
      }

      setSuccessMessage(
        "Session details saved successfully."
      )

      await loadPage()
    } catch (error) {
      console.error("Save session error:", error)

      setPageError(
        error instanceof Error
          ? error.message
          : "Unable to save the session."
      )
    } finally {
      setSavingSession(false)
    }
  }

  const handlePrepareActiveTargets = async () => {
    if (!sessionId || preparingTargets) return

    setPreparingTargets(true)
    setPageError(null)
    setSuccessMessage(null)

    try {
      const { data, error } = await supabase.rpc(
        "prepare_session_targets",
        {
          requested_session_id: sessionId,
        }
      )

      if (error) {
        throw new Error(error.message)
      }

      const addedCount =
        typeof data === "number" ? data : 0

      setSuccessMessage(
        `${addedCount} active target${
          addedCount === 1 ? "" : "s"
        } added to the session.`
      )

      await loadPage()
    } catch (error) {
      console.error(
        "Prepare session targets error:",
        error
      )

      setPageError(
        error instanceof Error
          ? error.message
          : "Unable to prepare session targets."
      )
    } finally {
      setPreparingTargets(false)
    }
  }

  const addTargetToSession = async (
    target: ClientTargetRecord
  ) => {
    if (
      !session ||
      addingTargetId ||
      !canEditPreparation
    ) {
      return
    }

    setAddingTargetId(target.id)
    setPageError(null)
    setSuccessMessage(null)

    try {
      const nextSortOrder =
        sessionTargets.length === 0
          ? 0
          : Math.max(
              ...sessionTargets.map(
                (item) => item.sort_order
              )
            ) + 1

      const { error } = await supabase
        .from("session_targets")
        .insert({
          organization_id:
            session.organization_id,
          session_id: session.id,
          client_target_id: target.id,
          title: target.title,
          instruction: target.instruction,
          category: target.category,
          target_type: target.target_type,
          response_mode: target.response_mode,
          materials: target.materials,
          sort_order: nextSortOrder,
          status: "pending",
        })

      if (error) {
        throw new Error(error.message)
      }

      setSuccessMessage(
        `"${target.title}" was added to the session.`
      )

      await loadPage()
    } catch (error) {
      console.error(
        "Add session target error:",
        error
      )

      setPageError(
        error instanceof Error
          ? error.message
          : "Unable to add the target."
      )
    } finally {
      setAddingTargetId(null)
    }
  }

  const removeTargetFromSession = async (
    target: SessionTargetRecord
  ) => {
    if (
      updatingTargetId ||
      !canEditPreparation
    ) {
      return
    }

    const responseCount =
      responseCountByTarget.get(target.id) || 0

    if (responseCount > 0) {
      setPageError(
        "This target already has recorded responses and cannot be removed."
      )
      return
    }

    const confirmed = window.confirm(
      `Remove "${target.title}" from this prepared session?`
    )

    if (!confirmed) return

    setUpdatingTargetId(target.id)
    setPageError(null)
    setSuccessMessage(null)

    try {
      const { error } = await supabase
        .from("session_targets")
        .delete()
        .eq("id", target.id)
        .select("id").single()

      if (error) {
        throw new Error(error.message)
      }

      setSuccessMessage(
        `"${target.title}" was removed from this session.`
      )

      await loadPage()
    } catch (error) {
      console.error(
        "Remove session target error:",
        error
      )

      setPageError(
        error instanceof Error
          ? error.message
          : "Unable to remove the target."
      )
    } finally {
      setUpdatingTargetId(null)
    }
  }

  const moveTarget = async (
    targetIndex: number,
    direction: "up" | "down"
  ) => {
    if (
      updatingTargetId ||
      !canEditPreparation
    ) {
      return
    }

    const otherIndex =
      direction === "up"
        ? targetIndex - 1
        : targetIndex + 1

    if (
      otherIndex < 0 ||
      otherIndex >= sessionTargets.length
    ) {
      return
    }

    const currentTarget =
      sessionTargets[targetIndex]

    const otherTarget =
      sessionTargets[otherIndex]

    setUpdatingTargetId(currentTarget.id)
    setPageError(null)
    setSuccessMessage(null)

    try {
      const { error } = await supabase.rpc('swap_session_targets', {
        p_session_id: sessionId, p_first: currentTarget.id, p_second: otherTarget.id,
        p_first_order: currentTarget.sort_order, p_second_order: otherTarget.sort_order,
      })
      if (error) throw new Error(error.message)

      await loadPage()
    } catch (error) {
      console.error(
        "Reorder target error:",
        error
      )

      setPageError(
        error instanceof Error
          ? error.message
          : "Unable to reorder the target."
      )

      await loadPage()
    } finally {
      setUpdatingTargetId(null)
    }
  }

  const handleCancelSession = async () => {
    if (!session || hasStarted || historical || !canManage || savingSession) return

    const confirmed = window.confirm(
      "Cancel this session? Its history will remain available."
    )

    if (!confirmed) return

    setSavingSession(true)
    setPageError(null)
    setSuccessMessage(null)

    try {
      const { error } = await supabase
        .from("sessions")
        .update({
          status: "canceled",
          attendance_status: "canceled",
        })
        .eq("id", session.id)
        .eq("updated_at", session.updated_at)
        .select("id").single()

      if (error) {
        throw new Error(error.message)
      }

      setSuccessMessage(
        "The session has been canceled."
      )

      await loadPage()
    } catch (error) {
      console.error(
        "Cancel session error:",
        error
      )

      setPageError(
        error instanceof Error
          ? error.message
          : "Unable to cancel the session."
      )
    } finally {
      setSavingSession(false)
    }
  }

  if (loading) {
    return <SessionDetailLoading />
  }

  if (!session || session.id !== sessionId || !client) {
    return (
      <div className="mx-auto max-w-xl">
        <section className="rj-card p-8 text-center">
          <CircleAlert
            size={36}
            className="mx-auto text-[var(--rj-danger)]"
          />

          <h1 className="rj-heading-2 mt-4">{t("Session unavailable")}</h1>

          <p className="rj-body mt-2 text-[var(--rj-text-secondary)]">
            {pageError ||
              "This session could not be loaded."}
          </p>

          <Link
            href="/sessions"
            className="rj-button rj-button-primary mt-6"
          >
            <ArrowLeft size={19} />{t("Back to Sessions")}</Link>
        </section>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {discardDialog}
      {/* Breadcrumb */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Link
          href="/sessions"
          className="inline-flex items-center gap-2 font-bold text-[var(--rj-teal-700)]"
        >
          <ArrowLeft size={18} />{t("Sessions")}</Link>

        <button
          type="button"
          onClick={async () => { if (await confirmLeave()) void loadPage(true) }}
          disabled={refreshing}
          className="rj-button rj-button-secondary"
        >
          {refreshing ? (
            <LoaderCircle
              size={18}
              className="animate-spin"
            />
          ) : (
            <RefreshCw size={18} />
          )}

          Refresh
        </button>
      </div>

      {/* Header */}
      <header className="relative overflow-hidden rounded-[var(--rj-radius-xl)] border border-[var(--rj-border)] bg-[var(--rj-surface)] p-6 shadow-[var(--rj-shadow-soft)] sm:p-8">
        <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-[var(--rj-blue-100)] opacity-65" />

        <div className="pointer-events-none absolute -bottom-28 right-36 h-52 w-52 rounded-full bg-[var(--rj-lavender-100)] opacity-55" />

        <div className="relative flex flex-col justify-between gap-6 lg:flex-row lg:items-center">
          <div>
            {!editing && <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-full bg-[var(--rj-teal-50)] px-3 py-1.5 text-sm font-bold text-[var(--rj-teal-700)]">
                <Sparkles size={15} />{t("Session Administration")}</span>

              <SessionStatusBadge status={session.status} />

              <PreparationBadge
                prepared={
                  Boolean(session.prepared_at) &&
                  sessionTargets.length > 0
                }
              />
            </div>}

            <h1 className={editing ? "rj-heading-1" : "rj-heading-1 mt-4"}>
              {editing ? t("Edit session") : clientName}
            </h1>
            {editing && <p className="mt-2 font-bold">{clientName}</p>}

            <p className="rj-body mt-3 text-[var(--rj-text-secondary)]">
              {formatDateRange(
                session.scheduled_start,
                session.scheduled_end
              )}
            </p>

            <p className="rj-caption mt-1">
              {configuredTypes.find(type => type.code === session.session_type)?.name || formatLabel(session.session_type)}
              {session.location
                ? ` · ${session.location}`
                : ""}
            </p>
          </div>

          {!editing && <div className="flex flex-col gap-3 sm:flex-row">
            <Link
              href={`/session/${session.id}`}
              className="rj-button rj-button-primary"
            >
              <ExternalLink size={19} />
              Open Workspace
            </Link>

            {sessionNote && (
              <Link
                href={`/session/${session.id}/complete`}
                className="rj-button rj-button-secondary"
              >
                <FileText size={19} />
                View Note
              </Link>
            )}
          </div>}
        </div>
      </header>
      <PageGuide guide="session" />

      {pageError && (
        <MessageBanner
          tone="danger"
          title="Something needs attention"
          message={pageError}
        />
      )}

      {successMessage && (
        <MessageBanner
          tone="success"
          title="Changes saved"
          message={successMessage}
        />
      )}

      {/* Overview */}
      {!editing && <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <OverviewCard
          label="Assigned to"
          value={
            selectedProvider?.full_name ||
            selectedProvider?.email ||
            "Unassigned"
          }
          icon={Users}
          background="var(--rj-blue-100)"
          foreground="var(--rj-blue-700)"
        />

        <OverviewCard
          label={t("Prepared targets")}
          value={`${sessionTargets.length}`}
          icon={ListChecks}
          background="var(--rj-lavender-100)"
          foreground="var(--rj-lavender-700)"
        />

        <OverviewCard
          label={t("Completed targets")}
          value={`${completedTargetCount}`}
          icon={CheckCircle2}
          background="var(--rj-mint-100)"
          foreground="var(--rj-mint-700)"
        />

        <OverviewCard
          label={t("Session note")}
          value={
            sessionNote
              ? formatLabel(sessionNote.status)
              : "Not started"
          }
          icon={FileText}
          background="var(--rj-teal-100)"
          foreground="var(--rj-teal-700)"
        />
      </section>}

      <div className={editing ? "mx-auto max-w-3xl" : "grid grid-cols-1 gap-6 xl:grid-cols-[minmax(330px,420px)_minmax(0,1fr)]"}>
        {/* Session Details */}
        <section className="rj-card h-fit p-4 sm:p-6">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--rj-blue-100)] text-[var(--rj-blue-700)]">
              <CalendarDays size={23} />
            </div>

            <div>
              <p className="rj-label">{t("Session Details")}</p>

              <h2 className="rj-heading-2 mt-1">
                Schedule and assignment
              </h2>
            </div>
          </div>

          {!editing ? (
            <div className="mt-5 space-y-3">
              <p>{t("Open the editor to review this session’s schedule and assignment.")}</p>
              {canManage && !historical && <Link href={`/sessions/${session.id}/edit`} className="rj-button rj-button-primary w-full">{t("Edit session")}</Link>}
              {historical && <p>{t("This historical session is read-only.")}</p>}
            </div>
          ) : <>
          <div className="sticky top-3 z-10 mt-5 flex flex-col gap-3 rounded-xl border border-[var(--rj-border)] bg-[var(--rj-surface)] p-3 shadow-sm sm:flex-row">
            <SubscriptionWriteControls>
            <button
              type="submit"
              form="session-details-form"
              disabled={savingSession || historical || !canManage || !dirty}
              className="rj-button rj-button-primary flex-1"
            >
              {savingSession ? (
                <LoaderCircle
                  size={19}
                  className="animate-spin"
                />
              ) : (
                <Save size={19} />
              )}

              {savingSession
                ? "Saving…"
                : "Save"}
            </button></SubscriptionWriteControls>
            <button type="button" onClick={() => void cancelEditing()} disabled={savingSession} className="rj-button rj-button-secondary flex-1">Cancel</button>
          </div>
          <p role="status" className="mt-4">{dirty ? "Unsaved changes" : t("Showing saved session details")}. Changes are saved only when you choose Save.</p>
          {!canManage && <p role="alert" className="mt-3">{t("You do not have permission to edit sessions.")}</p>}
          {historical && <p role="alert" className="mt-3">{t("This historical session is read-only.")}</p>}
          <SubscriptionWriteControls><form
            id="session-details-form"
            onSubmit={handleSaveSession}
            className="mt-6 space-y-5"
          >
            <fieldset disabled={!canManage || historical || savingSession} className="min-w-0 space-y-5">
            <FormField label={t("Assigned frontline worker")}>
              <select
                value={providerId}
                onChange={(event) =>
                  setProviderId(event.target.value)
                }
                className="rj-input"
                required
                disabled={hasStarted || historical}
              >
                <option value="">{t("Select a team member")}</option>

                {providerId && !providers.some(provider => provider.id === providerId) && <option value={providerId}>{t("Current team member (inactive or unavailable)")}</option>}
                {providers.map((provider) => (
                  <option
                    key={provider.id}
                    value={provider.id}
                  >
                    {provider.full_name ||
                      provider.email ||
                      "Unnamed user"}{" "}
                    — {formatLabel(provider.role)}
                  </option>
                ))}
              </select>
            </FormField>

            <FormField label={t("Session type")}>
              <select
                aria-label={t("Session type")}
                value={sessionType}
                onChange={(event) =>
                  setSessionType(event.target.value)
                }
                className="rj-input"
                disabled={hasStarted || historical || !!typeError}
              >
                {!configuredTypes.some(type => type.code === sessionType) && <option value={sessionType}>{formatLabel(sessionType)} (saved type)</option>}
                {configuredTypes.filter(type => type.active || type.code === session.session_type).map((type) => (
                  <option
                    key={type.id}
                    value={type.code}
                  >
                    {type.name}{!type.active ? " (inactive, saved type)" : ""}
                  </option>
                ))}
              </select>
              {typeError && <p role="alert" className="rj-caption mt-2">{typeError}</p>}
              <p className="rj-caption mt-2">Changing the service type preserves these scheduled times. Adjust Start and End explicitly if needed.</p>
            </FormField>

            <FormField label="Start">
              <div className="relative">
                <input
                  type="datetime-local"
                  value={scheduledStart}
                  onChange={(event) =>
                    setScheduledStart(
                      event.target.value
                    )
                  }
                  className="rj-input"
                  required
                  disabled={hasStarted || historical}
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
                  disabled={hasStarted || historical}
                />
              </div>
            </FormField>

            <FormField label="Location">
              <div className="relative">
                <input
                  type="text"
                  value={location}
                  disabled={historical}
                  onChange={(event) =>
                    setLocation(event.target.value)
                  }
                  placeholder="Room, classroom, clinic…"
                  className="rj-input"
                />
              </div>
            </FormField>

            <FormField label={t("Session status")}>
              <select
                value={status}
                disabled={hasStarted || historical}
                onChange={(event) =>
                  setStatus(
                    event.target.value as SessionStatus
                  )
                }
                className="rj-input"
              >
                {SESSION_STATUSES.filter(option => option.value === session.status || !["in_progress","paused","completed"].includes(option.value)).map((option) => (
                  <option
                    key={option.value}
                    value={option.value}
                  >
                    {option.label}
                  </option>
                ))}
              </select>
            </FormField>

            <FormField label="Attendance">
              <select
                value={attendanceStatus}
                disabled={historical}
                onChange={(event) =>
                  setAttendanceStatus(
                    event.target
                      .value as AttendanceStatus
                  )
                }
                className="rj-input"
              >
                {ATTENDANCE_STATUSES.map(
                  (option) => (
                    <option
                      key={option.value}
                      value={option.value}
                    >
                      {option.label}
                    </option>
                  )
                )}
              </select>
            </FormField>

            <label className="flex min-h-14 items-center gap-3 rounded-[var(--rj-radius-md)] bg-[var(--rj-surface-muted)] px-4 py-3">
              <input
                type="checkbox"
                checked={wasSupervised}
                disabled={historical}
                onChange={(event) =>
                  setWasSupervised(
                    event.target.checked
                  )
                }
                className="h-5 w-5 accent-[var(--rj-teal-700)]"
              />

              <div>
                <p className="font-bold">{t("Session was supervised")}</p>

                <p className="rj-caption mt-0.5">
                  This will be included in documentation.
                </p>
              </div>
            </label>

            </fieldset>
          </form></SubscriptionWriteControls>
          </>}

          {!editing && canManage && !hasStarted &&
            session.status !== "canceled" && (
              <SubscriptionWriteControls><button
                type="button"
                onClick={handleCancelSession}
                disabled={savingSession || historical}
                className="rj-button rj-button-danger mt-3 w-full"
              >
                <XCircle size={19} />{t("Cancel Session")}</button></SubscriptionWriteControls>
            )}

          {hasStarted && (
            <div className="mt-5 rounded-[var(--rj-radius-md)] bg-[var(--rj-warning-soft)] p-4">
              <p className="text-sm font-bold text-[#926c22]">{t("Assignment and schedule fields are locked because this session has already started.")}</p>
            </div>
          )}
        </section>

        {/* Target Pack */}
        {!editing && <div className="space-y-6">
          <section className="rj-card overflow-hidden">
            <div className="border-b border-[var(--rj-border)] p-6">
              <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                <div>
                  <p className="rj-label">{t("Session Pack")}</p>

                  <h2 className="rj-heading-2 mt-1">{t("Prepared Targets")}</h2>

                  <p className="rj-caption mt-2">{t("These targets appear in the frontline Session Workspace.")}</p>
                </div>

                {canEditPreparation && (
                  <SubscriptionWriteControls><button
                    type="button"
                    onClick={
                      handlePrepareActiveTargets
                    }
                    disabled={preparingTargets}
                    className="rj-button rj-button-secondary"
                  >
                    {preparingTargets ? (
                      <LoaderCircle
                        size={18}
                        className="animate-spin"
                      />
                    ) : (
                      <RotateCcw size={18} />
                    )}{t("Sync Active Targets")}</button></SubscriptionWriteControls>
                )}
              </div>
            </div>

            {sessionTargets.length === 0 ? (
              <div className="p-10 text-center">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[var(--rj-lavender-100)] text-[var(--rj-lavender-700)]">
                  <ListChecks size={28} />
                </div>

                <h3 className="rj-heading-3 mt-4">{t("No prepared targets")}</h3>

                <p className="rj-caption mx-auto mt-2 max-w-sm">{t("Sync the client’s active targets or add selected targets below.")}</p>

                {canEditPreparation && (
                  <SubscriptionWriteControls><button
                    type="button"
                    onClick={
                      handlePrepareActiveTargets
                    }
                    disabled={preparingTargets}
                    className="rj-button rj-button-primary mt-6"
                  >
                    <Sparkles size={19} />{t("Prepare Targets")}</button></SubscriptionWriteControls>
                )}
              </div>
            ) : (
              <div className="divide-y divide-[var(--rj-border)]">
                {sessionTargets.map(
                  (target, index) => {
                    const responseCount =
                      responseCountByTarget.get(
                        target.id
                      ) || 0

                    const isUpdating =
                      updatingTargetId === target.id

                    return (
                      <article
                        key={target.id}
                        className="p-5 sm:p-6"
                      >
                        <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-start">
                          <div className="flex min-w-0 gap-4">
                            <div
                              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${
                                target.status ===
                                "completed"
                                  ? "bg-[var(--rj-success-soft)] text-[var(--rj-mint-700)]"
                                  : "bg-[var(--rj-blue-100)] text-[var(--rj-blue-700)]"
                              }`}
                            >
                              {target.status ===
                              "completed" ? (
                                <Check
                                  size={21}
                                  strokeWidth={3}
                                />
                              ) : (
                                <span className="font-bold">
                                  {index + 1}
                                </span>
                              )}
                            </div>

                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <h3 className="font-bold">
                                  {target.title}
                                </h3>

                                <span className="rj-badge rj-badge-info">
                                  {formatLabel(
                                    target.status
                                  )}
                                </span>

                                {responseCount > 0 && (
                                  <span className="rj-badge rj-badge-success">
                                    {responseCount} response
                                    {responseCount === 1
                                      ? ""
                                      : "s"}
                                  </span>
                                )}
                              </div>

                              <p className="rj-caption mt-1">
                                {target.category ||
                                  "General target"}
                              </p>

                              {target.instruction && (
                                <p className="rj-body mt-3 text-[var(--rj-text-secondary)]">
                                  {target.instruction}
                                </p>
                              )}

                              {target.materials && (
                                <div className="mt-3 rounded-[var(--rj-radius-md)] bg-[var(--rj-surface-muted)] p-3">
                                  <p className="text-sm">
                                    <strong>
                                      Materials:
                                    </strong>{" "}
                                    {target.materials}
                                  </p>
                                </div>
                              )}
                            </div>
                          </div>

                          {canEditPreparation && (
                            <div className="flex shrink-0 gap-2">
                              <SubscriptionWriteControls><button
                                type="button"
                                onClick={() =>
                                  moveTarget(
                                    index,
                                    "up"
                                  )
                                }
                                disabled={
                                  index === 0 ||
                                  isUpdating
                                }
                                aria-label={`Move ${target.title} up`}
                                className="rj-icon-button disabled:opacity-35"
                              >
                                <ArrowUp size={18} />
                              </button></SubscriptionWriteControls>

                              <SubscriptionWriteControls><button
                                type="button"
                                onClick={() =>
                                  moveTarget(
                                    index,
                                    "down"
                                  )
                                }
                                disabled={
                                  index ===
                                    sessionTargets.length -
                                      1 ||
                                  isUpdating
                                }
                                aria-label={`Move ${target.title} down`}
                                className="rj-icon-button disabled:opacity-35"
                              >
                                <ArrowDown size={18} />
                              </button></SubscriptionWriteControls>

                              <SubscriptionWriteControls><button
                                type="button"
                                onClick={() =>
                                  removeTargetFromSession(
                                    target
                                  )
                                }
                                disabled={
                                  isUpdating ||
                                  responseCount > 0
                                }
                                aria-label={`Remove ${target.title}`}
                                className="rj-icon-button text-[var(--rj-danger)] disabled:opacity-35"
                              >
                                {isUpdating ? (
                                  <LoaderCircle
                                    size={18}
                                    className="animate-spin"
                                  />
                                ) : (
                                  <Trash2 size={18} />
                                )}
                              </button></SubscriptionWriteControls>
                            </div>
                          )}
                        </div>
                      </article>
                    )
                  }
                )}
              </div>
            )}
          </section>

          {/* Available Client Targets */}
          <section className="rj-card overflow-hidden">
            <div className="border-b border-[var(--rj-border)] p-6">
              <p className="rj-label">{t("Client Program")}</p>

              <h2 className="rj-heading-2 mt-1">{t("Available Targets")}</h2>

              <p className="rj-caption mt-2">{t("Active client targets not currently included in this session.")}</p>
            </div>

            {!canEditPreparation ? (
              <div className="p-8 text-center">
                <PauseCircle
                  size={30}
                  className="mx-auto text-[var(--rj-text-muted)]"
                />

                <p className="mt-4 font-bold">{t("Target preparation is locked")}</p>

                <p className="rj-caption mt-1">{t("Targets cannot be added or removed after the session begins.")}</p>
              </div>
            ) : availableTargets.length === 0 ? (
              <div className="p-8 text-center">
                <CheckCircle2
                  size={31}
                  className="mx-auto text-[var(--rj-mint-700)]"
                />

                <p className="mt-4 font-bold">{t("All active targets are included")}</p>

                <p className="rj-caption mt-1">{t("This session pack is up to date with the client’s active program.")}</p>
              </div>
            ) : (
              <div className="divide-y divide-[var(--rj-border)]">
                {availableTargets.map((target) => (
                  <article
                    key={target.id}
                    className="flex flex-col justify-between gap-4 p-5 sm:flex-row sm:items-center"
                  >
                    <div>
                      <h3 className="font-bold">
                        {target.title}
                      </h3>

                      <p className="rj-caption mt-1">
                        {target.category ||
                          "General target"}
                      </p>

                      {target.instruction && (
                        <p className="mt-2 line-clamp-2 text-sm text-[var(--rj-text-secondary)]">
                          {target.instruction}
                        </p>
                      )}
                    </div>

                    <SubscriptionWriteControls><button
                      type="button"
                      onClick={() =>
                        addTargetToSession(target)
                      }
                      disabled={
                        Boolean(addingTargetId)
                      }
                      className="rj-button rj-button-secondary shrink-0"
                    >
                      {addingTargetId ===
                      target.id ? (
                        <LoaderCircle
                          size={18}
                          className="animate-spin"
                        />
                      ) : (
                        <Plus size={18} />
                      )}

                      Add
                    </button></SubscriptionWriteControls>
                  </article>
                ))}
              </div>
            )}
          </section>

          <Link href={`/reviews/${sessionId}`} className="rj-button rj-button-secondary">Open note and history</Link>
          {/* Session Timeline */}
          <section className="rj-card p-6">
            <p className="rj-label">
              Activity
            </p>

            <h2 className="rj-heading-2 mt-1">{t("Session Timeline")}</h2>

            <div className="mt-6 space-y-5">
              <TimelineItem
                label={t("Session created")}
                value={formatDateTime(
                  session.created_at
                )}
                icon={CalendarDays}
              />

              <TimelineItem
                label={t("Targets prepared")}
                value={
                  session.prepared_at
                    ? formatDateTime(
                        session.prepared_at
                      )
                    : "Not prepared"
                }
                icon={ListChecks}
              />

              <TimelineItem
                label={t("Session started")}
                value={
                  session.started_at
                    ? formatDateTime(
                        session.started_at
                      )
                    : "Not started"
                }
                icon={ArrowRight}
              />

              <TimelineItem
                label={t("Session completed")}
                value={
                  session.completed_at
                    ? formatDateTime(
                        session.completed_at
                      )
                    : "Not completed"
                }
                icon={CheckCircle2}
              />

              <TimelineItem
                label={t("Session note")}
                value={
                  sessionNote
                    ? formatLabel(
                        sessionNote.status
                      )
                    : "Not created"
                }
                icon={FileText}
              />
            </div>
          </section>
        </div>}
      </div>
    </div>
  )
}

function SessionDetailLoading() {
  const { t } = usePortal()

  return (
    <div className="flex min-h-[65vh] items-center justify-center">
      <div className="text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[var(--rj-teal-100)]">
          <LoaderCircle
            size={30}
            className="animate-spin text-[var(--rj-teal-700)]"
          />
        </div>

        <p className="rj-body mt-4 text-[var(--rj-text-secondary)]">{t("Loading session details…")}</p>
      </div>
    </div>
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

function OverviewCard({
  label,
  value,
  icon: Icon,
  background,
  foreground,
}: {
  label: string
  value: string
  icon: typeof CalendarDays
  background: string
  foreground: string
}) {
  return (
    <article className="rj-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="rj-label">
            {label}
          </p>

          <p className="mt-2 truncate text-xl font-extrabold">
            {value}
          </p>
        </div>

        <div
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full"
          style={{
            background,
            color: foreground,
          }}
        >
          <Icon size={22} />
        </div>
      </div>
    </article>
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

function PreparationBadge({
  prepared,
}: {
  prepared: boolean
}) {
  const { t } = usePortal()

  return (
    <span
      className={`rj-badge ${
        prepared
          ? "rj-badge-success"
          : "rj-badge-warning"
      }`}
    >
      {prepared ? (
        <Check size={14} />
      ) : (
        <CircleAlert size={14} />
      )}

      {prepared
        ? t("Targets prepared")
        : "Needs preparation"}
    </span>
  )
}

function MessageBanner({
  tone,
  title,
  message,
}: {
  tone: "success" | "danger"
  title: string
  message: string
}) {
  const isSuccess = tone === "success"

  return (
    <div
      role={isSuccess ? "status" : "alert"}
      className={`rounded-[var(--rj-radius-md)] border p-4 ${
        isSuccess
          ? "border-[var(--rj-success)]/30 bg-[var(--rj-success-soft)]"
          : "border-[var(--rj-danger)]/20 bg-[var(--rj-danger-soft)]"
      }`}
    >
      <div className="flex gap-3">
        {isSuccess ? (
          <CheckCircle2
            size={22}
            className="shrink-0 text-[var(--rj-mint-700)]"
          />
        ) : (
          <CircleAlert
            size={22}
            className="shrink-0 text-[var(--rj-danger)]"
          />
        )}

        <div>
          <p
            className={`font-bold ${
              isSuccess
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

function TimelineItem({
  label,
  value,
  icon: Icon,
}: {
  label: string
  value: string
  icon: typeof CalendarDays
}) {
  return (
    <div className="flex gap-4">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--rj-blue-100)] text-[var(--rj-blue-700)]">
        <Icon size={18} />
      </div>

      <div>
        <p className="font-bold">
          {label}
        </p>

        <p className="rj-caption mt-1">
          {value}
        </p>
      </div>
    </div>
  )
}

function toDateTimeLocal(
  value: string | null
): string {
  if (!value) return ""

  const date = new Date(value)

  const timezoneOffset =
    date.getTimezoneOffset() * 60_000

  return new Date(
    date.getTime() - timezoneOffset
  )
    .toISOString()
    .slice(0, 16)
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
  const endDate = end
    ? new Date(end)
    : null

  const dateText =
    new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
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

function formatDateTime(
  value: string
): string {
  const date = new Date(value)

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date)
}
