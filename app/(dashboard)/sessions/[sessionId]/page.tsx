"use client"

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  CalendarDays,
  Check,
  CheckCircle2,
  CircleAlert,
  Clock3,
  ExternalLink,
  FileText,
  ListChecks,
  LoaderCircle,
  MapPin,
  PauseCircle,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Sparkles,
  Trash2,
  UserRound,
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

const SESSION_TYPES = [
  {
    value: "direct_therapy",
    label: "Direct service",
  },
  {
    value: "education_support",
    label: "Education support",
  },
  {
    value: "classroom_support",
    label: "Classroom support",
  },
  {
    value: "care_session",
    label: "Care session",
  },
  {
    value: "assessment",
    label: "Assessment",
  },
]

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

export default function AdminSessionDetailPage() {
  const params = useParams<{ sessionId: string }>()
  const router = useRouter()

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

  const canEditPreparation =
    session?.status === "scheduled" ||
    session?.status === "confirmed"

  const handleSaveSession = async (
    event: FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault()

    if (!session) return

    if (
      !providerId ||
      !scheduledStart ||
      !scheduledEnd
    ) {
      setPageError(
        "An assigned team member, start time, and end time are required."
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
        "Enter a valid start and end time."
      )
      return
    }

    if (endDate <= startDate) {
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
          provider_id: providerId,
          session_type: sessionType,
          scheduled_start: startDate.toISOString(),
          scheduled_end: endDate.toISOString(),
          location: location.trim() || null,
          status,
          attendance_status: attendanceStatus,
          was_supervised: wasSupervised,
        })
        .eq("id", sessionId)

      if (error) {
        throw new Error(error.message)
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
      /*
       * Use temporary sort order to avoid collisions while
       * swapping two rows.
       */
      const temporarySortOrder = -1000000

      const { error: temporaryError } =
        await supabase
          .from("session_targets")
          .update({
            sort_order: temporarySortOrder,
          })
          .eq("id", currentTarget.id)

      if (temporaryError) {
        throw new Error(temporaryError.message)
      }

      const { error: otherError } =
        await supabase
          .from("session_targets")
          .update({
            sort_order: currentTarget.sort_order,
          })
          .eq("id", otherTarget.id)

      if (otherError) {
        throw new Error(otherError.message)
      }

      const { error: currentError } =
        await supabase
          .from("session_targets")
          .update({
            sort_order: otherTarget.sort_order,
          })
          .eq("id", currentTarget.id)

      if (currentError) {
        throw new Error(currentError.message)
      }

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
    if (!session || hasStarted) return

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

  if (!session || !client) {
    return (
      <div className="mx-auto max-w-xl">
        <section className="rj-card p-8 text-center">
          <CircleAlert
            size={36}
            className="mx-auto text-[var(--rj-danger)]"
          />

          <h1 className="rj-heading-2 mt-4">
            Session unavailable
          </h1>

          <p className="rj-body mt-2 text-[var(--rj-text-secondary)]">
            {pageError ||
              "This session could not be loaded."}
          </p>

          <Link
            href="/sessions"
            className="rj-button rj-button-primary mt-6"
          >
            <ArrowLeft size={19} />
            Back to Sessions
          </Link>
        </section>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center justify-between gap-4">
        <Link
          href="/sessions"
          className="inline-flex items-center gap-2 font-bold text-[var(--rj-teal-700)]"
        >
          <ArrowLeft size={18} />
          Sessions
        </Link>

        <button
          type="button"
          onClick={() => loadPage(true)}
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
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-full bg-[var(--rj-teal-50)] px-3 py-1.5 text-sm font-bold text-[var(--rj-teal-700)]">
                <Sparkles size={15} />
                Session Administration
              </span>

              <SessionStatusBadge status={session.status} />

              <PreparationBadge
                prepared={
                  Boolean(session.prepared_at) &&
                  sessionTargets.length > 0
                }
              />
            </div>

            <h1 className="rj-heading-1 mt-4">
              {clientName}
            </h1>

            <p className="rj-body mt-3 text-[var(--rj-text-secondary)]">
              {formatDateRange(
                session.scheduled_start,
                session.scheduled_end
              )}
            </p>

            <p className="rj-caption mt-1">
              {formatLabel(session.session_type)}
              {session.location
                ? ` · ${session.location}`
                : ""}
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
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
          </div>
        </div>
      </header>

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
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
          label="Prepared targets"
          value={`${sessionTargets.length}`}
          icon={ListChecks}
          background="var(--rj-lavender-100)"
          foreground="var(--rj-lavender-700)"
        />

        <OverviewCard
          label="Completed targets"
          value={`${completedTargetCount}`}
          icon={CheckCircle2}
          background="var(--rj-mint-100)"
          foreground="var(--rj-mint-700)"
        />

        <OverviewCard
          label="Session note"
          value={
            sessionNote
              ? formatLabel(sessionNote.status)
              : "Not started"
          }
          icon={FileText}
          background="var(--rj-teal-100)"
          foreground="var(--rj-teal-700)"
        />
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(330px,420px)_minmax(0,1fr)]">
        {/* Session Details */}
        <section className="rj-card h-fit p-6">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--rj-blue-100)] text-[var(--rj-blue-700)]">
              <CalendarDays size={23} />
            </div>

            <div>
              <p className="rj-label">
                Session Details
              </p>

              <h2 className="rj-heading-2 mt-1">
                Schedule and assignment
              </h2>
            </div>
          </div>

          <form
            onSubmit={handleSaveSession}
            className="mt-6 space-y-5"
          >
            <FormField label="Assigned frontline worker">
              <select
                value={providerId}
                onChange={(event) =>
                  setProviderId(event.target.value)
                }
                className="rj-input"
                required
                disabled={hasStarted}
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
                    — {formatLabel(provider.role)}
                  </option>
                ))}
              </select>
            </FormField>

            <FormField label="Session type">
              <select
                value={sessionType}
                onChange={(event) =>
                  setSessionType(event.target.value)
                }
                className="rj-input"
                disabled={hasStarted}
              >
                {SESSION_TYPES.map((type) => (
                  <option
                    key={type.value}
                    value={type.value}
                  >
                    {type.label}
                  </option>
                ))}
              </select>
            </FormField>

            <FormField label="Start">
              <div className="relative">
                <CalendarDays
                  size={18}
                  className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--rj-text-muted)]"
                />

                <input
                  type="datetime-local"
                  value={scheduledStart}
                  onChange={(event) =>
                    setScheduledStart(
                      event.target.value
                    )
                  }
                  className="rj-input pl-11"
                  required
                  disabled={hasStarted}
                />
              </div>
            </FormField>

            <FormField label="End">
              <div className="relative">
                <Clock3
                  size={18}
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
                  className="rj-input pl-11"
                  required
                  disabled={hasStarted}
                />
              </div>
            </FormField>

            <FormField label="Location">
              <div className="relative">
                <MapPin
                  size={18}
                  className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--rj-text-muted)]"
                />

                <input
                  type="text"
                  value={location}
                  onChange={(event) =>
                    setLocation(event.target.value)
                  }
                  placeholder="Room, classroom, clinic…"
                  className="rj-input pl-11"
                />
              </div>
            </FormField>

            <FormField label="Session status">
              <select
                value={status}
                onChange={(event) =>
                  setStatus(
                    event.target.value as SessionStatus
                  )
                }
                className="rj-input"
              >
                {SESSION_STATUSES.map((option) => (
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
                onChange={(event) =>
                  setWasSupervised(
                    event.target.checked
                  )
                }
                className="h-5 w-5 accent-[var(--rj-teal-700)]"
              />

              <div>
                <p className="font-bold">
                  Session was supervised
                </p>

                <p className="rj-caption mt-0.5">
                  This will be included in documentation.
                </p>
              </div>
            </label>

            <button
              type="submit"
              disabled={savingSession}
              className="rj-button rj-button-primary w-full"
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
                : "Save Session"}
            </button>
          </form>

          {!hasStarted &&
            session.status !== "canceled" && (
              <button
                type="button"
                onClick={handleCancelSession}
                disabled={savingSession}
                className="rj-button rj-button-danger mt-3 w-full"
              >
                <XCircle size={19} />
                Cancel Session
              </button>
            )}

          {hasStarted && (
            <div className="mt-5 rounded-[var(--rj-radius-md)] bg-[var(--rj-warning-soft)] p-4">
              <p className="text-sm font-bold text-[#926c22]">
                Assignment and schedule fields are locked
                because this session has already started.
              </p>
            </div>
          )}
        </section>

        {/* Target Pack */}
        <div className="space-y-6">
          <section className="rj-card overflow-hidden">
            <div className="border-b border-[var(--rj-border)] p-6">
              <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                <div>
                  <p className="rj-label">
                    Session Pack
                  </p>

                  <h2 className="rj-heading-2 mt-1">
                    Prepared Targets
                  </h2>

                  <p className="rj-caption mt-2">
                    These targets appear in the frontline
                    Session Workspace.
                  </p>
                </div>

                {canEditPreparation && (
                  <button
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
                    )}

                    Sync Active Targets
                  </button>
                )}
              </div>
            </div>

            {sessionTargets.length === 0 ? (
              <div className="p-10 text-center">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[var(--rj-lavender-100)] text-[var(--rj-lavender-700)]">
                  <ListChecks size={28} />
                </div>

                <h3 className="rj-heading-3 mt-4">
                  No prepared targets
                </h3>

                <p className="rj-caption mx-auto mt-2 max-w-sm">
                  Sync the client’s active targets or add
                  selected targets below.
                </p>

                {canEditPreparation && (
                  <button
                    type="button"
                    onClick={
                      handlePrepareActiveTargets
                    }
                    disabled={preparingTargets}
                    className="rj-button rj-button-primary mt-6"
                  >
                    <Sparkles size={19} />
                    Prepare Targets
                  </button>
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
                              <button
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
                              </button>

                              <button
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
                              </button>

                              <button
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
                              </button>
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
              <p className="rj-label">
                Client Program
              </p>

              <h2 className="rj-heading-2 mt-1">
                Available Targets
              </h2>

              <p className="rj-caption mt-2">
                Active client targets not currently included
                in this session.
              </p>
            </div>

            {!canEditPreparation ? (
              <div className="p-8 text-center">
                <PauseCircle
                  size={30}
                  className="mx-auto text-[var(--rj-text-muted)]"
                />

                <p className="mt-4 font-bold">
                  Target preparation is locked
                </p>

                <p className="rj-caption mt-1">
                  Targets cannot be added or removed after
                  the session begins.
                </p>
              </div>
            ) : availableTargets.length === 0 ? (
              <div className="p-8 text-center">
                <CheckCircle2
                  size={31}
                  className="mx-auto text-[var(--rj-mint-700)]"
                />

                <p className="mt-4 font-bold">
                  All active targets are included
                </p>

                <p className="rj-caption mt-1">
                  This session pack is up to date with the
                  client’s active program.
                </p>
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

                    <button
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
                    </button>
                  </article>
                ))}
              </div>
            )}
          </section>

          {/* Session Timeline */}
          <section className="rj-card p-6">
            <p className="rj-label">
              Activity
            </p>

            <h2 className="rj-heading-2 mt-1">
              Session Timeline
            </h2>

            <div className="mt-6 space-y-5">
              <TimelineItem
                label="Session created"
                value={formatDateTime(
                  session.created_at
                )}
                icon={CalendarDays}
              />

              <TimelineItem
                label="Targets prepared"
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
                label="Session started"
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
                label="Session completed"
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
                label="Session note"
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
        </div>
      </div>
    </div>
  )
}

function SessionDetailLoading() {
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
          Loading session details…
        </p>
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
      <div className="flex items-start justify-between gap-4">
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
        ? "Targets prepared"
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