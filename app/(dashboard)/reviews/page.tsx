"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
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
  | "draft"
  | "submitted"
  | "returned"
  | "approved"
  | "locked"

type ReviewRow = {
  id: string
  session_id: string
  organization_id: string
  status: ReviewStatus
  author_id: string | null
  reviewed_by: string | null
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
    attendance_status: string
    scheduled_start: string | null
    scheduled_end: string | null

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

type FilterValue =
  | "all"
  | "submitted"
  | "returned"
  | "approved"
  | "locked"

export default function ReviewsPage() {
  const [reviews, setReviews] = useState<ReviewRow[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [pageError, setPageError] = useState<string | null>(null)

  const [filter, setFilter] =
    useState<FilterValue>("submitted")

  const [search, setSearch] = useState("")

  const loadReviews = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true)
    } else {
      setLoading(true)
    }

    setPageError(null)

    try {
      /*
       * First verify that the current user is actually
       * allowed to access the review queue.
       */
      const { data: canReview, error: permissionError } =
        await supabase.rpc("can_review_sessions")

      if (permissionError) {
        throw new Error(permissionError.message)
      }

      if (!canReview) {
        throw new Error(
          "You do not have permission to access session reviews."
        )
      }

      /*
       * Load review records for the current organization.
       *
       * RLS on session_notes is responsible for determining
       * which records the current reviewer can actually see.
       */
      const { data, error } = await supabase
        .from("session_notes")
        .select(`
          id,
          session_id,
          organization_id,
          status,
          author_id,
          reviewed_by,
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
            attendance_status,
            scheduled_start,
            scheduled_end,

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
        .order("updated_at", {
          ascending: false,
        })

      if (error) {
        throw new Error(error.message)
      }

      setReviews(
        (data || []) as unknown as ReviewRow[]
      )
    } catch (error) {
      console.error("Load reviews error:", error)

      setPageError(
        error instanceof Error
          ? error.message
          : "Unable to load the review queue."
      )
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    loadReviews()
  }, [loadReviews])

  const counts = useMemo(() => {
    return {
      all: reviews.length,

      submitted: reviews.filter(
        (review) => review.status === "submitted"
      ).length,

      returned: reviews.filter(
        (review) => review.status === "returned"
      ).length,

      approved: reviews.filter(
        (review) => review.status === "approved"
      ).length,

      locked: reviews.filter(
        (review) => review.status === "locked"
      ).length,
    }
  }, [reviews])

  const filteredReviews = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase()

    return reviews.filter((review) => {
      const session = review.sessions

      const matchesStatus =
        filter === "all" ||
        review.status === filter

      if (!matchesStatus) {
        return false
      }

      if (!normalizedSearch) {
        return true
      }

      const client = session?.clients

      const clientName = [
        client?.preferred_name || client?.first_name,
        client?.last_name,
      ]
        .filter(Boolean)
        .join(" ")

      const providerName =
        session?.provider?.full_name ||
        session?.provider?.email ||
        ""

      const searchableText = [
        clientName,
        providerName,
        session?.session_type,
        session?.attendance_status,
        review.status,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()

      return searchableText.includes(normalizedSearch)
    })
  }, [reviews, filter, search])

  if (loading) {
    return <ReviewsLoading />
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Header */}
      <header className="relative overflow-hidden rounded-[var(--rj-radius-xl)] border border-[var(--rj-border)] bg-white p-6 shadow-[var(--rj-shadow-soft)] sm:p-8">
        <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-[var(--rj-lavender-100)] opacity-60" />

        <div className="relative flex flex-col justify-between gap-6 lg:flex-row lg:items-center">
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-full bg-[var(--rj-teal-50)] px-3 py-1.5 text-sm font-bold text-[var(--rj-teal-700)]">
                <ShieldCheck size={15} />
                Administration
              </span>
            </div>

            <h1 className="rj-heading-1 mt-4">
              Session Reviews
            </h1>

            <p className="rj-body mt-2 max-w-2xl text-[var(--rj-text-secondary)]">
              Review submitted session documentation, return
              notes for correction, approve documentation, and
              finalize completed records.
            </p>
          </div>

          <button
            type="button"
            onClick={() => loadReviews(true)}
            disabled={refreshing}
            className="rj-button rj-button-secondary shrink-0"
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
      </header>

      {pageError && (
        <div className="rounded-[var(--rj-radius-md)] bg-[var(--rj-danger-soft)] p-4">
          <div className="flex items-start gap-3">
            <AlertCircle
              size={21}
              className="mt-0.5 shrink-0 text-[var(--rj-danger)]"
            />

            <div>
              <p className="font-bold">
                Unable to load reviews
              </p>

              <p className="rj-caption mt-1">
                {pageError}
              </p>

              <button
                type="button"
                onClick={() => loadReviews()}
                className="mt-3 text-sm font-bold text-[var(--rj-teal-700)]"
              >
                Try again
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Summary cards */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <ReviewCountCard
          label="All"
          value={counts.all}
          icon={FileText}
          active={filter === "all"}
          onClick={() => setFilter("all")}
        />

        <ReviewCountCard
          label="Needs Review"
          value={counts.submitted}
          icon={ShieldCheck}
          active={filter === "submitted"}
          onClick={() => setFilter("submitted")}
        />

        <ReviewCountCard
          label="Returned"
          value={counts.returned}
          icon={RotateCcw}
          active={filter === "returned"}
          onClick={() => setFilter("returned")}
        />

        <ReviewCountCard
          label="Approved"
          value={counts.approved}
          icon={CheckCircle2}
          active={filter === "approved"}
          onClick={() => setFilter("approved")}
        />

        <ReviewCountCard
          label="Locked"
          value={counts.locked}
          icon={FileCheck2}
          active={filter === "locked"}
          onClick={() => setFilter("locked")}
        />
      </section>

      {/* Filters */}
      <section className="rj-card p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-2">
            <Filter
              size={19}
              className="text-[var(--rj-teal-700)]"
            />

            <p className="font-bold">
              Review Queue
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative">
              <Search
                size={18}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--rj-text-muted)]"
              />

              <input
                type="search"
                value={search}
                onChange={(event) =>
                  setSearch(event.target.value)
                }
                placeholder="Search client or provider..."
                className="rj-input pl-10 sm:w-72"
              />
            </div>

            <select
              value={filter}
              onChange={(event) =>
                setFilter(
                  event.target.value as FilterValue
                )
              }
              className="rj-input sm:w-48"
            >
              <option value="all">
                All reviews
              </option>

              <option value="submitted">
                Needs review
              </option>

              <option value="returned">
                Returned
              </option>

              <option value="approved">
                Approved
              </option>

              <option value="locked">
                Locked
              </option>
            </select>
          </div>
        </div>
      </section>

      {/* Review list */}
      <section className="rj-card overflow-hidden">
        {filteredReviews.length === 0 ? (
          <EmptyReviews
            hasSearch={Boolean(search.trim())}
            filter={filter}
          />
        ) : (
          <>
            <div className="hidden border-b border-[var(--rj-border)] bg-[var(--rj-surface-muted)] px-6 py-3 text-xs font-extrabold uppercase tracking-wide text-[var(--rj-text-muted)] lg:grid lg:grid-cols-[minmax(220px,1.4fr)_minmax(160px,1fr)_150px_150px_40px] lg:gap-4">
              <span>Client</span>
              <span>Provider</span>
              <span>Session</span>
              <span>Status</span>
              <span />
            </div>

            <div className="divide-y divide-[var(--rj-border)]">
              {filteredReviews.map((review) => (
                <ReviewListItem
                  key={review.id}
                  review={review}
                />
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  )
}

function ReviewListItem({
  review,
}: {
  review: ReviewRow
}) {
  const session = review.sessions
  const client = session?.clients

  const clientName =
    client?.preferred_name ||
    [client?.first_name, client?.last_name]
      .filter(Boolean)
      .join(" ") ||
    "Unknown client"

  const providerName =
    session?.provider?.full_name ||
    session?.provider?.email ||
    "Unassigned"

  return (
    <Link
      href={`/reviews/${review.session_id}`}
      className="group block p-5 transition hover:bg-[var(--rj-surface-muted)] sm:p-6"
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(220px,1.4fr)_minmax(160px,1fr)_150px_150px_40px] lg:items-center lg:gap-4">
        {/* Client */}
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--rj-lavender-100)] text-[var(--rj-lavender-700)]">
            <UserRound size={20} />
          </div>

          <div className="min-w-0">
            <p className="truncate font-extrabold">
              {clientName}
            </p>

            <p className="rj-caption mt-1">
              Documentation review
            </p>
          </div>
        </div>

        {/* Provider */}
        <div>
          <p className="rj-label lg:hidden">
            Provider
          </p>

          <p className="mt-1 truncate text-sm font-semibold lg:mt-0">
            {providerName}
          </p>
        </div>

        {/* Session */}
        <div>
          <p className="rj-label lg:hidden">
            Session
          </p>

          <div className="mt-1 lg:mt-0">
            <p className="text-sm font-bold">
              {formatSessionType(
                session?.session_type
              )}
            </p>

            <p className="rj-caption mt-1">
              {formatDate(
                session?.scheduled_start ||
                  review.created_at
              )}
            </p>
          </div>
        </div>

        {/* Status */}
        <div>
          <p className="rj-label lg:hidden">
            Status
          </p>

          <div className="mt-1 lg:mt-0">
            <ReviewStatusBadge
              status={review.status}
            />
          </div>
        </div>

        {/* Arrow */}
        <div className="hidden justify-end lg:flex">
          <ChevronRight
            size={21}
            className="text-[var(--rj-text-muted)] transition group-hover:translate-x-1 group-hover:text-[var(--rj-teal-700)]"
          />
        </div>
      </div>
    </Link>
  )
}

function ReviewCountCard({
  label,
  value,
  icon: Icon,
  active,
  onClick,
}: {
  label: string
  value: number
  icon: typeof FileText
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rj-card p-5 text-left transition ${
        active
          ? "ring-2 ring-[var(--rj-teal-500)]"
          : "hover:-translate-y-0.5"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="rj-label">
            {label}
          </p>

          <p className="mt-2 text-2xl font-extrabold">
            {value}
          </p>
        </div>

        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--rj-teal-50)] text-[var(--rj-teal-700)]">
          <Icon size={19} />
        </div>
      </div>
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
        : status === "submitted"
          ? "rj-badge-info"
          : "rj-badge-warning"

  return (
    <span className={`rj-badge ${className}`}>
      {status === "submitted"
        ? "Needs Review"
        : formatLabel(status)}
    </span>
  )
}

function EmptyReviews({
  hasSearch,
  filter,
}: {
  hasSearch: boolean
  filter: FilterValue
}) {
  if (hasSearch) {
    return (
      <div className="p-10 text-center">
        <Search
          size={34}
          className="mx-auto text-[var(--rj-text-muted)]"
        />

        <h2 className="rj-heading-3 mt-4">
          No matching reviews
        </h2>

        <p className="rj-caption mt-2">
          Try changing your search or review filter.
        </p>
      </div>
    )
  }

  if (filter === "submitted") {
    return (
      <div className="p-10 text-center">
        <CheckCircle2
          size={38}
          className="mx-auto text-[var(--rj-mint-700)]"
        />

        <h2 className="rj-heading-3 mt-4">
          You're all caught up
        </h2>

        <p className="rj-caption mt-2">
          There are no submitted session notes waiting for review.
        </p>
      </div>
    )
  }

  return (
    <div className="p-10 text-center">
      <FileText
        size={38}
        className="mx-auto text-[var(--rj-text-muted)]"
      />

      <h2 className="rj-heading-3 mt-4">
        No reviews found
      </h2>

      <p className="rj-caption mt-2">
        There are no session notes in this category.
      </p>
    </div>
  )
}

function ReviewsLoading() {
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="rj-card h-48 animate-pulse bg-[var(--rj-surface-muted)]" />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <div
            key={index}
            className="rj-card h-28 animate-pulse bg-[var(--rj-surface-muted)]"
          />
        ))}
      </div>

      <div className="rj-card h-96 animate-pulse bg-[var(--rj-surface-muted)]" />
    </div>
  )
}

function formatLabel(value?: string | null) {
  if (!value) {
    return "Not specified"
  }

  return value
    .split("_")
    .map(
      (word) =>
        word.charAt(0).toUpperCase() +
        word.slice(1)
    )
    .join(" ")
}

function formatSessionType(
  value?: string | null
) {
  return formatLabel(value)
}

function formatDate(
  value?: string | null
) {
  if (!value) {
    return "Date not specified"
  }

  return new Intl.DateTimeFormat(
    "en-US",
    {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }
  ).format(new Date(value))
}