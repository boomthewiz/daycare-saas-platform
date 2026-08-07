"use client"

import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import {
  Activity,
  Archive,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  CalendarDays,
  Check,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Edit3,
  ExternalLink,
  FileText,
  ListChecks,
  LoaderCircle,
  PauseCircle,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Sparkles,
  Target,
  Trash2,
  UserRound,
  Users,
  X,
} from "lucide-react"

import { supabase } from "@/lib/supabase"

type ClientStatus =
  | "active"
  | "inactive"
  | "on_hold"
  | "discharged"

type TargetStatus =
  | "active"
  | "paused"
  | "mastered"
  | "discontinued"

type ClientRecord = {
  id: string
  organization_id: string
  first_name: string
  last_name: string | null
  preferred_name: string | null
  status: ClientStatus
  assigned_provider_id: string | null
  created_at: string | null
  updated_at: string | null
}

type ProviderRecord = {
  id: string
  full_name: string | null
  email: string | null
  role: string
  status: string
}

type TargetCategoryRecord = {
  id: string
  name: string
  description: string | null
  active: boolean
  sort_order: number
}

type ClientTargetRecord = {
  id: string
  organization_id: string
  client_id: string
  title: string
  instruction: string | null
  category: string | null
  target_type: string
  response_mode: string
  materials: string | null
  sort_order: number
  status: TargetStatus
  created_at: string | null
  updated_at: string | null
}

type ClientBehaviorRecord = {
  id: string
  organization_id: string
  client_id: string
  name: string
  description: string | null
  measurement_type: string
  active: boolean
  sort_order: number
  created_at: string | null
  updated_at: string | null
}

type SessionRecord = {
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
}

type SessionTypeRecord = {
  id: string
  name: string
  code: string
  active: boolean
}

type PageTab =
  | "overview"
  | "targets"
  | "behaviors"
  | "sessions"

type TargetFormState = {
  title: string
  instruction: string
  category: string
  targetType: string
  responseMode: string
  materials: string
}

type BehaviorFormState = {
  name: string
  description: string
  measurementType: string
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

const TARGET_TYPES = [
  {
    value: "skill_acquisition",
    label: "Skill acquisition",
  },
  {
    value: "communication",
    label: "Communication",
  },
  {
    value: "academic",
    label: "Academic",
  },
  {
    value: "daily_living",
    label: "Daily living",
  },
  {
    value: "social",
    label: "Social",
  },
  {
    value: "behavior_reduction",
    label: "Behavior reduction",
  },
  {
    value: "other",
    label: "Other",
  },
]

const RESPONSE_MODES = [
  {
    value: "independent_prompted",
    label: "Independent / prompted",
  },
  {
    value: "correct_incorrect",
    label: "Correct / incorrect",
  },
  {
    value: "frequency",
    label: "Frequency count",
  },
  {
    value: "duration",
    label: "Duration",
  },
  {
    value: "rating",
    label: "Rating scale",
  },
]

const MEASUREMENT_TYPES = [
  {
    value: "frequency",
    label: "Frequency",
    description: "Count each occurrence.",
  },
  {
    value: "duration",
    label: "Duration",
    description: "Track how long the event lasts.",
  },
  {
    value: "intensity",
    label: "Intensity",
    description: "Rate the event’s intensity.",
  },
  {
    value: "frequency_duration",
    label: "Frequency and duration",
    description: "Count occurrences and track total duration.",
  },
]

const EMPTY_TARGET_FORM: TargetFormState = {
  title: "",
  instruction: "",
  category: "",
  targetType: "skill_acquisition",
  responseMode: "independent_prompted",
  materials: "",
}

const EMPTY_BEHAVIOR_FORM: BehaviorFormState = {
  name: "",
  description: "",
  measurementType: "frequency",
}

export default function ClientDetailPage() {
  const params = useParams<{ clientId: string }>()
  const router = useRouter()

  const clientId = params.clientId

  const [activeTab, setActiveTab] =
    useState<PageTab>("overview")

  const [client, setClient] =
    useState<ClientRecord | null>(null)

  const [providers, setProviders] =
    useState<ProviderRecord[]>([])

  const [categories, setCategories] =
    useState<TargetCategoryRecord[]>([])

  const [targets, setTargets] =
    useState<ClientTargetRecord[]>([])

  const [behaviors, setBehaviors] =
    useState<ClientBehaviorRecord[]>([])

  const [sessions, setSessions] =
    useState<SessionRecord[]>([])

  const [sessionTypes, setSessionTypes] =
    useState<SessionTypeRecord[]>([])

  // Profile form
  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName] = useState("")
  const [preferredName, setPreferredName] = useState("")
  const [clientStatus, setClientStatus] =
    useState<ClientStatus>("active")
  const [assignedProviderId, setAssignedProviderId] =
    useState("")

  // Target form
  const [showTargetForm, setShowTargetForm] =
    useState(false)
  const [editingTargetId, setEditingTargetId] =
    useState<string | null>(null)
  const [targetForm, setTargetForm] =
    useState<TargetFormState>(EMPTY_TARGET_FORM)

  // Behavior form
  const [showBehaviorForm, setShowBehaviorForm] =
    useState(false)
  const [editingBehaviorId, setEditingBehaviorId] =
    useState<string | null>(null)
  const [behaviorForm, setBehaviorForm] =
    useState<BehaviorFormState>(EMPTY_BEHAVIOR_FORM)

  const [targetSearch, setTargetSearch] = useState("")
  const [targetStatusFilter, setTargetStatusFilter] =
    useState("all")

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [savingProfile, setSavingProfile] = useState(false)
  const [savingTarget, setSavingTarget] = useState(false)
  const [savingBehavior, setSavingBehavior] =
    useState(false)
  const [updatingId, setUpdatingId] =
    useState<string | null>(null)

  const [pageError, setPageError] =
    useState<string | null>(null)
  const [successMessage, setSuccessMessage] =
    useState<string | null>(null)

  const loadClientWorkspace = useCallback(
    async (showRefreshState = false) => {
      if (!clientId) return

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
          categoryResult,
          targetResult,
          behaviorResult,
          sessionResult,
          sessionTypeResult,
        ] = await Promise.all([
          supabase
            .from("clients")
            .select(`
              id,
              organization_id,
              first_name,
              last_name,
              preferred_name,
              status,
              assigned_provider_id,
              created_at,
              updated_at
            `)
            .eq("id", clientId)
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
            .from("target_categories")
            .select(`
              id,
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
            .from("client_targets")
            .select(`
              id,
              organization_id,
              client_id,
              title,
              instruction,
              category,
              target_type,
              response_mode,
              materials,
              sort_order,
              status,
              created_at,
              updated_at
            `)
            .eq("client_id", clientId)
            .order("sort_order", {
              ascending: true,
            })
            .order("created_at", {
              ascending: true,
            }),

          supabase
            .from("client_behaviors")
            .select(`
              id,
              organization_id,
              client_id,
              name,
              description,
              measurement_type,
              active,
              sort_order,
              created_at,
              updated_at
            `)
            .eq("client_id", clientId)
            .order("sort_order", {
              ascending: true,
            })
            .order("created_at", {
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
              prepared_at
            `)
            .eq("client_id", clientId)
            .order("scheduled_start", {
              ascending: false,
            })
            .limit(50),

          supabase
            .from("session_types")
            .select(`
              id,
              name,
              code,
              active
            `)
            .order("name", {
              ascending: true,
            }),
        ])

        if (clientResult.error) {
          throw new Error(clientResult.error.message)
        }

        if (providerResult.error) {
          throw new Error(providerResult.error.message)
        }

        if (categoryResult.error) {
          throw new Error(categoryResult.error.message)
        }

        if (targetResult.error) {
          throw new Error(targetResult.error.message)
        }

        if (behaviorResult.error) {
          throw new Error(behaviorResult.error.message)
        }

        if (sessionResult.error) {
          throw new Error(sessionResult.error.message)
        }

        if (sessionTypeResult.error) {
          throw new Error(sessionTypeResult.error.message)
        }

        const loadedClient =
          clientResult.data as ClientRecord

        setClient(loadedClient)

        setProviders(
          (providerResult.data || []) as ProviderRecord[]
        )

        setCategories(
          (categoryResult.data ||
            []) as TargetCategoryRecord[]
        )

        setTargets(
          (targetResult.data ||
            []) as ClientTargetRecord[]
        )

        setBehaviors(
          (behaviorResult.data ||
            []) as ClientBehaviorRecord[]
        )

        setSessions(
          (sessionResult.data ||
            []) as SessionRecord[]
        )

        setSessionTypes(
          (sessionTypeResult.data ||
            []) as SessionTypeRecord[]
        )

        setFirstName(loadedClient.first_name)
        setLastName(loadedClient.last_name || "")
        setPreferredName(
          loadedClient.preferred_name || ""
        )
        setClientStatus(loadedClient.status)
        setAssignedProviderId(
          loadedClient.assigned_provider_id || ""
        )
      } catch (error) {
        console.error(
          "Load client workspace error:",
          error
        )

        setPageError(
          error instanceof Error
            ? error.message
            : "Unable to load the client workspace."
        )
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [clientId]
  )

  useEffect(() => {
    loadClientWorkspace()
  }, [loadClientWorkspace])

  const displayName = useMemo(() => {
    if (!client) return "Client"

    return (
      client.preferred_name?.trim() ||
      [client.first_name, client.last_name]
        .filter(Boolean)
        .join(" ")
    )
  }, [client])

  const assignedProvider = useMemo(
    () =>
      providers.find(
        (provider) =>
          provider.id === assignedProviderId
      ) || null,
    [assignedProviderId, providers]
  )

  const sessionTypeMap = useMemo(
    () =>
      new Map(
        sessionTypes.map((type) => [
          type.code,
          type.name,
        ])
      ),
    [sessionTypes]
  )

  const activeTargets = targets.filter(
    (target) => target.status === "active"
  )

  const activeBehaviors = behaviors.filter(
    (behavior) => behavior.active
  )

  const upcomingSessions = sessions.filter(
    (session) =>
      ["scheduled", "confirmed"].includes(
        session.status
      ) &&
      (!session.scheduled_start ||
        new Date(session.scheduled_start).getTime() >=
          Date.now())
  )

  const completedSessions = sessions.filter(
    (session) => session.status === "completed"
  )

  const filteredTargets = useMemo(() => {
    const search = targetSearch
      .trim()
      .toLowerCase()

    return targets.filter((target) => {
      const matchesSearch =
        !search ||
        [
          target.title,
          target.instruction,
          target.category,
          target.target_type,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(search)

      const matchesStatus =
        targetStatusFilter === "all" ||
        target.status === targetStatusFilter

      return matchesSearch && matchesStatus
    })
  }, [targetSearch, targetStatusFilter, targets])

  const saveProfile = async (
    event: FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault()

    if (!client) return

    if (!firstName.trim()) {
      setPageError("A first name is required.")
      return
    }

    setSavingProfile(true)
    setPageError(null)
    setSuccessMessage(null)

    try {
      const { error } = await supabase
        .from("clients")
        .update({
          first_name: firstName.trim(),
          last_name: lastName.trim() || null,
          preferred_name:
            preferredName.trim() || null,
          status: clientStatus,
          assigned_provider_id:
            assignedProviderId || null,
        })
        .eq("id", client.id)

      if (error) {
        throw new Error(error.message)
      }

      setSuccessMessage(
        "Client profile saved successfully."
      )

      await loadClientWorkspace()
    } catch (error) {
      console.error("Save client profile error:", error)

      setPageError(
        error instanceof Error
          ? error.message
          : "Unable to save the client profile."
      )
    } finally {
      setSavingProfile(false)
    }
  }

  const openCreateTargetForm = () => {
    setEditingTargetId(null)
    setTargetForm({
      ...EMPTY_TARGET_FORM,
      category: categories[0]?.name || "",
    })
    setShowTargetForm(true)
    setPageError(null)
    setSuccessMessage(null)
  }

  const openEditTargetForm = (
    target: ClientTargetRecord
  ) => {
    setEditingTargetId(target.id)

    setTargetForm({
      title: target.title,
      instruction: target.instruction || "",
      category: target.category || "",
      targetType: target.target_type,
      responseMode: target.response_mode,
      materials: target.materials || "",
    })

    setShowTargetForm(true)
    setPageError(null)
    setSuccessMessage(null)

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    })
  }

  const closeTargetForm = () => {
    setEditingTargetId(null)
    setTargetForm(EMPTY_TARGET_FORM)
    setShowTargetForm(false)
  }

  const saveTarget = async (
    event: FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault()

    if (!client) return

    if (!targetForm.title.trim()) {
      setPageError("A target title is required.")
      return
    }

    setSavingTarget(true)
    setPageError(null)
    setSuccessMessage(null)

    try {
      const values = {
        organization_id: client.organization_id,
        client_id: client.id,
        title: targetForm.title.trim(),
        instruction:
          targetForm.instruction.trim() || null,
        category:
          targetForm.category.trim() || null,
        target_type: targetForm.targetType,
        response_mode: targetForm.responseMode,
        materials:
          targetForm.materials.trim() || null,
      }

      if (editingTargetId) {
        const { error } = await supabase
          .from("client_targets")
          .update(values)
          .eq("id", editingTargetId)

        if (error) {
          throw new Error(error.message)
        }

        setSuccessMessage(
          "Target updated successfully."
        )
      } else {
        const nextSortOrder =
          getNextSortOrder(targets)

        const { error } = await supabase
          .from("client_targets")
          .insert({
            ...values,
            sort_order: nextSortOrder,
            status: "active",
          })

        if (error) {
          throw new Error(error.message)
        }

        setSuccessMessage(
          "Target created successfully."
        )
      }

      closeTargetForm()
      await loadClientWorkspace()
    } catch (error) {
      console.error("Save target error:", error)

      setPageError(
        error instanceof Error
          ? error.message
          : "Unable to save the target."
      )
    } finally {
      setSavingTarget(false)
    }
  }

  const changeTargetStatus = async (
    target: ClientTargetRecord,
    nextStatus: TargetStatus
  ) => {
    setUpdatingId(target.id)
    setPageError(null)
    setSuccessMessage(null)

    try {
      const { error } = await supabase
        .from("client_targets")
        .update({
          status: nextStatus,
        })
        .eq("id", target.id)

      if (error) {
        throw new Error(error.message)
      }

      setSuccessMessage(
        `${target.title} is now ${formatLabel(
          nextStatus
        ).toLowerCase()}.`
      )

      await loadClientWorkspace()
    } catch (error) {
      console.error(
        "Change target status error:",
        error
      )

      setPageError(
        error instanceof Error
          ? error.message
          : "Unable to update the target."
      )
    } finally {
      setUpdatingId(null)
    }
  }

  const moveTarget = async (
    targetIndex: number,
    direction: "up" | "down"
  ) => {
    const otherIndex =
      direction === "up"
        ? targetIndex - 1
        : targetIndex + 1

    if (
      otherIndex < 0 ||
      otherIndex >= filteredTargets.length
    ) {
      return
    }

    const currentTarget =
      filteredTargets[targetIndex]
    const otherTarget =
      filteredTargets[otherIndex]

    setUpdatingId(currentTarget.id)
    setPageError(null)

    try {
      const temporarySortOrder = -1000000

      const { error: firstError } = await supabase
        .from("client_targets")
        .update({
          sort_order: temporarySortOrder,
        })
        .eq("id", currentTarget.id)

      if (firstError) {
        throw new Error(firstError.message)
      }

      const { error: secondError } = await supabase
        .from("client_targets")
        .update({
          sort_order: currentTarget.sort_order,
        })
        .eq("id", otherTarget.id)

      if (secondError) {
        throw new Error(secondError.message)
      }

      const { error: thirdError } = await supabase
        .from("client_targets")
        .update({
          sort_order: otherTarget.sort_order,
        })
        .eq("id", currentTarget.id)

      if (thirdError) {
        throw new Error(thirdError.message)
      }

      await loadClientWorkspace()
    } catch (error) {
      console.error("Move target error:", error)

      setPageError(
        error instanceof Error
          ? error.message
          : "Unable to reorder the target."
      )

      await loadClientWorkspace()
    } finally {
      setUpdatingId(null)
    }
  }

  const openCreateBehaviorForm = () => {
    setEditingBehaviorId(null)
    setBehaviorForm(EMPTY_BEHAVIOR_FORM)
    setShowBehaviorForm(true)
    setPageError(null)
    setSuccessMessage(null)
  }

  const openEditBehaviorForm = (
    behavior: ClientBehaviorRecord
  ) => {
    setEditingBehaviorId(behavior.id)

    setBehaviorForm({
      name: behavior.name,
      description: behavior.description || "",
      measurementType:
        behavior.measurement_type,
    })

    setShowBehaviorForm(true)
    setPageError(null)
    setSuccessMessage(null)

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    })
  }

  const closeBehaviorForm = () => {
    setEditingBehaviorId(null)
    setBehaviorForm(EMPTY_BEHAVIOR_FORM)
    setShowBehaviorForm(false)
  }

  const saveBehavior = async (
    event: FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault()

    if (!client) return

    if (!behaviorForm.name.trim()) {
      setPageError("A behavior name is required.")
      return
    }

    setSavingBehavior(true)
    setPageError(null)
    setSuccessMessage(null)

    try {
      const values = {
        organization_id: client.organization_id,
        client_id: client.id,
        name: behaviorForm.name.trim(),
        description:
          behaviorForm.description.trim() || null,
        measurement_type:
          behaviorForm.measurementType,
      }

      if (editingBehaviorId) {
        const { error } = await supabase
          .from("client_behaviors")
          .update(values)
          .eq("id", editingBehaviorId)

        if (error) {
          throw new Error(error.message)
        }

        setSuccessMessage(
          "Behavior definition updated."
        )
      } else {
        const { error } = await supabase
          .from("client_behaviors")
          .insert({
            ...values,
            active: true,
            sort_order:
              getNextSortOrder(behaviors),
          })

        if (error) {
          throw new Error(error.message)
        }

        setSuccessMessage(
          "Behavior definition created."
        )
      }

      closeBehaviorForm()
      await loadClientWorkspace()
    } catch (error) {
      console.error("Save behavior error:", error)

      setPageError(
        error instanceof Error
          ? error.message
          : "Unable to save the behavior definition."
      )
    } finally {
      setSavingBehavior(false)
    }
  }

  const toggleBehavior = async (
    behavior: ClientBehaviorRecord
  ) => {
    setUpdatingId(behavior.id)
    setPageError(null)
    setSuccessMessage(null)

    try {
      const { error } = await supabase
        .from("client_behaviors")
        .update({
          active: !behavior.active,
        })
        .eq("id", behavior.id)

      if (error) {
        throw new Error(error.message)
      }

      setSuccessMessage(
        `${behavior.name} is now ${
          behavior.active ? "inactive" : "active"
        }.`
      )

      await loadClientWorkspace()
    } catch (error) {
      console.error(
        "Toggle behavior error:",
        error
      )

      setPageError(
        error instanceof Error
          ? error.message
          : "Unable to update the behavior definition."
      )
    } finally {
      setUpdatingId(null)
    }
  }

  const archiveClient = async () => {
    if (!client) return

    const confirmed = window.confirm(
      "Archive this client? Existing sessions and documentation will remain available."
    )

    if (!confirmed) return

    setSavingProfile(true)
    setPageError(null)

    try {
      const { error } = await supabase
        .from("clients")
        .update({
          status: "inactive",
        })
        .eq("id", client.id)

      if (error) {
        throw new Error(error.message)
      }

      router.push("/team-management")
      router.refresh()
    } catch (error) {
      console.error("Archive client error:", error)

      setPageError(
        error instanceof Error
          ? error.message
          : "Unable to archive the client."
      )

      setSavingProfile(false)
    }
  }

  if (loading) {
    return <ClientWorkspaceLoading />
  }

  if (!client) {
    return (
      <div className="mx-auto max-w-xl">
        <section className="rj-card p-8 text-center">
          <CircleAlert
            size={36}
            className="mx-auto text-[var(--rj-danger)]"
          />

          <h1 className="rj-heading-2 mt-4">
            Client unavailable
          </h1>

          <p className="rj-body mt-2 text-[var(--rj-text-secondary)]">
            {pageError ||
              "This client could not be loaded."}
          </p>

          <Link
            href="/team-management"
            className="rj-button rj-button-primary mt-6"
          >
            <ArrowLeft size={19} />
            Back to People
          </Link>
        </section>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Top controls */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <Link
          href="/team-management"
          className="inline-flex items-center gap-2 font-bold text-[var(--rj-teal-700)]"
        >
          <ArrowLeft size={18} />
          People
        </Link>

        <button
          type="button"
          onClick={() =>
            loadClientWorkspace(true)
          }
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
      <header className="relative overflow-hidden rounded-[var(--rj-radius-xl)] border border-[var(--rj-border)] bg-white p-6 shadow-[var(--rj-shadow-soft)] sm:p-8">
        <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-[var(--rj-blue-100)] opacity-65" />

        <div className="pointer-events-none absolute -bottom-24 right-36 h-48 w-48 rounded-full bg-[var(--rj-lavender-100)] opacity-55" />

        <div className="relative flex flex-col justify-between gap-6 lg:flex-row lg:items-center">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-full bg-[var(--rj-teal-50)] px-3 py-1.5 text-sm font-bold text-[var(--rj-teal-700)]">
                <Sparkles size={15} />
                Client Workspace
              </span>

              <ClientStatusBadge
                status={client.status}
              />
            </div>

            <h1 className="rj-heading-1 mt-4">
              {displayName}
            </h1>

            <p className="rj-body mt-3 text-[var(--rj-text-secondary)]">
              Manage profile details, goals, behavior
              tracking, and scheduled services.
            </p>

            <p className="rj-caption mt-2">
              Primary worker:{" "}
              {assignedProvider?.full_name ||
                assignedProvider?.email ||
                "Not assigned"}
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Link
              href={`/sessions?client=${client.id}`}
              className="rj-button rj-button-primary"
            >
              <CalendarDays size={19} />
              Create Session
            </Link>

            <button
              type="button"
              onClick={archiveClient}
              disabled={
                savingProfile ||
                client.status === "inactive"
              }
              className="rj-button rj-button-secondary"
            >
              <Archive size={18} />
              Archive Client
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

      {successMessage && (
        <MessageBanner
          success
          title="Changes saved"
          message={successMessage}
        />
      )}

      {/* Summary cards */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          label="Active Targets"
          value={activeTargets.length}
          icon={Target}
          background="var(--rj-blue-100)"
          foreground="var(--rj-blue-700)"
        />

        <SummaryCard
          label="Tracked Behaviors"
          value={activeBehaviors.length}
          icon={Activity}
          background="var(--rj-lavender-100)"
          foreground="var(--rj-lavender-700)"
        />

        <SummaryCard
          label="Upcoming Sessions"
          value={upcomingSessions.length}
          icon={CalendarDays}
          background="var(--rj-teal-100)"
          foreground="var(--rj-teal-700)"
        />

        <SummaryCard
          label="Completed Sessions"
          value={completedSessions.length}
          icon={CheckCircle2}
          background="var(--rj-mint-100)"
          foreground="var(--rj-mint-700)"
        />
      </section>

      {/* Tabs */}
      <section className="rj-card p-2">
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <PageTabButton
            active={activeTab === "overview"}
            label="Overview"
            icon={UserRound}
            onClick={() =>
              setActiveTab("overview")
            }
          />

          <PageTabButton
            active={activeTab === "targets"}
            label="Targets"
            count={targets.length}
            icon={Target}
            onClick={() =>
              setActiveTab("targets")
            }
          />

          <PageTabButton
            active={activeTab === "behaviors"}
            label="Behaviors"
            count={behaviors.length}
            icon={Activity}
            onClick={() =>
              setActiveTab("behaviors")
            }
          />

          <PageTabButton
            active={activeTab === "sessions"}
            label="Sessions"
            count={sessions.length}
            icon={CalendarDays}
            onClick={() =>
              setActiveTab("sessions")
            }
          />
        </div>
      </section>

      {activeTab === "overview" && (
        <OverviewTab
          firstName={firstName}
          lastName={lastName}
          preferredName={preferredName}
          clientStatus={clientStatus}
          assignedProviderId={assignedProviderId}
          providers={providers}
          saving={savingProfile}
          setFirstName={setFirstName}
          setLastName={setLastName}
          setPreferredName={setPreferredName}
          setClientStatus={setClientStatus}
          setAssignedProviderId={
            setAssignedProviderId
          }
          onSubmit={saveProfile}
        />
      )}

      {activeTab === "targets" && (
        <div className="space-y-6">
          {showTargetForm && (
            <TargetForm
              form={targetForm}
              editing={Boolean(editingTargetId)}
              categories={categories}
              saving={savingTarget}
              setForm={setTargetForm}
              onSubmit={saveTarget}
              onCancel={closeTargetForm}
            />
          )}

          <section className="rj-card overflow-hidden">
            <div className="border-b border-[var(--rj-border)] p-6">
              <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
                <div>
                  <p className="rj-label">
                    Client Program
                  </p>

                  <h2 className="rj-heading-2 mt-1">
                    Targets and Goals
                  </h2>

                  <p className="rj-caption mt-2">
                    Active targets are copied into newly
                    prepared sessions.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={openCreateTargetForm}
                  className="rj-button rj-button-primary"
                >
                  <Plus size={19} />
                  Add Target
                </button>
              </div>

              <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                <div className="relative flex-1">
                  <Search
                    size={18}
                    className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--rj-text-muted)]"
                  />

                  <input
                    type="search"
                    value={targetSearch}
                    onChange={(event) =>
                      setTargetSearch(
                        event.target.value
                      )
                    }
                    placeholder="Search targets…"
                    className="rj-input pl-11"
                  />
                </div>

                <select
                  value={targetStatusFilter}
                  onChange={(event) =>
                    setTargetStatusFilter(
                      event.target.value
                    )
                  }
                  className="rj-input sm:max-w-[200px]"
                >
                  <option value="all">
                    All statuses
                  </option>
                  <option value="active">
                    Active
                  </option>
                  <option value="paused">
                    Paused
                  </option>
                  <option value="mastered">
                    Mastered
                  </option>
                  <option value="discontinued">
                    Discontinued
                  </option>
                </select>
              </div>
            </div>

            {filteredTargets.length === 0 ? (
              <EmptyState
                icon={Target}
                title="No matching targets"
                description="Create a target or adjust your filters."
                actionLabel="Add Target"
                onAction={openCreateTargetForm}
              />
            ) : (
              <div className="divide-y divide-[var(--rj-border)]">
                {filteredTargets.map(
                  (target, index) => (
                    <TargetRow
                      key={target.id}
                      target={target}
                      index={index}
                      total={
                        filteredTargets.length
                      }
                      updating={
                        updatingId === target.id
                      }
                      onEdit={() =>
                        openEditTargetForm(target)
                      }
                      onMoveUp={() =>
                        moveTarget(index, "up")
                      }
                      onMoveDown={() =>
                        moveTarget(index, "down")
                      }
                      onStatusChange={(
                        nextStatus
                      ) =>
                        changeTargetStatus(
                          target,
                          nextStatus
                        )
                      }
                    />
                  )
                )}
              </div>
            )}
          </section>
        </div>
      )}

      {activeTab === "behaviors" && (
        <div className="space-y-6">
          {showBehaviorForm && (
            <BehaviorForm
              form={behaviorForm}
              editing={Boolean(
                editingBehaviorId
              )}
              saving={savingBehavior}
              setForm={setBehaviorForm}
              onSubmit={saveBehavior}
              onCancel={closeBehaviorForm}
            />
          )}

          <section className="rj-card overflow-hidden">
            <div className="flex flex-col justify-between gap-5 border-b border-[var(--rj-border)] p-6 sm:flex-row sm:items-center">
              <div>
                <p className="rj-label">
                  Session Tracking
                </p>

                <h2 className="rj-heading-2 mt-1">
                  Behavior Definitions
                </h2>

                <p className="rj-caption mt-2">
                  Active behaviors appear as quick actions
                  in the frontline session workspace.
                </p>
              </div>

              <button
                type="button"
                onClick={openCreateBehaviorForm}
                className="rj-button rj-button-primary"
              >
                <Plus size={19} />
                Add Behavior
              </button>
            </div>

            {behaviors.length === 0 ? (
              <EmptyState
                icon={Activity}
                title="No behaviors configured"
                description="Add a behavior definition when tracking is needed."
                actionLabel="Add Behavior"
                onAction={openCreateBehaviorForm}
              />
            ) : (
              <div className="divide-y divide-[var(--rj-border)]">
                {behaviors.map((behavior) => (
                  <BehaviorRow
                    key={behavior.id}
                    behavior={behavior}
                    updating={
                      updatingId === behavior.id
                    }
                    onEdit={() =>
                      openEditBehaviorForm(
                        behavior
                      )
                    }
                    onToggle={() =>
                      toggleBehavior(behavior)
                    }
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {activeTab === "sessions" && (
        <SessionsTab
          sessions={sessions}
          providers={providers}
          sessionTypeMap={sessionTypeMap}
          clientId={client.id}
        />
      )}
    </div>
  )
}

function OverviewTab({
  firstName,
  lastName,
  preferredName,
  clientStatus,
  assignedProviderId,
  providers,
  saving,
  setFirstName,
  setLastName,
  setPreferredName,
  setClientStatus,
  setAssignedProviderId,
  onSubmit,
}: {
  firstName: string
  lastName: string
  preferredName: string
  clientStatus: ClientStatus
  assignedProviderId: string
  providers: ProviderRecord[]
  saving: boolean
  setFirstName: (value: string) => void
  setLastName: (value: string) => void
  setPreferredName: (value: string) => void
  setClientStatus: (value: ClientStatus) => void
  setAssignedProviderId: (value: string) => void
  onSubmit: (
    event: FormEvent<HTMLFormElement>
  ) => void
}) {
  return (
    <section className="rj-card p-6 sm:p-8">
      <div className="flex items-center gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--rj-blue-100)] text-[var(--rj-blue-700)]">
          <UserRound size={25} />
        </div>

        <div>
          <p className="rj-label">
            Client Profile
          </p>

          <h2 className="rj-heading-2 mt-1">
            General information
          </h2>
        </div>
      </div>

      <form
        onSubmit={onSubmit}
        className="mt-8 grid gap-5 md:grid-cols-2"
      >
        <FormField label="First name">
          <input
            value={firstName}
            onChange={(event) =>
              setFirstName(event.target.value)
            }
            className="rj-input"
            required
          />
        </FormField>

        <FormField label="Last name">
          <input
            value={lastName}
            onChange={(event) =>
              setLastName(event.target.value)
            }
            className="rj-input"
          />
        </FormField>

        <FormField label="Preferred name">
          <input
            value={preferredName}
            onChange={(event) =>
              setPreferredName(
                event.target.value
              )
            }
            className="rj-input"
          />
        </FormField>

        <FormField label="Client status">
          <select
            value={clientStatus}
            onChange={(event) =>
              setClientStatus(
                event.target
                  .value as ClientStatus
              )
            }
            className="rj-input"
          >
            <option value="active">
              Active
            </option>
            <option value="on_hold">
              On hold
            </option>
            <option value="discharged">
              Discharged
            </option>
            <option value="inactive">
              Inactive
            </option>
          </select>
        </FormField>

        <div className="md:col-span-2">
          <FormField label="Primary frontline worker">
            <select
              value={assignedProviderId}
              onChange={(event) =>
                setAssignedProviderId(
                  event.target.value
                )
              }
              className="rj-input"
            >
              <option value="">
                Not assigned
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

            <p className="rj-caption mt-2">
              This is the client’s default worker.
              Individual sessions can still be assigned to
              someone else.
            </p>
          </FormField>
        </div>

        <div className="md:col-span-2">
          <button
            type="submit"
            disabled={saving}
            className="rj-button rj-button-primary"
          >
            {saving ? (
              <LoaderCircle
                size={19}
                className="animate-spin"
              />
            ) : (
              <Save size={19} />
            )}

            {saving
              ? "Saving Profile…"
              : "Save Profile"}
          </button>
        </div>
      </form>
    </section>
  )
}

function TargetForm({
  form,
  editing,
  categories,
  saving,
  setForm,
  onSubmit,
  onCancel,
}: {
  form: TargetFormState
  editing: boolean
  categories: TargetCategoryRecord[]
  saving: boolean
  setForm: (value: TargetFormState) => void
  onSubmit: (
    event: FormEvent<HTMLFormElement>
  ) => void
  onCancel: () => void
}) {
  return (
    <section className="rj-card p-6 sm:p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="rj-label">
            {editing
              ? "Edit Client Target"
              : "New Client Target"}
          </p>

          <h2 className="rj-heading-2 mt-1">
            {editing
              ? "Update target"
              : "Create target"}
          </h2>
        </div>

        <button
          type="button"
          onClick={onCancel}
          className="rj-icon-button"
          aria-label="Close target form"
        >
          <X size={19} />
        </button>
      </div>

      <form
        onSubmit={onSubmit}
        className="mt-6 grid gap-5 md:grid-cols-2"
      >
        <div className="md:col-span-2">
          <FormField label="Target title">
            <input
              value={form.title}
              onChange={(event) =>
                setForm({
                  ...form,
                  title: event.target.value,
                })
              }
              placeholder="Example: Request preferred item"
              className="rj-input"
              required
            />
          </FormField>
        </div>

        <FormField label="Category">
          <select
            value={form.category}
            onChange={(event) =>
              setForm({
                ...form,
                category: event.target.value,
              })
            }
            className="rj-input"
          >
            <option value="">
              No category
            </option>

            {categories.map((category) => (
              <option
                key={category.id}
                value={category.name}
              >
                {category.name}
              </option>
            ))}
          </select>
        </FormField>

        <FormField label="Target type">
          <select
            value={form.targetType}
            onChange={(event) =>
              setForm({
                ...form,
                targetType:
                  event.target.value,
              })
            }
            className="rj-input"
          >
            {TARGET_TYPES.map((type) => (
              <option
                key={type.value}
                value={type.value}
              >
                {type.label}
              </option>
            ))}
          </select>
        </FormField>

        <FormField label="Response format">
          <select
            value={form.responseMode}
            onChange={(event) =>
              setForm({
                ...form,
                responseMode:
                  event.target.value,
              })
            }
            className="rj-input"
          >
            {RESPONSE_MODES.map((mode) => (
              <option
                key={mode.value}
                value={mode.value}
              >
                {mode.label}
              </option>
            ))}
          </select>
        </FormField>

        <FormField label="Materials">
          <input
            value={form.materials}
            onChange={(event) =>
              setForm({
                ...form,
                materials:
                  event.target.value,
              })
            }
            placeholder="Flash cards, visual schedule…"
            className="rj-input"
          />
        </FormField>

        <div className="md:col-span-2">
          <FormField label="Instructions">
            <textarea
              value={form.instruction}
              onChange={(event) =>
                setForm({
                  ...form,
                  instruction:
                    event.target.value,
                })
              }
              rows={4}
              placeholder="Describe the instruction, expected response, and prompting guidance."
              className="rj-input resize-none"
            />
          </FormField>
        </div>

        <div className="flex gap-3 md:col-span-2">
          <button
            type="submit"
            disabled={saving}
            className="rj-button rj-button-primary"
          >
            {saving ? (
              <LoaderCircle
                size={19}
                className="animate-spin"
              />
            ) : (
              <Save size={19} />
            )}

            {saving
              ? "Saving Target…"
              : editing
                ? "Save Changes"
                : "Create Target"}
          </button>

          <button
            type="button"
            onClick={onCancel}
            className="rj-button rj-button-secondary"
          >
            Cancel
          </button>
        </div>
      </form>
    </section>
  )
}

function TargetRow({
  target,
  index,
  total,
  updating,
  onEdit,
  onMoveUp,
  onMoveDown,
  onStatusChange,
}: {
  target: ClientTargetRecord
  index: number
  total: number
  updating: boolean
  onEdit: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onStatusChange: (
    status: TargetStatus
  ) => void
}) {
  return (
    <article className="p-5 sm:p-6">
      <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-start">
        <div className="flex min-w-0 gap-4">
          <div
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${
              target.status === "mastered"
                ? "bg-[var(--rj-success-soft)] text-[var(--rj-mint-700)]"
                : target.status === "active"
                  ? "bg-[var(--rj-blue-100)] text-[var(--rj-blue-700)]"
                  : "bg-[var(--rj-surface-muted)] text-[var(--rj-text-muted)]"
            }`}
          >
            {target.status === "mastered" ? (
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

              <TargetStatusBadge
                status={target.status}
              />

              {target.category && (
                <span className="rj-badge rj-badge-info">
                  {target.category}
                </span>
              )}
            </div>

            <p className="rj-caption mt-2">
              {formatLabel(
                target.target_type
              )}
              {" · "}
              {formatLabel(
                target.response_mode
              )}
            </p>

            {target.instruction && (
              <p className="rj-body mt-3 text-[var(--rj-text-secondary)]">
                {target.instruction}
              </p>
            )}

            {target.materials && (
              <div className="mt-3 rounded-[var(--rj-radius-md)] bg-[var(--rj-surface-muted)] p-3">
                <p className="text-sm">
                  <strong>Materials:</strong>{" "}
                  {target.materials}
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={index === 0 || updating}
            className="rj-icon-button disabled:opacity-35"
            aria-label={`Move ${target.title} up`}
          >
            <ArrowUp size={18} />
          </button>

          <button
            type="button"
            onClick={onMoveDown}
            disabled={
              index === total - 1 || updating
            }
            className="rj-icon-button disabled:opacity-35"
            aria-label={`Move ${target.title} down`}
          >
            <ArrowDown size={18} />
          </button>

          <button
            type="button"
            onClick={onEdit}
            disabled={updating}
            className="rj-icon-button"
            aria-label={`Edit ${target.title}`}
          >
            <Edit3 size={18} />
          </button>

          <select
            value={target.status}
            onChange={(event) =>
              onStatusChange(
                event.target
                  .value as TargetStatus
              )
            }
            disabled={updating}
            className="rj-input min-h-11 w-auto py-2"
            aria-label={`Change ${target.title} status`}
          >
            <option value="active">
              Active
            </option>
            <option value="paused">
              Paused
            </option>
            <option value="mastered">
              Mastered
            </option>
            <option value="discontinued">
              Discontinued
            </option>
          </select>
        </div>
      </div>
    </article>
  )
}

function BehaviorForm({
  form,
  editing,
  saving,
  setForm,
  onSubmit,
  onCancel,
}: {
  form: BehaviorFormState
  editing: boolean
  saving: boolean
  setForm: (value: BehaviorFormState) => void
  onSubmit: (
    event: FormEvent<HTMLFormElement>
  ) => void
  onCancel: () => void
}) {
  const selectedMeasurement =
    MEASUREMENT_TYPES.find(
      (item) =>
        item.value === form.measurementType
    )

  return (
    <section className="rj-card p-6 sm:p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="rj-label">
            {editing
              ? "Edit Behavior Definition"
              : "New Behavior Definition"}
          </p>

          <h2 className="rj-heading-2 mt-1">
            {editing
              ? "Update behavior"
              : "Create behavior"}
          </h2>
        </div>

        <button
          type="button"
          onClick={onCancel}
          className="rj-icon-button"
          aria-label="Close behavior form"
        >
          <X size={19} />
        </button>
      </div>

      <form
        onSubmit={onSubmit}
        className="mt-6 grid gap-5 md:grid-cols-2"
      >
        <FormField label="Behavior name">
          <input
            value={form.name}
            onChange={(event) =>
              setForm({
                ...form,
                name: event.target.value,
              })
            }
            placeholder="Example: Elopement"
            className="rj-input"
            required
          />
        </FormField>

        <FormField label="Measurement type">
          <select
            value={form.measurementType}
            onChange={(event) =>
              setForm({
                ...form,
                measurementType:
                  event.target.value,
              })
            }
            className="rj-input"
          >
            {MEASUREMENT_TYPES.map(
              (measurement) => (
                <option
                  key={measurement.value}
                  value={measurement.value}
                >
                  {measurement.label}
                </option>
              )
            )}
          </select>

          {selectedMeasurement && (
            <p className="rj-caption mt-2">
              {selectedMeasurement.description}
            </p>
          )}
        </FormField>

        <div className="md:col-span-2">
          <FormField label="Definition and guidance">
            <textarea
              value={form.description}
              onChange={(event) =>
                setForm({
                  ...form,
                  description:
                    event.target.value,
                })
              }
              rows={4}
              placeholder="Describe what counts as an occurrence and when staff should record it."
              className="rj-input resize-none"
            />
          </FormField>
        </div>

        <div className="flex gap-3 md:col-span-2">
          <button
            type="submit"
            disabled={saving}
            className="rj-button rj-button-primary"
          >
            {saving ? (
              <LoaderCircle
                size={19}
                className="animate-spin"
              />
            ) : (
              <Save size={19} />
            )}

            {saving
              ? "Saving Behavior…"
              : editing
                ? "Save Changes"
                : "Create Behavior"}
          </button>

          <button
            type="button"
            onClick={onCancel}
            className="rj-button rj-button-secondary"
          >
            Cancel
          </button>
        </div>
      </form>
    </section>
  )
}

function BehaviorRow({
  behavior,
  updating,
  onEdit,
  onToggle,
}: {
  behavior: ClientBehaviorRecord
  updating: boolean
  onEdit: () => void
  onToggle: () => void
}) {
  return (
    <article className="flex flex-col justify-between gap-5 p-5 sm:flex-row sm:items-center sm:p-6">
      <div className="flex min-w-0 gap-4">
        <div
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${
            behavior.active
              ? "bg-[var(--rj-lavender-100)] text-[var(--rj-lavender-700)]"
              : "bg-[var(--rj-surface-muted)] text-[var(--rj-text-muted)]"
          }`}
        >
          <Activity size={22} />
        </div>

        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-bold">
              {behavior.name}
            </h3>

            <span
              className={`rj-badge ${
                behavior.active
                  ? "rj-badge-success"
                  : "rj-badge-warning"
              }`}
            >
              {behavior.active
                ? "Active"
                : "Inactive"}
            </span>

            <span className="rj-badge rj-badge-info">
              {formatLabel(
                behavior.measurement_type
              )}
            </span>
          </div>

          {behavior.description && (
            <p className="rj-body mt-2 text-[var(--rj-text-secondary)]">
              {behavior.description}
            </p>
          )}
        </div>
      </div>

      <div className="flex shrink-0 gap-3">
        <button
          type="button"
          onClick={onEdit}
          disabled={updating}
          className="rj-button rj-button-secondary"
        >
          <Edit3 size={17} />
          Edit
        </button>

        <button
          type="button"
          onClick={onToggle}
          disabled={updating}
          className="rj-button rj-button-soft"
        >
          {updating ? (
            <LoaderCircle
              size={18}
              className="animate-spin"
            />
          ) : behavior.active ? (
            <PauseCircle size={18} />
          ) : (
            <RotateCcw size={18} />
          )}

          {behavior.active
            ? "Deactivate"
            : "Reactivate"}
        </button>
      </div>
    </article>
  )
}

function SessionsTab({
  sessions,
  providers,
  sessionTypeMap,
  clientId,
}: {
  sessions: SessionRecord[]
  providers: ProviderRecord[]
  sessionTypeMap: Map<string, string>
  clientId: string
}) {
  const providerMap = new Map(
    providers.map((provider) => [
      provider.id,
      provider.full_name ||
        provider.email ||
        "Team member",
    ])
  )

  return (
    <section className="rj-card overflow-hidden">
      <div className="flex flex-col justify-between gap-5 border-b border-[var(--rj-border)] p-6 sm:flex-row sm:items-center">
        <div>
          <p className="rj-label">
            Service History
          </p>

          <h2 className="rj-heading-2 mt-1">
            Client Sessions
          </h2>

          <p className="rj-caption mt-2">
            Upcoming and completed services for this
            client.
          </p>
        </div>

        <Link
          href={`/sessions?client=${clientId}`}
          className="rj-button rj-button-primary"
        >
          <Plus size={19} />
          Create Session
        </Link>
      </div>

      {sessions.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title="No sessions scheduled"
          description="Create the first session after adding active targets."
          actionLabel="Create Session"
          actionHref={`/sessions?client=${clientId}`}
        />
      ) : (
        <div className="divide-y divide-[var(--rj-border)]">
          {sessions.map((session) => {
            const providerName =
              session.provider_id
                ? providerMap.get(
                    session.provider_id
                  ) || "Assigned worker"
                : "Unassigned"

            const sessionType =
              sessionTypeMap.get(
                session.session_type
              ) ||
              formatLabel(
                session.session_type
              )

            return (
              <article
                key={session.id}
                className="p-5 sm:p-6"
              >
                <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-bold">
                        {formatDateRange(
                          session.scheduled_start,
                          session.scheduled_end
                        )}
                      </h3>

                      <SessionStatusBadge
                        status={session.status}
                      />

                      <span
                        className={`rj-badge ${
                          session.prepared_at
                            ? "rj-badge-success"
                            : "rj-badge-warning"
                        }`}
                      >
                        {session.prepared_at
                          ? "Prepared"
                          : "Needs preparation"}
                      </span>
                    </div>

                    <p className="rj-caption mt-2">
                      {sessionType}
                      {" · "}
                      {providerName}
                    </p>

                    {session.location && (
                      <p className="rj-caption mt-1">
                        {session.location}
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 gap-3">
                    <Link
                      href={`/sessions/${session.id}`}
                      className="rj-button rj-button-primary"
                    >
                      Manage
                      <ArrowRight size={17} />
                    </Link>

                    <Link
                      href={`/session/${session.id}`}
                      className="rj-button rj-button-secondary"
                    >
                      Workspace
                      <ExternalLink size={17} />
                    </Link>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}

function PageTabButton({
  active,
  label,
  count,
  icon: Icon,
  onClick,
}: {
  active: boolean
  label: string
  count?: number
  icon: typeof UserRound
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
      <Icon size={20} />
      {label}

      {typeof count === "number" && (
        <span className="rounded-full bg-white px-2 py-0.5 text-xs">
          {count}
        </span>
      )}
    </button>
  )
}

function SummaryCard({
  label,
  value,
  icon: Icon,
  background,
  foreground,
}: {
  label: string
  value: number
  icon: typeof UserRound
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

function FormField({
  label,
  children,
}: {
  label: string
  children: ReactNode
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

function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  actionHref,
}: {
  icon: typeof UserRound
  title: string
  description: string
  actionLabel?: string
  onAction?: () => void
  actionHref?: string
}) {
  return (
    <div className="p-10 text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[var(--rj-blue-100)] text-[var(--rj-blue-700)]">
        <Icon size={28} />
      </div>

      <h3 className="rj-heading-3 mt-4">
        {title}
      </h3>

      <p className="rj-caption mx-auto mt-2 max-w-md">
        {description}
      </p>

      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="rj-button rj-button-primary mt-6"
        >
          <Plus size={18} />
          {actionLabel}
        </button>
      )}

      {actionLabel && actionHref && (
        <Link
          href={actionHref}
          className="rj-button rj-button-primary mt-6"
        >
          <Plus size={18} />
          {actionLabel}
        </Link>
      )}
    </div>
  )
}

function ClientStatusBadge({
  status,
}: {
  status: ClientStatus
}) {
  const className =
    status === "active"
      ? "rj-badge-success"
      : status === "on_hold"
        ? "rj-badge-warning"
        : "rj-badge-danger"

  return (
    <span className={`rj-badge ${className}`}>
      {formatLabel(status)}
    </span>
  )
}

function TargetStatusBadge({
  status,
}: {
  status: TargetStatus
}) {
  const className =
    status === "active"
      ? "rj-badge-success"
      : status === "mastered"
        ? "rj-badge-info"
        : status === "paused"
          ? "rj-badge-warning"
          : "rj-badge-danger"

  return (
    <span className={`rj-badge ${className}`}>
      {formatLabel(status)}
    </span>
  )
}

function SessionStatusBadge({
  status,
}: {
  status: string
}) {
  const className =
    status === "completed"
      ? "rj-badge-success"
      : ["in_progress", "paused"].includes(
            status
          )
        ? "rj-badge-warning"
        : [
              "canceled",
              "client_absent",
              "provider_absent",
              "no_show",
            ].includes(status)
          ? "rj-badge-danger"
          : "rj-badge-info"

  return (
    <span className={`rj-badge ${className}`}>
      {formatLabel(status)}
    </span>
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

function ClientWorkspaceLoading() {
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
          Loading client workspace…
        </p>
      </div>
    </div>
  )
}

function getNextSortOrder(
  items: Array<{ sort_order: number }>
): number {
  if (items.length === 0) {
    return 1
  }

  return (
    Math.max(
      ...items.map(
        (item) => item.sort_order
      )
    ) + 1
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
  const endDate = end
    ? new Date(end)
    : null

  const dateText =
    new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
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