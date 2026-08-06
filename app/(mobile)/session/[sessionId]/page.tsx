"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Clock3,
  LoaderCircle,
  Mic,
  Minus,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Sparkles,
  Square,
} from "lucide-react"

import { supabase } from "@/lib/supabase"

type TargetResult =
  | "independent"
  | "prompted"
  | "retry"
  | "correct"
  | "incorrect"
  | "skipped"
  | "not_applicable"

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

type SessionRecord = {
  id: string
  organization_id: string
  client_id: string
  provider_id: string | null
  status: SessionStatus
  attendance_status: string
  scheduled_start: string | null
  scheduled_end: string | null
  started_at: string | null
  paused_at: string | null
  completed_at: string | null
  total_paused_seconds: number
  was_supervised: boolean
}

type ClientRecord = {
  id: string
  first_name: string
  preferred_name: string | null
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

type TargetResponseRecord = {
  id: string
  session_id: string
  session_target_id: string
  result: TargetResult
  prompt_level: string | null
  trial_number: number
  notes: string | null
  recorded_at: string
}

type ClientBehaviorRecord = {
  id: string
  client_id: string
  name: string
  description: string | null
  measurement_type: string
  active: boolean
  sort_order: number
}

type BehaviorEventRecord = {
  id: string
  session_id: string
  client_behavior_id: string | null
  behavior_name: string
  count: number
  occurred_at: string
}

type DisplayTarget = SessionTargetRecord & {
  latestResult?: TargetResult
  trialCount: number
}

type DisplayBehavior = ClientBehaviorRecord & {
  count: number
}

export default function ActiveSessionPage() {
  const router = useRouter()
  const params = useParams<{ sessionId: string }>()

  const sessionId = params.sessionId

  const [session, setSession] = useState<SessionRecord | null>(null)
  const [client, setClient] = useState<ClientRecord | null>(null)

  const [targets, setTargets] = useState<DisplayTarget[]>([])
  const [behaviors, setBehaviors] = useState<DisplayBehavior[]>([])

  const [activeTargetId, setActiveTargetId] = useState<string | null>(
    null
  )

  const [voiceNote, setVoiceNote] = useState("")
  const [isRecording, setIsRecording] = useState(false)

  const [elapsedSeconds, setElapsedSeconds] = useState(0)

  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState<string | null>(null)

  const [sessionActionLoading, setSessionActionLoading] =
    useState(false)

  const [savingTargetId, setSavingTargetId] =
    useState<string | null>(null)

  const [savingBehaviorId, setSavingBehaviorId] =
    useState<string | null>(null)

  /*
   * Calculate elapsed session time from database timestamps.
   * We do not save a new timer value every second.
   */
  const calculateElapsedSeconds = useCallback(
    (sessionRecord: SessionRecord) => {
      if (!sessionRecord.started_at) {
        return 0
      }

      const startedAt = new Date(
        sessionRecord.started_at
      ).getTime()

      const endingTimestamp =
        sessionRecord.status === "paused" &&
        sessionRecord.paused_at
          ? new Date(sessionRecord.paused_at).getTime()
          : sessionRecord.completed_at
            ? new Date(sessionRecord.completed_at).getTime()
            : Date.now()

      const totalSeconds = Math.floor(
        (endingTimestamp - startedAt) / 1000
      )

      return Math.max(
        0,
        totalSeconds -
          (sessionRecord.total_paused_seconds || 0)
      )
    },
    []
  )

  /*
   * Load everything needed by the Session Workspace.
   */
  const fetchSessionWorkspace = useCallback(async () => {
    if (!sessionId) return

    setPageError(null)

    try {
      const { data: sessionData, error: sessionError } =
        await supabase
          .from("sessions")
          .select(`
            id,
            organization_id,
            client_id,
            provider_id,
            status,
            attendance_status,
            scheduled_start,
            scheduled_end,
            started_at,
            paused_at,
            completed_at,
            total_paused_seconds,
            was_supervised
          `)
          .eq("id", sessionId)
          .single()

      if (sessionError) {
        throw new Error(sessionError.message)
      }

      const typedSession = sessionData as SessionRecord

      setSession(typedSession)
      setElapsedSeconds(
        calculateElapsedSeconds(typedSession)
      )

      const [
        clientResult,
        targetResult,
        responseResult,
        behaviorResult,
        eventResult,
      ] = await Promise.all([
        supabase
          .from("clients")
          .select("id, first_name, preferred_name")
          .eq("id", typedSession.client_id)
          .single(),

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
          .order("sort_order", { ascending: true }),

        supabase
          .from("target_responses")
          .select(`
            id,
            session_id,
            session_target_id,
            result,
            prompt_level,
            trial_number,
            notes,
            recorded_at
          `)
          .eq("session_id", sessionId)
          .order("recorded_at", { ascending: false }),

        supabase
          .from("client_behaviors")
          .select(`
            id,
            client_id,
            name,
            description,
            measurement_type,
            active,
            sort_order
          `)
          .eq("client_id", typedSession.client_id)
          .eq("active", true)
          .order("sort_order", { ascending: true }),

        supabase
          .from("behavior_events")
          .select(`
            id,
            session_id,
            client_behavior_id,
            behavior_name,
            count,
            occurred_at
          `)
          .eq("session_id", sessionId)
          .order("occurred_at", { ascending: false }),
      ])

      if (clientResult.error) {
        throw new Error(clientResult.error.message)
      }

      if (targetResult.error) {
        throw new Error(targetResult.error.message)
      }

      if (responseResult.error) {
        throw new Error(responseResult.error.message)
      }

      if (behaviorResult.error) {
        throw new Error(behaviorResult.error.message)
      }

      if (eventResult.error) {
        throw new Error(eventResult.error.message)
      }

      setClient(clientResult.data as ClientRecord)

      const sessionTargets =
        (targetResult.data || []) as SessionTargetRecord[]

      const responses =
        (responseResult.data || []) as TargetResponseRecord[]

      const clientBehaviors =
        (behaviorResult.data || []) as ClientBehaviorRecord[]

      const behaviorEvents =
        (eventResult.data || []) as BehaviorEventRecord[]

      /*
       * target_responses were loaded newest first.
       * The first matching response is the most recent.
       */
      const targetsWithResponses: DisplayTarget[] =
        sessionTargets.map((target) => {
          const targetResponses = responses.filter(
            (response) =>
              response.session_target_id === target.id
          )

          return {
            ...target,
            latestResult: targetResponses[0]?.result,
            trialCount: targetResponses.length,
          }
        })

      setTargets(targetsWithResponses)

      const behaviorCounts = new Map<string, number>()

      behaviorEvents.forEach((event) => {
        if (!event.client_behavior_id) return

        behaviorCounts.set(
          event.client_behavior_id,
          (behaviorCounts.get(
            event.client_behavior_id
          ) || 0) + event.count
        )
      })

      const behaviorsWithCounts: DisplayBehavior[] =
        clientBehaviors.map((behavior) => ({
          ...behavior,
          count: behaviorCounts.get(behavior.id) || 0,
        }))

      setBehaviors(behaviorsWithCounts)

      /*
       * Keep the existing active target when possible.
       * Otherwise, open the first unfinished target.
       */
      setActiveTargetId((currentId) => {
        const currentTargetStillAvailable =
          targetsWithResponses.some(
            (target) =>
              target.id === currentId &&
              target.status !== "completed" &&
              target.status !== "skipped"
          )

        if (currentTargetStillAvailable) {
          return currentId
        }

        return (
          targetsWithResponses.find(
            (target) =>
              target.status === "active" ||
              target.status === "pending"
          )?.id || null
        )
      })
    } catch (error) {
      console.error("Load session workspace error:", error)

      setPageError(
        error instanceof Error
          ? error.message
          : "Unable to load this session."
      )
    } finally {
      setLoading(false)
    }
  }, [calculateElapsedSeconds, sessionId])

  useEffect(() => {
    fetchSessionWorkspace()
  }, [fetchSessionWorkspace])

  /*
   * Update the displayed timer locally.
   * The database remains the source of truth.
   */
  useEffect(() => {
    if (!session || session.status !== "in_progress") {
      return
    }

    const timer = window.setInterval(() => {
      setElapsedSeconds(
        calculateElapsedSeconds(session)
      )
    }, 1000)

    return () => {
      window.clearInterval(timer)
    }
  }, [calculateElapsedSeconds, session])

  const clientDisplayName =
    client?.preferred_name?.trim() ||
    client?.first_name ||
    "Client"

  const formattedTime = useMemo(() => {
    const hours = Math.floor(elapsedSeconds / 3600)

    const minutes = Math.floor(
      (elapsedSeconds % 3600) / 60
    )

    const seconds = elapsedSeconds % 60

    if (hours > 0) {
      return `${String(hours).padStart(2, "0")}:${String(
        minutes
      ).padStart(2, "0")}:${String(seconds).padStart(
        2,
        "0"
      )}`
    }

    return `${String(minutes).padStart(2, "0")}:${String(
      seconds
    ).padStart(2, "0")}`
  }, [elapsedSeconds])

  const completedTargets = targets.filter(
    (target) => target.status === "completed"
  ).length

  const progressPercentage =
    targets.length === 0
      ? 0
      : Math.round(
          (completedTargets / targets.length) * 100
        )

  const activeTarget = targets.find(
    (target) => target.id === activeTargetId
  )

  const sessionIsRunning =
    session?.status === "in_progress"

  const sessionIsPaused = session?.status === "paused"

  const sessionHasStarted =
    sessionIsRunning ||
    sessionIsPaused ||
    session?.status === "completed"

  const runSessionAction = async (
    functionName:
      | "start_assigned_session"
      | "pause_assigned_session"
      | "resume_assigned_session"
  ) => {
    if (!sessionId || sessionActionLoading) return

    setSessionActionLoading(true)
    setPageError(null)

    try {
      const { error } = await supabase.rpc(functionName, {
        requested_session_id: sessionId,
      })

      if (error) {
        throw new Error(error.message)
      }

      await fetchSessionWorkspace()
    } catch (error) {
      console.error(`${functionName} error:`, error)

      setPageError(
        error instanceof Error
          ? error.message
          : "Unable to update the session."
      )
    } finally {
      setSessionActionLoading(false)
    }
  }

  const recordTargetResult = async (
    targetId: string,
    result: TargetResult
  ) => {
    if (
      !sessionIsRunning ||
      savingTargetId ||
      !targetId
    ) {
      return
    }

    setSavingTargetId(targetId)
    setPageError(null)

    try {
      const { error } = await supabase.rpc(
        "record_target_response",
        {
          requested_session_target_id: targetId,
          requested_result: result,
          requested_prompt_level: null,
          requested_notes: null,
        }
      )

      if (error) {
        throw new Error(error.message)
      }

      await fetchSessionWorkspace()
    } catch (error) {
      console.error("Record target response error:", error)

      setPageError(
        error instanceof Error
          ? error.message
          : "Unable to save this response."
      )
    } finally {
      setSavingTargetId(null)
    }
  }

  const increaseBehavior = async (
    behaviorId: string
  ) => {
    if (
      !sessionIsRunning ||
      savingBehaviorId ||
      !sessionId
    ) {
      return
    }

    setSavingBehaviorId(behaviorId)
    setPageError(null)

    /*
     * Optimistic update keeps the button feeling immediate.
     */
    setBehaviors((currentBehaviors) =>
      currentBehaviors.map((behavior) =>
        behavior.id === behaviorId
          ? {
              ...behavior,
              count: behavior.count + 1,
            }
          : behavior
      )
    )

    try {
      const { error } = await supabase.rpc(
        "record_behavior_event",
        {
          requested_session_id: sessionId,
          requested_client_behavior_id: behaviorId,
          requested_duration_seconds: null,
          requested_intensity_level: null,
          requested_notes: null,
        }
      )

      if (error) {
        throw new Error(error.message)
      }
    } catch (error) {
      console.error("Record behavior event error:", error)

      /*
       * Restore database truth if the optimistic save failed.
       */
      await fetchSessionWorkspace()

      setPageError(
        error instanceof Error
          ? error.message
          : "Unable to save this behavior event."
      )
    } finally {
      setSavingBehaviorId(null)
    }
  }

  const decreaseBehavior = async (
    behaviorId: string
  ) => {
    const behavior = behaviors.find(
      (item) => item.id === behaviorId
    )

    if (
      !sessionIsRunning ||
      savingBehaviorId ||
      !sessionId ||
      !behavior ||
      behavior.count <= 0
    ) {
      return
    }

    setSavingBehaviorId(behaviorId)
    setPageError(null)

    setBehaviors((currentBehaviors) =>
      currentBehaviors.map((item) =>
        item.id === behaviorId
          ? {
              ...item,
              count: Math.max(0, item.count - 1),
            }
          : item
      )
    )

    try {
      const { error } = await supabase.rpc(
        "undo_latest_behavior_event",
        {
          requested_session_id: sessionId,
          requested_client_behavior_id: behaviorId,
        }
      )

      if (error) {
        throw new Error(error.message)
      }
    } catch (error) {
      console.error("Undo behavior event error:", error)

      await fetchSessionWorkspace()

      setPageError(
        error instanceof Error
          ? error.message
          : "Unable to undo this behavior event."
      )
    } finally {
      setSavingBehaviorId(null)
    }
  }

  const handleFinishSession = async () => {
    if (
      !sessionId ||
      sessionActionLoading ||
      !sessionHasStarted
    ) {
      return
    }

    setSessionActionLoading(true)
    setPageError(null)

    try {
      /*
       * Save the typed addendum before completing.
       * Empty text is allowed here because the structured
       * session data remains available for the note screen.
       */
      if (voiceNote.trim()) {
        const { error: noteError } = await supabase.rpc(
          "save_assigned_session_note_draft",
          {
            requested_session_id: sessionId,
            requested_therapist_addendum:
              voiceNote.trim(),
            requested_final_note: null,
          }
        )

        if (noteError) {
          throw new Error(noteError.message)
        }
      }

      const { error: finishError } = await supabase.rpc(
        "finish_assigned_session",
        {
          requested_session_id: sessionId,
        }
      )

      if (finishError) {
        throw new Error(finishError.message)
      }

      router.push(`/session/${sessionId}/complete`)
    } catch (error) {
      console.error("Finish session error:", error)

      setPageError(
        error instanceof Error
          ? error.message
          : "Unable to finish this session."
      )

      setSessionActionLoading(false)
    }
  }

  if (loading) {
    return (
      <main className="fixed inset-0 z-[60] flex items-center justify-center bg-[var(--rj-background)]">
        <div className="text-center">
          <LoaderCircle
            className="mx-auto animate-spin text-[var(--rj-teal-700)]"
            size={34}
          />

          <p className="rj-body mt-4 text-[var(--rj-text-secondary)]">
            Preparing your session…
          </p>
        </div>
      </main>
    )
  }

  if (!session || pageError && targets.length === 0) {
    return (
      <main className="fixed inset-0 z-[60] flex items-center justify-center bg-[var(--rj-background)] p-6">
        <div className="rj-card w-full max-w-md p-6 text-center">
          <CircleAlert
            className="mx-auto text-[var(--rj-danger)]"
            size={34}
          />

          <h1 className="rj-heading-2 mt-4">
            Unable to open session
          </h1>

          <p className="rj-body mt-2 text-[var(--rj-text-secondary)]">
            {pageError ||
              "This session could not be found."}
          </p>

          <button
            type="button"
            onClick={() => router.back()}
            className="rj-button rj-button-primary mt-6 w-full"
          >
            Go back
          </button>
        </div>
      </main>
    )
  }

  return (
    <main className="fixed inset-0 z-[60] overflow-y-auto bg-[var(--rj-background)]">
      <div className="mx-auto min-h-screen max-w-lg pb-44">
        <header className="sticky top-0 z-30 border-b border-[var(--rj-border)] bg-[color:var(--rj-background)]/95 px-5 pb-4 pt-[calc(1rem+env(safe-area-inset-top))] backdrop-blur">
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => router.back()}
              aria-label="Leave session"
              className="rj-icon-button shrink-0"
            >
              <ArrowLeft size={22} />
            </button>

            <div className="min-w-0 flex-1 text-center">
              <p className="truncate text-sm font-bold text-[var(--rj-text-secondary)]">
                {clientDisplayName}
              </p>

              <div className="mt-1 flex items-center justify-center gap-2">
                <span
                  className={`h-2.5 w-2.5 rounded-full ${
                    sessionIsRunning
                      ? "bg-[var(--rj-success)]"
                      : sessionIsPaused
                        ? "bg-[var(--rj-warning)]"
                        : "bg-[var(--rj-sage-500)]"
                  }`}
                />

                <span className="text-sm font-bold">
                  {getSessionStatusLabel(session.status)}
                </span>
              </div>
            </div>

            <button
              type="button"
              disabled={sessionActionLoading}
              onClick={() => {
                if (sessionIsPaused) {
                  runSessionAction(
                    "resume_assigned_session"
                  )
                } else if (sessionIsRunning) {
                  runSessionAction(
                    "pause_assigned_session"
                  )
                }
              }}
              aria-label={
                sessionIsPaused
                  ? "Resume session"
                  : "Pause session"
              }
              className="rj-icon-button shrink-0 disabled:opacity-50"
            >
              {sessionActionLoading ? (
                <LoaderCircle
                  size={21}
                  className="animate-spin"
                />
              ) : sessionIsPaused ? (
                <Play size={21} />
              ) : (
                <Pause size={21} />
              )}
            </button>
          </div>

          <div className="mt-4 flex items-center justify-between rounded-[var(--rj-radius-md)] bg-[var(--rj-blue-100)] px-4 py-3">
            <div className="flex items-center gap-2">
              <Clock3
                size={20}
                className="text-[var(--rj-blue-700)]"
              />

              <span className="text-sm font-bold text-[var(--rj-blue-700)]">
                Session time
              </span>
            </div>

            <span className="font-mono text-xl font-bold tracking-wide">
              {formattedTime}
            </span>
          </div>
        </header>

        <div className="space-y-5 px-5 py-6">
          {pageError && (
            <div className="rounded-[var(--rj-radius-md)] bg-[var(--rj-danger-soft)] p-4">
              <div className="flex gap-3">
                <CircleAlert
                  className="shrink-0 text-[var(--rj-danger)]"
                  size={21}
                />

                <p className="text-sm font-semibold text-[var(--rj-danger)]">
                  {pageError}
                </p>
              </div>
            </div>
          )}

          {!sessionHasStarted && (
            <section className="rj-card p-6 text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[var(--rj-teal-100)] text-[var(--rj-teal-700)]">
                <Play size={28} />
              </div>

              <h1 className="rj-heading-2 mt-4">
                Ready to begin?
              </h1>

              <p className="rj-body mt-2 text-[var(--rj-text-secondary)]">
                Starting confirms that you are present and
                begins the session timer.
              </p>

              <button
                type="button"
                disabled={sessionActionLoading}
                onClick={() =>
                  runSessionAction(
                    "start_assigned_session"
                  )
                }
                className="rj-button rj-button-primary mt-6 w-full"
              >
                {sessionActionLoading ? (
                  <LoaderCircle
                    size={20}
                    className="animate-spin"
                  />
                ) : (
                  <Play size={20} />
                )}

                Start session
              </button>
            </section>
          )}

          <section className="rj-card p-5">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="rj-caption">
                  Session progress
                </p>

                <p className="rj-heading-2 mt-1">
                  {completedTargets} of {targets.length} targets
                </p>
              </div>

              <div
                className="flex h-14 w-14 items-center justify-center rounded-full"
                style={{
                  background: `conic-gradient(
                    var(--rj-teal-500) ${progressPercentage}%,
                    var(--rj-surface-muted) ${progressPercentage}%
                  )`,
                }}
                aria-label={`${progressPercentage}% complete`}
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-sm font-bold">
                  {progressPercentage}%
                </div>
              </div>
            </div>
          </section>

          <section>
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="rj-label">
                  Current session
                </p>

                <h1 className="rj-heading-1 mt-1">
                  Targets
                </h1>
              </div>

              <span className="rj-badge rj-badge-info">
                <Sparkles size={14} />
                Focus mode
              </span>
            </div>

            {targets.length === 0 ? (
              <div className="rj-card p-6 text-center">
                <p className="font-bold">
                  No prepared targets
                </p>

                <p className="rj-caption mt-2">
                  An administrator must prepare this session
                  before targets appear.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {targets.map((target, index) => {
                  const isCompleted =
                    target.status === "completed"

                  const isSkipped =
                    target.status === "skipped"

                  const isActive =
                    target.id === activeTargetId &&
                    !isCompleted &&
                    !isSkipped

                  const isSaving =
                    savingTargetId === target.id

                  return (
                    <article
                      key={target.id}
                      className={`overflow-hidden border bg-white transition-all ${
                        isActive
                          ? "rounded-[var(--rj-radius-lg)] border-[var(--rj-teal-500)] shadow-[var(--rj-shadow-medium)]"
                          : "rounded-[var(--rj-radius-md)] border-[var(--rj-border)] shadow-[var(--rj-shadow-soft)]"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setActiveTargetId(
                            isActive ? null : target.id
                          )
                        }
                        className="flex min-h-16 w-full items-center gap-3 px-4 py-4 text-left"
                      >
                        <div
                          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                            isCompleted
                              ? "bg-[var(--rj-success-soft)] text-[var(--rj-mint-700)]"
                              : isSkipped
                                ? "bg-[var(--rj-warning-soft)] text-[#926c22]"
                                : isActive
                                  ? "bg-[var(--rj-teal-100)] text-[var(--rj-teal-700)]"
                                  : "bg-[var(--rj-surface-muted)]"
                          }`}
                        >
                          {isCompleted ? (
                            <Check
                              size={20}
                              strokeWidth={3}
                            />
                          ) : (
                            <span className="text-sm font-bold">
                              {index + 1}
                            </span>
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          <p className="truncate font-bold">
                            {target.title}
                          </p>

                          <p className="mt-0.5 truncate text-sm text-[var(--rj-text-secondary)]">
                            {target.latestResult
                              ? getResultLabel(
                                  target.latestResult
                                )
                              : target.category ||
                                "Session target"}
                          </p>
                        </div>

                        {isSaving ? (
                          <LoaderCircle
                            size={20}
                            className="animate-spin"
                          />
                        ) : isActive ? (
                          <ChevronUp size={20} />
                        ) : (
                          <ChevronDown size={20} />
                        )}
                      </button>

                      {isActive && (
                        <div className="border-t border-[var(--rj-border)] px-4 pb-5 pt-4">
                          {target.instruction && (
                            <div className="rounded-[var(--rj-radius-md)] bg-[var(--rj-lavender-50)] p-4">
                              <p className="rj-label">
                                Instructions
                              </p>

                              <p className="rj-body mt-2 text-[var(--rj-text-secondary)]">
                                {target.instruction}
                              </p>
                            </div>
                          )}

                          {target.materials && (
                            <div className="mt-3 rounded-[var(--rj-radius-md)] bg-[var(--rj-blue-50)] p-4">
                              <p className="rj-label">
                                Materials
                              </p>

                              <p className="rj-body mt-2 text-[var(--rj-text-secondary)]">
                                {target.materials}
                              </p>
                            </div>
                          )}

                          <p className="rj-label mb-3 mt-5">
                            Record response
                          </p>

                          <div className="grid gap-3">
                            <ResponseButton
                              label="Got it independently"
                              description="Completed without help"
                              disabled={
                                !sessionIsRunning ||
                                Boolean(savingTargetId)
                              }
                              icon={
                                <Check
                                  size={24}
                                  strokeWidth={3}
                                />
                              }
                              className="bg-[var(--rj-success-soft)] text-[var(--rj-mint-700)]"
                              onClick={() =>
                                recordTargetResult(
                                  target.id,
                                  "independent"
                                )
                              }
                            />

                            <ResponseButton
                              label="Needed help"
                              description="Prompting was required"
                              disabled={
                                !sessionIsRunning ||
                                Boolean(savingTargetId)
                              }
                              icon={<Plus size={24} />}
                              className="bg-[var(--rj-blue-100)] text-[var(--rj-blue-700)]"
                              onClick={() =>
                                recordTargetResult(
                                  target.id,
                                  "prompted"
                                )
                              }
                            />

                            <ResponseButton
                              label="Try again"
                              description="Record another opportunity"
                              disabled={
                                !sessionIsRunning ||
                                Boolean(savingTargetId)
                              }
                              icon={
                                <RotateCcw size={23} />
                              }
                              className="bg-[var(--rj-warning-soft)] text-[#926c22]"
                              onClick={() =>
                                recordTargetResult(
                                  target.id,
                                  "retry"
                                )
                              }
                            />
                          </div>
                        </div>
                      )}
                    </article>
                  )
                })}
              </div>
            )}
          </section>

          <section className="rj-card p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--rj-danger-soft)] text-[var(--rj-danger)]">
                <CircleAlert size={22} />
              </div>

              <div>
                <h2 className="rj-heading-3">
                  Behavior quick actions
                </h2>

                <p className="rj-caption mt-0.5">
                  Tap plus whenever an event occurs
                </p>
              </div>
            </div>

            {behaviors.length === 0 ? (
              <p className="rj-caption mt-5">
                No active behaviors are assigned to this client.
              </p>
            ) : (
              <div className="mt-5 space-y-3">
                {behaviors.map((behavior) => {
                  const isSaving =
                    savingBehaviorId === behavior.id

                  return (
                    <div
                      key={behavior.id}
                      className="flex min-h-16 items-center justify-between gap-4 rounded-[var(--rj-radius-md)] bg-[var(--rj-surface-muted)] px-4 py-3"
                    >
                      <div>
                        <p className="font-bold">
                          {behavior.name}
                        </p>

                        <p className="rj-caption">
                          {behavior.measurement_type}
                        </p>
                      </div>

                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          disabled={
                            !sessionIsRunning ||
                            isSaving ||
                            behavior.count === 0
                          }
                          onClick={() =>
                            decreaseBehavior(behavior.id)
                          }
                          className="flex h-11 w-11 items-center justify-center rounded-full bg-white disabled:opacity-40"
                        >
                          <Minus size={20} />
                        </button>

                        <span className="min-w-7 text-center text-xl font-bold">
                          {isSaving ? (
                            <LoaderCircle
                              size={20}
                              className="mx-auto animate-spin"
                            />
                          ) : (
                            behavior.count
                          )}
                        </span>

                        <button
                          type="button"
                          disabled={
                            !sessionIsRunning ||
                            isSaving
                          }
                          onClick={() =>
                            increaseBehavior(behavior.id)
                          }
                          className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--rj-danger)] text-white disabled:opacity-40"
                        >
                          <Plus
                            size={22}
                            strokeWidth={3}
                          />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          <section className="rj-card p-5">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() =>
                  setIsRecording((current) => !current)
                }
                className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-white ${
                  isRecording
                    ? "bg-[var(--rj-danger)]"
                    : "bg-[var(--rj-teal-500)]"
                }`}
              >
                {isRecording ? (
                  <Square
                    size={21}
                    fill="currentColor"
                  />
                ) : (
                  <Mic size={25} />
                )}
              </button>

              <div>
                <h2 className="rj-heading-3">
                  Voice addendum
                </h2>

                <p className="rj-caption mt-0.5">
                  Optional, but recommended
                </p>
              </div>
            </div>

            <textarea
              value={voiceNote}
              onChange={(event) =>
                setVoiceNote(event.target.value)
              }
              rows={3}
              placeholder="Type a quick session detail…"
              className="rj-input mt-4 resize-none"
            />
          </section>
        </div>

        <footer className="fixed inset-x-0 bottom-0 z-[70] border-t border-[var(--rj-border)] bg-white/95 px-5 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4 backdrop-blur">
          <div className="mx-auto flex max-w-lg items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold">
                {completedTargets}/{targets.length} targets completed
              </p>

              <p className="rj-caption truncate">
                {activeTarget
                  ? `Current: ${activeTarget.title}`
                  : "No target selected"}
              </p>
            </div>

            <button
              type="button"
              onClick={handleFinishSession}
              disabled={
                sessionActionLoading ||
                !sessionHasStarted ||
                session?.status === "completed"
              }
              className="rj-button rj-button-primary shrink-0 px-5"
            >
              {sessionActionLoading ? (
                <LoaderCircle
                  size={20}
                  className="animate-spin"
                />
              ) : (
                <Check
                  size={20}
                  strokeWidth={3}
                />
              )}

              Finish
            </button>
          </div>
        </footer>
      </div>
    </main>
  )
}

function ResponseButton({
  label,
  description,
  icon,
  className,
  disabled,
  onClick,
}: {
  label: string
  description: string
  icon: React.ReactNode
  className: string
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex min-h-[4.25rem] items-center gap-4 rounded-[var(--rj-radius-md)] px-5 text-left transition-transform active:scale-[0.98] disabled:opacity-50 ${className}`}
    >
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white">
        {icon}
      </div>

      <div>
        <p className="font-bold">{label}</p>

        <p className="text-sm text-[var(--rj-text-secondary)]">
          {description}
        </p>
      </div>
    </button>
  )
}

function getResultLabel(result: TargetResult): string {
  switch (result) {
    case "independent":
      return "Completed independently"

    case "prompted":
      return "Completed with prompting"

    case "retry":
      return "Another opportunity needed"

    case "correct":
      return "Correct response"

    case "incorrect":
      return "Incorrect response"

    case "skipped":
      return "Skipped"

    case "not_applicable":
      return "Not applicable"

    default:
      return "Response recorded"
  }
}

function getSessionStatusLabel(
  status: SessionStatus
): string {
  switch (status) {
    case "scheduled":
      return "Scheduled"

    case "confirmed":
      return "Ready to start"

    case "in_progress":
      return "Session active"

    case "paused":
      return "Session paused"

    case "completed":
      return "Session complete"

    case "canceled":
      return "Session canceled"

    case "client_absent":
      return "Client absent"

    case "provider_absent":
      return "Provider absent"

    case "no_show":
      return "No show"

    default:
      return status
  }
}