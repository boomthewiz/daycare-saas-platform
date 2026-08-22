"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react"
import Link from "next/link"
import {
  CheckCircle2,
  CircleAlert,
  Clock3,
  FileCheck2,
  FileText,
  Filter,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  UserRound,
} from "lucide-react"

import { supabase } from "@/lib/supabase"

type ReviewStatus =
  | "submitted"
  | "returned"
  | "approved"
  | "locked"

type SessionNoteRow = {
  id: string
  organization_id: string
  session_id: string
  author_id: string | null
  reviewed_by: string | null
  status: ReviewStatus
  review_notes: string | null
  submitted_at: string | null
  reviewed_at: string | null
  created_at: string
  updated_at: string
  sessions: {
    id: string
    client_id: string
    provider_id: string | null
    session_type: string
    status: string
    scheduled_start: string | null
    scheduled_end: string | null
    location: string | null
    clients: {
      first_name: string
      last_name: string | null
      preferred_name: string | null
    } | null
    provider: {
      full_name: string | null
      email: string | null
    } | null
  } | null
}

type StatusFilter =
  | "submitted"
  | "returned"
  | "approved"
  | "locked"
  | "all"

export default function ReviewsPage() {
  const [notes, setNotes] =
    useState<SessionNoteRow[]>([])

  const [statusFilter, setStatusFilter] =
    useState<StatusFilter>("submitted")

  const [searchTerm, setSearchTerm] = useState("")

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const [pageError, setPageError] =
    useState<string | null>(null)

  const loadReviews = useCallback(
    async (showRefresh = false) => {
      if (showRefresh) {
        setRefreshing(true)
      } else {
        setLoading(true)
      }

      setPageError(null)

      try {
        const {
          data: { user },
          error: authError,
        } = await supabase.auth.getUser()

        if (authError) {
          throw new Error(authError.message)
        }

        if (!user) {
          throw new Error(
            "Your login session could not be found."
          )
        }

        const {
          data: canReview,
          error: permissionError,
        } = await supabase.rpc(
          "can_review_sessions"
        )

        if (permissionError) {
          throw new Error(
            permissionError.message
          )
        }

        if (!canReview) {
          throw new Error(
            "You do not have permission to review session documentation."
          )
        }

        const { data, error } = await supabase
          .from("session_notes")
          .select(`
            id,
            organization_id,
            session_id,
            author_id,
            reviewed_by,
            status,
            review_notes,
            submitted_at,
            reviewed_at,
            created_at,
            updated_at,
            sessions (
              id,
              client_id,
              provider_id,
              session_type,
              status,
              scheduled_start,
              scheduled_end,
              location,
              clients (
                first_name,
                last_name,
                preferred_name
              ),
              provider:users!sessions_provider_id_fkey (
                full_name,
                email
              )
            )
          `)
          .in("status", [
            "submitted",
            "returned",
            "approved",
            "locked",
          ])
          .order("submitted_at", {
            ascending: false,
            nullsFirst: false,
          })
          .order("updated_at", {
            ascending: false,
          })

        if (error) {
          throw new Error(error.message)
        }

        setNotes(
          (data || []) as unknown as SessionNoteRow[]
        )
      } catch (error) {
        console.error(
          "Load review queue error:",
          error
        )

        setPageError(
          error instanceof Error
            ? error.message
            : "Unable to load the review queue."
        )
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    []
  )

  useEffect(() => {
    loadReviews()
  }, [loadReviews])

  const submittedCount = notes.filter(
    (note) => note.status === "submitted"
  ).length

  const returnedCount = notes.filter(
    (note) => note.status === "returned"
  ).length

  const approvedCount = notes.filter(
    (note) => note.status === "approved"
  ).length

  const lockedCount = notes.filter(
    (note) => note.status === "locked"
  ).length

  const filteredNotes = useMemo(() => {
    const search =
      searchTerm.trim().toLowerCase()

    return notes.filter((note) => {
      if (
        statusFilter !== "all" &&
        note.status !== statusFilter
      ) {
        return false
      }

      if (!search) {
        return true
      }

      const session = note.sessions
      const client = session?.clients
      const provider = session?.provider

      const clientName = client
        ? (
            client.preferred_name?.trim() ||
            [
              client.first_name,
              client.last_name,
            ]
              .filter(Boolean)
              .join(" ")
          )
        : ""

      const providerName =
        provider?.full_name ||
        provider?.email ||
        ""

      const searchable = [
        clientName,
        providerName,
        session?.session_type,
        session?.location,
        note.status,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()

      return searchable.includes(search)
    })
  }, [notes, searchTerm, statusFilter])

  if (loading) {
    return <ReviewsLoading />
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="relative overflow-hidden rounded-[var(--rj-radius-xl)] border border-[var(--rj-border)] bg-white p-6 shadow-[var(--rj-shadow-soft)] sm:p-8">
        <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-[var(--rj-lavender-100)] opacity-65" />

        <div className="pointer-events-none absolute -bottom-24 right-32 h-48 w-48 rounded-full bg-[var(--rj-teal-100)] opacity-50" />

        <div className="relative flex flex-col justify-between gap-6 lg:flex-row lg:items-center">
          <div className="max-w-2xl">
            <span className="inline-flex items-center gap-2 rounded-full bg-[var(--rj-teal-50)] px-3 py-1.5 text-sm font-bold text-[var(--rj-teal-700)]">
              <ShieldCheck size={15} />
              Documentation Review
            </span>

            <h1 className="rj-heading-1 mt-4">
              Session Review Queue
            </h1>

            <p className="rj-body mt-3 text-[var(--rj-text-secondary)]">
              Review submitted documentation, return notes
              for correction, and track approved or locked
              records.
            </p>
          </div>

          <button
            type="button"
            onClick={() => loadReviews(true)}
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
                Unable to load review queue
              </p>

              <p className="rj-caption mt-1">
                {pageError}
              </p>
            </div>
          </div>
        </div>
      )}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <ReviewSummaryCard
          label="Submitted"
          value={submittedCount}
          description="Waiting for review"
          icon={FileText}
          background="var(--rj-blue-100)"
          foreground="var(--rj-blue-700)"
        />

        <ReviewSummaryCard
          label="Returned"
          value={returnedCount}
          description="Needs correction"
          icon={RotateCcw}
          background="var(--rj-warning-soft)"
          foreground="#926c22"
        />

        <ReviewSummaryCard
          label="Approved"
          value={approvedCount}
          description="Accepted documentation"
          icon={CheckCircle2}
          background="var(--rj-mint-100)"
          foreground="var(--rj-mint-700)"
        />

        <ReviewSummaryCard
          label="Locked"
          value={lockedCount}
          description="Finalized records"
          icon={FileCheck2}
          background="var(--rj-lavender-100)"
          foreground="var(--rj-lavender-700)"
        />
      </section>

      <section className="rj-card p-2">
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          <StatusTab
            label="Submitted"
            count={submittedCount}
            active={statusFilter === "submitted"}
            onClick={() =>
              setStatusFilter("submitted")
            }
          />

          <StatusTab
            label="Returned"
            count={returnedCount}
            active={statusFilter === "returned"}
            onClick={() =>
              setStatusFilter("returned")
            }
          />

          <StatusTab
            label="Approved"
            count={approvedCount}
            active={statusFilter === "approved"}
            onClick={() =>
              setStatusFilter("approved")
            }
          />

          <StatusTab
            label="Locked"
            count={lockedCount}
            active={statusFilter === "locked"}
            onClick={() =>
              setStatusFilter("locked")
            }
          />

          <StatusTab
            label="All"
            count={notes.length}
            active={statusFilter === "all"}
            onClick={() =>
              setStatusFilter("all")
            }
          />
        </div>
      </section>

      <section className="rj-card overflow-hidden">
        <div className="border-b border-[var(--rj-border)] p-6">
          <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-center">
            <div>
              <p className="rj-label">
                Review Queue
              </p>

              <h2 className="rj-heading-2 mt-1">
                {getStatusHeading(statusFilter)}
              </h2>

              <p className="rj-caption mt-2">
                {filteredNotes.length} record
                {filteredNotes.length === 1
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
                  placeholder="Search client, worker, location…"
                  className="rj-input min-w-[260px] pl-11"
                />
              </div>

              <div className="flex items-center gap-2 rounded-[var(--rj-radius-md)] bg-[var(--rj-surface-muted)] px-4">
                <Filter
                  size={17}
                  className="text-[var(--rj-text-muted)]"
                />

                <span className="text-sm font-semibold text-[var(--rj-text-secondary)]">
                  {formatLabel(statusFilter)}
                </span>
              </div>
            </div>
          </div>
        </div>

        {filteredNotes.length === 0 ? (
          <ReviewEmptyState
            status={statusFilter}
          />
        ) : (
          <div className="divide-y divide-[var(--rj-border)]">
            {filteredNotes.map((note) => (
              <ReviewQueueRow
                key={note.id}
                note={note}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function ReviewQueueRow({
  note,
}: {
  note: SessionNoteRow
}) {
  const session = note.sessions
  const client = session?.clients
  const provider = session?.provider

  const clientName = client
    ? (
        client.preferred_name?.trim() ||
        [
          client.first_name,
          client.last_name,
        ]
          .filter(Boolean)
          .join(" ")
      )
    : "Client"

  const providerName =
    provider?.full_name ||
    provider?.email ||
    "Unassigned"

  const submittedAge =
    note.submitted_at
      ? formatAge(note.submitted_at)
      : "Not submitted"

  return (
    <article className="p-5 transition-colors hover:bg-[var(--rj-surface-muted)] sm:p-6">
      <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-center">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-bold">
              {clientName}
            </h3>

            <ReviewStatusBadge
              status={note.status}
            />
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <ReviewDetail
              icon={Clock3}
              label="Session"
              value={formatDateRange(
                session?.scheduled_start || null,
                session?.scheduled_end || null
              )}
            />

            <ReviewDetail
              icon={UserRound}
              label="Frontline worker"
              value={providerName}
            />

            <ReviewDetail
              icon={FileText}
              label="Submitted"
              value={submittedAge}
            />

            <ReviewDetail
              icon={ShieldCheck}
              label="Session type"
              value={
                session?.session_type
                  ? formatLabel(
                      session.session_type
                    )
                  : "Not specified"
              }
            />
          </div>

          {session?.location && (
            <p className="rj-caption mt-4">
              Location: {session.location}
            </p>
          )}

          {note.status === "returned" &&
            note.review_notes && (
              <div className="mt-4 rounded-[var(--rj-radius-md)] bg-[var(--rj-warning-soft)] p-3">
                <p className="text-sm font-bold text-[#926c22]">
                  Reviewer feedback
                </p>

                <p className="rj-caption mt-1">
                  {note.review_notes}
                </p>
              </div>
            )}
        </div>

        <div className="shrink-0">
          <Link
            href={`/reviews/${note.session_id}`}
            className="rj-button rj-button-primary"
          >
            {note.status === "submitted"
              ? "Review"
              : "Open Record"}
          </Link>
        </div>
      </div>
    </article>
  )
}

function ReviewSummaryCard({
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
  icon: typeof FileText
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

          <p className="mt-2 text-3xl font-extrabold">
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
          <Icon size={22} />
        </div>
      </div>
    </article>
  )
}

function ReviewDetail({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof FileText
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

function StatusTab({
  label,
  count,
  active,
  onClick,
}: {
  label: string
  count: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-14 items-center justify-center gap-3 rounded-[var(--rj-radius-md)] px-4 font-bold transition-colors ${
        active
          ? "bg-[var(--rj-teal-100)] text-[var(--rj-teal-700)]"
          : "text-[var(--rj-text-secondary)] hover:bg-[var(--rj-surface-muted)]"
      }`}
    >
      {label}

      <span className="rounded-full bg-white px-2 py-0.5 text-xs">
        {count}
      </span>
    </button>
  )
}

function ReviewStatusBadge({
  status,
}: {
  status: ReviewStatus
}) {
  const className =
    status === "approved" ||
    status === "locked"
      ? "rj-badge-success"
      : status === "returned"
        ? "rj-badge-warning"
        : "rj-badge-info"

  return (
    <span className={`rj-badge ${className}`}>
      {formatLabel(status)}
    </span>
  )
}

function ReviewEmptyState({
  status,
}: {
  status: StatusFilter
}) {
  const content = (() => {
    switch (status) {
      case "submitted":
        return {
          title: "No notes waiting for review",
          description:
            "Newly submitted session documentation will appear here.",
          icon: FileCheck2,
        }

      case "returned":
        return {
          title: "No returned notes",
          description:
            "Notes sent back for correction will appear here.",
          icon: RotateCcw,
        }

      case "approved":
        return {
          title: "No approved notes",
          description:
            "Approved documentation will appear here.",
          icon: CheckCircle2,
        }

      case "locked":
        return {
          title: "No locked records",
          description:
            "Finalized documentation will appear here.",
          icon: ShieldCheck,
        }

      default:
        return {
          title: "No review records",
          description:
            "Submitted and reviewed documentation will appear here.",
          icon: FileText,
        }
    }
  })()

  const Icon = content.icon

  return (
    <div className="p-12 text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[var(--rj-blue-100)] text-[var(--rj-blue-700)]">
        <Icon size={28} />
      </div>

      <h3 className="rj-heading-3 mt-4">
        {content.title}
      </h3>

      <p className="rj-caption mx-auto mt-2 max-w-md">
        {content.description}
      </p>
    </div>
  )
}

function ReviewsLoading() {
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
          Loading review queue…
        </p>
      </div>
    </div>
  )
}

function getStatusHeading(
  status: StatusFilter
): string {
  switch (status) {
    case "submitted":
      return "Waiting for Review"

    case "returned":
      return "Returned for Correction"

    case "approved":
      return "Approved Documentation"

    case "locked":
      return "Locked Records"

    default:
      return "All Review Records"
  }
}

function formatLabel(
  value: string
): string {
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

function formatAge(
  value: string
): string {
  const timestamp =
    new Date(value).getTime()

  if (Number.isNaN(timestamp)) {
    return "Unknown"
  }

  const elapsed =
    Date.now() - timestamp

  const minutes = Math.floor(
    elapsed / 60_000
  )

  if (minutes < 1) {
    return "Just now"
  }

  if (minutes < 60) {
    return `${minutes}m ago`
  }

  const hours = Math.floor(
    minutes / 60
  )

  if (hours < 24) {
    return `${hours}h ago`
  }

  const days = Math.floor(
    hours / 24
  )

  if (days < 7) {
    return `${days}d ago`
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value))
}