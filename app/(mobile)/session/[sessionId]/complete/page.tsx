"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import {
  ArrowLeft,
  CalendarDays,
  Check,
  CheckCircle2,
  CircleAlert,
  Clock3,
  FileCheck2,
  FileText,
  ListChecks,
  LoaderCircle,
  Mic,
  Save,
  Send,
  Sparkles,
  UserRound,
} from "lucide-react"

import { supabase } from "@/lib/supabase"

type SessionRecord = {
  id: string
  client_id: string
  provider_id: string | null
  status: string
  attendance_status: string
  session_type: string
  scheduled_start: string | null
  scheduled_end: string | null
  started_at: string | null
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
  title: string
  category: string | null
  status: string
}

type TargetResponseRecord = {
  id: string
  session_target_id: string
  result: string
  trial_number: number
  prompt_level: string | null
  notes: string | null
  recorded_at: string
}

type BehaviorEventRecord = {
  id: string
  client_behavior_id: string | null
  behavior_name: string
  event_type: string
  count: number
  duration_seconds: number | null
  intensity_level: number | null
  notes: string | null
  occurred_at: string
}

type SessionNoteRecord = {
  id: string
  status:
    | "draft"
    | "ready_for_review"
    | "submitted"
    | "returned"
    | "approved"
    | "locked"
  therapist_addendum: string | null
  generated_note: string | null
  final_note: string | null
  submitted_at: string | null
  reviewed_at: string | null
}

type TargetSummary = {
  targetId: string
  title: string
  trialCount: number
  independent: number
  prompted: number
  retry: number
  correct: number
  incorrect: number
  skipped: number
}

type BehaviorSummary = {
  name: string
  count: number
  totalDurationSeconds: number
}

export default function SessionCompletePage() {
  const params = useParams<{ sessionId: string }>()
  const router = useRouter()

  const sessionId = params.sessionId

  const [session, setSession] =
    useState<SessionRecord | null>(null)

  const [client, setClient] =
    useState<ClientRecord | null>(null)

  const [targets, setTargets] =
    useState<SessionTargetRecord[]>([])

  const [responses, setResponses] =
    useState<TargetResponseRecord[]>([])

  const [behaviorEvents, setBehaviorEvents] =
    useState<BehaviorEventRecord[]>([])

  const [note, setNote] =
    useState<SessionNoteRecord | null>(null)

  const [addendum, setAddendum] = useState("")
  const [noteText, setNoteText] = useState("")

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const [pageError, setPageError] =
    useState<string | null>(null)

  const [successMessage, setSuccessMessage] =
    useState<string | null>(null)

  const loadCompletionData = useCallback(async () => {
    if (!sessionId) return

    setPageError(null)

    try {
      const {
        data: sessionData,
        error: sessionError,
      } = await supabase
        .from("sessions")
        .select(`
          id,
          client_id,
          provider_id,
          status,
          attendance_status,
          session_type,
          scheduled_start,
          scheduled_end,
          started_at,
          completed_at,
          total_paused_seconds,
          was_supervised
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
        targetResult,
        responseResult,
        behaviorResult,
        noteResult,
      ] = await Promise.all([
        supabase
          .from("clients")
          .select(`
            id,
            first_name,
            preferred_name
          `)
          .eq("id", loadedSession.client_id)
          .single(),

        supabase
          .from("session_targets")
          .select(`
            id,
            title,
            category,
            status
          `)
          .eq("session_id", sessionId)
          .order("sort_order", {
            ascending: true,
          }),

        supabase
          .from("target_responses")
          .select(`
            id,
            session_target_id,
            result,
            trial_number,
            prompt_level,
            notes,
            recorded_at
          `)
          .eq("session_id", sessionId)
          .order("recorded_at", {
            ascending: true,
          }),

        supabase
          .from("behavior_events")
          .select(`
            id,
            client_behavior_id,
            behavior_name,
            event_type,
            count,
            duration_seconds,
            intensity_level,
            notes,
            occurred_at
          `)
          .eq("session_id", sessionId)
          .order("occurred_at", {
            ascending: true,
          }),

        supabase
          .from("session_notes")
          .select(`
            id,
            status,
            therapist_addendum,
            generated_note,
            final_note,
            submitted_at,
            reviewed_at
          `)
          .eq("session_id", sessionId)
          .maybeSingle(),
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

      if (noteResult.error) {
        throw new Error(noteResult.error.message)
      }

      const loadedClient =
        clientResult.data as ClientRecord

      const loadedTargets =
        (targetResult.data ||
          []) as SessionTargetRecord[]

      const loadedResponses =
        (responseResult.data ||
          []) as TargetResponseRecord[]

      const loadedBehaviors =
        (behaviorResult.data ||
          []) as BehaviorEventRecord[]

      const loadedNote =
        (noteResult.data as SessionNoteRecord | null) ||
        null

      setSession(loadedSession)
      setClient(loadedClient)
      setTargets(loadedTargets)
      setResponses(loadedResponses)
      setBehaviorEvents(loadedBehaviors)
      setNote(loadedNote)

      setAddendum(
        loadedNote?.therapist_addendum || ""
      )

      const existingText =
        loadedNote?.final_note ||
        loadedNote?.generated_note ||
        ""

      if (existingText) {
        setNoteText(existingText)
      } else {
        setNoteText(
          createStructuredNote({
            session: loadedSession,
            client: loadedClient,
            targets: loadedTargets,
            responses: loadedResponses,
            behaviorEvents: loadedBehaviors,
            addendum:
              loadedNote?.therapist_addendum || "",
          })
        )
      }
    } catch (error) {
      console.error(
        "Load session completion error:",
        error
      )

      setPageError(
        error instanceof Error
          ? error.message
          : "Unable to load session documentation."
      )
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  useEffect(() => {
    loadCompletionData()
  }, [loadCompletionData])

  const clientName =
    client?.preferred_name?.trim() ||
    client?.first_name ||
    "Client"

  const targetSummaries = useMemo(
    () =>
      createTargetSummaries(
        targets,
        responses
      ),
    [responses, targets]
  )

  const behaviorSummaries = useMemo(
    () =>
      createBehaviorSummaries(
        behaviorEvents
      ),
    [behaviorEvents]
  )

  const sessionDurationSeconds = useMemo(() => {
    if (
      !session?.started_at ||
      !session.completed_at
    ) {
      return 0
    }

    const elapsed = Math.floor(
      (new Date(session.completed_at).getTime() -
        new Date(session.started_at).getTime()) /
        1000
    )

    return Math.max(
      0,
      elapsed -
        (session.total_paused_seconds || 0)
    )
  }, [session])

  const totalTrials = responses.length

  const completedTargets = targets.filter(
    (target) => target.status === "completed"
  ).length

  const independentCount = responses.filter(
    (response) =>
      response.result === "independent" ||
      response.result === "correct"
  ).length

  const independentPercentage =
    totalTrials === 0
      ? 0
      : Math.round(
          (independentCount / totalTrials) * 100
        )

  const noteIsEditable =
    !note ||
    note.status === "draft" ||
    note.status === "returned"

  const handleRegenerateDraft = () => {
    if (!session || !client) return

    setNoteText(
      createStructuredNote({
        session,
        client,
        targets,
        responses,
        behaviorEvents,
        addendum,
      })
    )

    setSuccessMessage(
      "The note draft was refreshed from the current session data."
    )
  }

  const saveDraft = async () => {
    if (!sessionId || !noteIsEditable) return

    if (!noteText.trim() && !addendum.trim()) {
      setPageError(
        "Add documentation before saving the draft."
      )
      return
    }

    setSaving(true)
    setPageError(null)
    setSuccessMessage(null)

    try {
      const { data, error } = await supabase.rpc(
        "save_assigned_session_note_draft",
        {
          requested_session_id: sessionId,
          requested_therapist_addendum:
            addendum.trim() || null,
          requested_final_note:
            noteText.trim() || null,
        }
      )

      if (error) {
        throw new Error(error.message)
      }

      setNote(data as SessionNoteRecord)

      setSuccessMessage(
        "Your session note draft was saved."
      )

      await loadCompletionData()
    } catch (error) {
      console.error(
        "Save session note error:",
        error
      )

      setPageError(
        error instanceof Error
          ? error.message
          : "Unable to save the session note."
      )
    } finally {
      setSaving(false)
    }
  }

  const submitNote = async () => {
    if (!sessionId || !noteIsEditable) return

    if (!noteText.trim()) {
      setPageError(
        "Review and complete the note before submitting it."
      )
      return
    }

    setSubmitting(true)
    setPageError(null)
    setSuccessMessage(null)

    try {
      /*
       * Save the latest text immediately before submission.
       */
      const { error: saveError } = await supabase.rpc(
        "save_assigned_session_note_draft",
        {
          requested_session_id: sessionId,
          requested_therapist_addendum:
            addendum.trim() || null,
          requested_final_note:
            noteText.trim(),
        }
      )

      if (saveError) {
        throw new Error(saveError.message)
      }

      const { data, error } = await supabase.rpc(
        "submit_assigned_session_note",
        {
          requested_session_id: sessionId,
        }
      )

      if (error) {
        throw new Error(error.message)
      }

      setNote(data as SessionNoteRecord)

      setSuccessMessage(
        "Your session note was submitted for review."
      )

      await loadCompletionData()
    } catch (error) {
      console.error(
        "Submit session note error:",
        error
      )

      setPageError(
        error instanceof Error
          ? error.message
          : "Unable to submit the session note."
      )
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return <CompletionLoading />
  }

  if (!session || !client) {
    return (
      <main className="rj-page flex min-h-screen items-center justify-center p-6">
        <section className="rj-card w-full max-w-md p-7 text-center">
          <CircleAlert
            size={36}
            className="mx-auto text-[var(--rj-danger)]"
          />

          <h1 className="rj-heading-2 mt-4">
            Documentation unavailable
          </h1>

          <p className="rj-body mt-2 text-[var(--rj-text-secondary)]">
            {pageError ||
              "This session could not be loaded."}
          </p>

          <Link
            href="/my-sessions"
            className="rj-button rj-button-primary mt-6 w-full"
          >
            <ArrowLeft size={19} />
            My Sessions
          </Link>
        </section>
      </main>
    )
  }

  return (
    <main className="rj-page min-h-screen">
      <div className="rj-mobile-shell pb-[calc(var(--rj-bottom-nav-height)+var(--rj-space-8)+env(safe-area-inset-bottom))]">
        <div className="space-y-5 px-5 py-6">
          {/* Back control */}
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => router.back()}
              className="inline-flex items-center gap-2 font-bold text-[var(--rj-teal-700)]"
            >
              <ArrowLeft size={18} />
              Back
            </button>

            {note && (
              <NoteStatusBadge
                status={note.status}
              />
            )}
          </div>

          {/* Header */}
          <header className="relative overflow-hidden rounded-[var(--rj-radius-xl)] border border-[var(--rj-border)] bg-white p-6 shadow-[var(--rj-shadow-soft)]">
            <div className="pointer-events-none absolute -right-12 -top-16 h-44 w-44 rounded-full bg-[var(--rj-mint-100)] opacity-70" />

            <div className="relative">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--rj-success-soft)] text-[var(--rj-mint-700)]">
                <CheckCircle2 size={27} />
              </div>

              <p className="rj-label mt-5">
                Session Complete
              </p>

              <h1 className="rj-heading-1 mt-1">
                {clientName}
              </h1>

              <p className="rj-body mt-2 text-[var(--rj-text-secondary)]">
                Review the collected data and complete the
                session documentation.
              </p>

              <p className="rj-caption mt-3">
                {formatDateRange(
                  session.scheduled_start,
                  session.scheduled_end
                )}
              </p>
            </div>
          </header>

          {pageError && (
            <MessageBanner
              tone="danger"
              message={pageError}
            />
          )}

          {successMessage && (
            <MessageBanner
              tone="success"
              message={successMessage}
            />
          )}

          {/* Summary */}
          <section className="grid grid-cols-2 gap-4">
            <CompletionStat
              label="Duration"
              value={formatDuration(
                sessionDurationSeconds
              )}
              icon={Clock3}
              background="var(--rj-blue-100)"
              foreground="var(--rj-blue-700)"
            />

            <CompletionStat
              label="Targets"
              value={`${completedTargets}/${targets.length}`}
              icon={ListChecks}
              background="var(--rj-lavender-100)"
              foreground="var(--rj-lavender-700)"
            />

            <CompletionStat
              label="Trials"
              value={`${totalTrials}`}
              icon={Check}
              background="var(--rj-teal-100)"
              foreground="var(--rj-teal-700)"
            />

            <CompletionStat
              label="Independent"
              value={`${independentPercentage}%`}
              icon={Sparkles}
              background="var(--rj-mint-100)"
              foreground="var(--rj-mint-700)"
            />
          </section>

          {/* Known facts */}
          <section className="rj-card p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--rj-blue-100)] text-[var(--rj-blue-700)]">
                <FileCheck2 size={22} />
              </div>

              <div>
                <p className="rj-label">
                  ReJoyce Already Knows
                </p>

                <h2 className="rj-heading-3 mt-1">
                  Session facts
                </h2>
              </div>
            </div>

            <div className="mt-5 space-y-3">
              <KnownFact
                label="Client attendance"
                value={formatLabel(
                  session.attendance_status
                )}
              />

              <KnownFact
                label="Frontline worker present"
                value={
                  session.started_at ? "Yes" : "No"
                }
              />

              <KnownFact
                label="Supervised"
                value={
                  session.was_supervised
                    ? "Yes"
                    : "No"
                }
              />

              <KnownFact
                label="Session status"
                value={formatLabel(session.status)}
              />
            </div>
          </section>

          {/* Target results */}
          <section className="rj-card overflow-hidden">
            <div className="border-b border-[var(--rj-border)] p-5">
              <p className="rj-label">
                Data Collected
              </p>

              <h2 className="rj-heading-2 mt-1">
                Target Summary
              </h2>
            </div>

            {targetSummaries.length === 0 ? (
              <div className="p-6 text-center">
                <p className="rj-caption">
                  No target responses were recorded.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-[var(--rj-border)]">
                {targetSummaries.map((target) => (
                  <article
                    key={target.targetId}
                    className="p-5"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className="font-bold">
                          {target.title}
                        </h3>

                        <p className="rj-caption mt-1">
                          {target.trialCount} trial
                          {target.trialCount === 1
                            ? ""
                            : "s"}
                        </p>
                      </div>

                      <span className="rj-badge rj-badge-info">
                        {target.independent +
                          target.correct}{" "}
                        independent
                      </span>
                    </div>

                    <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                      <ResultCell
                        label="Independent"
                        value={
                          target.independent +
                          target.correct
                        }
                        background="var(--rj-success-soft)"
                      />

                      <ResultCell
                        label="Prompted"
                        value={target.prompted}
                        background="var(--rj-blue-100)"
                      />

                      <ResultCell
                        label="Retry/Other"
                        value={
                          target.retry +
                          target.incorrect +
                          target.skipped
                        }
                        background="var(--rj-warning-soft)"
                      />
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          {/* Behaviors */}
          <section className="rj-card overflow-hidden">
            <div className="border-b border-[var(--rj-border)] p-5">
              <p className="rj-label">
                Observations
              </p>

              <h2 className="rj-heading-2 mt-1">
                Behavior Summary
              </h2>
            </div>

            {behaviorSummaries.length === 0 ? (
              <div className="p-6 text-center">
                <CheckCircle2
                  size={28}
                  className="mx-auto text-[var(--rj-mint-700)]"
                />

                <p className="mt-3 font-bold">
                  No behavior events recorded
                </p>
              </div>
            ) : (
              <div className="divide-y divide-[var(--rj-border)]">
                {behaviorSummaries.map(
                  (behavior) => (
                    <div
                      key={behavior.name}
                      className="flex items-center justify-between gap-4 p-5"
                    >
                      <div>
                        <p className="font-bold">
                          {behavior.name}
                        </p>

                        {behavior.totalDurationSeconds >
                          0 && (
                          <p className="rj-caption mt-1">
                            Duration:{" "}
                            {formatDuration(
                              behavior.totalDurationSeconds
                            )}
                          </p>
                        )}
                      </div>

                      <span className="rj-badge rj-badge-danger">
                        {behavior.count}
                      </span>
                    </div>
                  )
                )}
              </div>
            )}
          </section>

          {/* Addendum */}
          <section className="rj-card p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--rj-teal-100)] text-[var(--rj-teal-700)]">
                <Mic size={22} />
              </div>

              <div>
                <p className="rj-label">
                  Optional Context
                </p>

                <h2 className="rj-heading-3 mt-1">
                  Educator addendum
                </h2>
              </div>
            </div>

            <p className="rj-caption mt-3">
              Add only details that the structured session
              data could not capture.
            </p>

            <textarea
              value={addendum}
              onChange={(event) =>
                setAddendum(event.target.value)
              }
              disabled={!noteIsEditable}
              rows={4}
              placeholder="Example: The client appeared tired after lunch and required additional redirection."
              className="rj-input mt-4 resize-none disabled:opacity-60"
            />
          </section>

          {/* Documentation */}
          <section className="rj-card p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--rj-lavender-100)] text-[var(--rj-lavender-700)]">
                  <FileText size={22} />
                </div>

                <div>
                  <p className="rj-label">
                    Documentation
                  </p>

                  <h2 className="rj-heading-3 mt-1">
                    Session note
                  </h2>
                </div>
              </div>

              {noteIsEditable && (
                <button
                  type="button"
                  onClick={handleRegenerateDraft}
                  className="text-sm font-bold text-[var(--rj-teal-700)]"
                >
                  Refresh draft
                </button>
              )}
            </div>

            <p className="rj-caption mt-3">
              This draft is assembled from recorded session
              facts. Review it carefully before submitting.
            </p>

            <textarea
              value={noteText}
              onChange={(event) =>
                setNoteText(event.target.value)
              }
              disabled={!noteIsEditable}
              rows={12}
              className="rj-input mt-4 resize-y disabled:opacity-65"
            />
          </section>

          {/* Actions */}
          {noteIsEditable ? (
            <section className="grid gap-3">
              <button
                type="button"
                onClick={saveDraft}
                disabled={saving || submitting}
                className="rj-button rj-button-secondary w-full"
              >
                {saving ? (
                  <LoaderCircle
                    size={20}
                    className="animate-spin"
                  />
                ) : (
                  <Save size={20} />
                )}

                {saving
                  ? "Saving Draft…"
                  : "Save Draft"}
              </button>

              <button
                type="button"
                onClick={submitNote}
                disabled={saving || submitting}
                className="rj-button rj-button-primary w-full"
              >
                {submitting ? (
                  <LoaderCircle
                    size={20}
                    className="animate-spin"
                  />
                ) : (
                  <Send size={20} />
                )}

                {submitting
                  ? "Submitting…"
                  : "Submit for Review"}
              </button>
            </section>
          ) : (
            <section className="rounded-[var(--rj-radius-lg)] bg-[var(--rj-success-soft)] p-5 text-center">
              <CheckCircle2
                size={30}
                className="mx-auto text-[var(--rj-mint-700)]"
              />

              <h2 className="rj-heading-3 mt-3">
                Documentation submitted
              </h2>

              <p className="rj-caption mt-2">
                Status:{" "}
                {note
                  ? formatLabel(note.status)
                  : "Submitted"}
              </p>
            </section>
          )}

          <Link
            href="/my-sessions"
            className="rj-button rj-button-soft w-full"
          >
            <CalendarDays size={19} />
            Return to My Sessions
          </Link>
        </div>
      </div>
    </main>
  )
}

function createTargetSummaries(
  targets: SessionTargetRecord[],
  responses: TargetResponseRecord[]
): TargetSummary[] {
  return targets
    .map((target) => {
      const targetResponses = responses.filter(
        (response) =>
          response.session_target_id === target.id
      )

      return {
        targetId: target.id,
        title: target.title,
        trialCount: targetResponses.length,

        independent: targetResponses.filter(
          (response) =>
            response.result === "independent"
        ).length,

        prompted: targetResponses.filter(
          (response) =>
            response.result === "prompted"
        ).length,

        retry: targetResponses.filter(
          (response) =>
            response.result === "retry"
        ).length,

        correct: targetResponses.filter(
          (response) =>
            response.result === "correct"
        ).length,

        incorrect: targetResponses.filter(
          (response) =>
            response.result === "incorrect"
        ).length,

        skipped: targetResponses.filter(
          (response) =>
            response.result === "skipped" ||
            response.result ===
              "not_applicable"
        ).length,
      }
    })
    .filter((target) => target.trialCount > 0)
}

function createBehaviorSummaries(
  events: BehaviorEventRecord[]
): BehaviorSummary[] {
  const summaries = new Map<
    string,
    BehaviorSummary
  >()

  events.forEach((event) => {
    const existing = summaries.get(
      event.behavior_name
    )

    summaries.set(event.behavior_name, {
      name: event.behavior_name,
      count:
        (existing?.count || 0) +
        (event.count || 0),

      totalDurationSeconds:
        (existing?.totalDurationSeconds || 0) +
        (event.duration_seconds || 0),
    })
  })

  return Array.from(summaries.values())
}

function createStructuredNote({
  session,
  client,
  targets,
  responses,
  behaviorEvents,
  addendum,
}: {
  session: SessionRecord
  client: ClientRecord
  targets: SessionTargetRecord[]
  responses: TargetResponseRecord[]
  behaviorEvents: BehaviorEventRecord[]
  addendum: string
}): string {
  const clientName =
    client.preferred_name?.trim() ||
    client.first_name ||
    "The client"

  const targetSummaries =
    createTargetSummaries(
      targets,
      responses
    )

  const behaviorSummaries =
    createBehaviorSummaries(
      behaviorEvents
    )

  const completedTargetCount =
    targets.filter(
      (target) => target.status === "completed"
    ).length

  const independentCount =
    responses.filter(
      (response) =>
        response.result === "independent" ||
        response.result === "correct"
    ).length

  const promptedCount =
    responses.filter(
      (response) =>
        response.result === "prompted"
    ).length

  const sessionDate = session.started_at
    ? new Intl.DateTimeFormat("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      }).format(new Date(session.started_at))
    : "the scheduled date"

  const targetText =
    targetSummaries.length > 0
      ? targetSummaries
          .map((target) => {
            const independent =
              target.independent +
              target.correct

            return `${target.title}: ${target.trialCount} trial${
              target.trialCount === 1 ? "" : "s"
            }, ${independent} independent/correct and ${
              target.prompted
            } prompted.`
          })
          .join(" ")
      : "No target-response data was recorded."

  const behaviorText =
    behaviorSummaries.length > 0
      ? behaviorSummaries
          .map(
            (behavior) =>
              `${behavior.name} was recorded ${behavior.count} time${
                behavior.count === 1 ? "" : "s"
              }.`
          )
          .join(" ")
      : "No tracked behavior events were recorded."

  const supervisionText =
    session.was_supervised
      ? "The session was supervised."
      : "The session was not marked as supervised."

  const addendumText = addendum.trim()
    ? ` Additional context: ${addendum.trim()}`
    : ""

  return `${clientName} participated in a ${formatLabel(
    session.session_type
  ).toLowerCase()} session on ${sessionDate}. Attendance was recorded as ${formatLabel(
    session.attendance_status
  ).toLowerCase()}. ${completedTargetCount} of ${
    targets.length
  } prepared targets were completed, with ${
    responses.length
  } total responses recorded. ${independentCount} responses were independent or correct and ${promptedCount} required prompting. ${targetText} ${behaviorText} ${supervisionText}${addendumText}`
}

function CompletionStat({
  label,
  value,
  icon: Icon,
  background,
  foreground,
}: {
  label: string
  value: string
  icon: typeof Clock3
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

      <p className="mt-4 text-xl font-extrabold">
        {value}
      </p>

      <p className="rj-caption mt-1">
        {label}
      </p>
    </article>
  )
}

function KnownFact({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-[var(--rj-radius-md)] bg-[var(--rj-surface-muted)] px-4 py-3">
      <span className="text-sm font-semibold text-[var(--rj-text-secondary)]">
        {label}
      </span>

      <span className="text-sm font-bold">
        {value}
      </span>
    </div>
  )
}

function ResultCell({
  label,
  value,
  background,
}: {
  label: string
  value: number
  background: string
}) {
  return (
    <div
      className="rounded-[var(--rj-radius-sm)] p-3"
      style={{ background }}
    >
      <p className="text-lg font-extrabold">
        {value}
      </p>

      <p className="mt-1 text-[0.7rem] font-bold text-[var(--rj-text-secondary)]">
        {label}
      </p>
    </div>
  )
}

function NoteStatusBadge({
  status,
}: {
  status: SessionNoteRecord["status"]
}) {
  const className =
    status === "approved" ||
    status === "locked"
      ? "rj-badge-success"
      : status === "returned"
        ? "rj-badge-danger"
        : status === "submitted" ||
            status === "ready_for_review"
          ? "rj-badge-info"
          : "rj-badge-warning"

  return (
    <span className={`rj-badge ${className}`}>
      {formatLabel(status)}
    </span>
  )
}

function MessageBanner({
  tone,
  message,
}: {
  tone: "success" | "danger"
  message: string
}) {
  const success = tone === "success"

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

        <p
          className={`text-sm font-semibold ${
            success
              ? "text-[var(--rj-mint-700)]"
              : "text-[var(--rj-danger)]"
          }`}
        >
          {message}
        </p>
      </div>
    </div>
  )
}

function CompletionLoading() {
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
          Preparing session documentation…
        </p>
      </div>
    </main>
  )
}

function formatDuration(
  totalSeconds: number
): string {
  const hours = Math.floor(
    totalSeconds / 3600
  )

  const minutes = Math.floor(
    (totalSeconds % 3600) / 60
  )

  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }

  return `${minutes}m`
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