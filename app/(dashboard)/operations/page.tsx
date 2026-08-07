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
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  Clock3,
  FolderCog,
  Languages,
  ListChecks,
  LoaderCircle,
  MapPin,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Settings2,
  Sparkles,
  ToggleLeft,
  ToggleRight,
  Users,
  X,
} from "lucide-react"

import { supabase } from "@/lib/supabase"

type OperationsTab =
  | "session-types"
  | "locations"
  | "target-categories"
  | "terminology"

type SessionTypeRecord = {
  id: string
  organization_id: string
  name: string
  code: string
  description: string | null
  default_duration_minutes: number | null
  active: boolean
  sort_order: number
}

type LocationRecord = {
  id: string
  organization_id: string
  name: string
  description: string | null
  active: boolean
  sort_order: number
}

type TargetCategoryRecord = {
  id: string
  organization_id: string
  name: string
  description: string | null
  active: boolean
  sort_order: number
}

type TerminologyRecord = {
  id?: string
  organization_id: string
  client_singular: string
  client_plural: string
  frontline_singular: string
  frontline_plural: string
  session_singular: string
  session_plural: string
  target_singular: string
  target_plural: string
}

type EditableOption =
  | SessionTypeRecord
  | LocationRecord
  | TargetCategoryRecord

const DEFAULT_TERMINOLOGY: Omit<
  TerminologyRecord,
  "organization_id"
> = {
  client_singular: "Client",
  client_plural: "Clients",
  frontline_singular: "Team Member",
  frontline_plural: "Team Members",
  session_singular: "Session",
  session_plural: "Sessions",
  target_singular: "Target",
  target_plural: "Targets",
}

export default function OperationsPage() {
  const [activeTab, setActiveTab] =
    useState<OperationsTab>("session-types")

  const [organizationId, setOrganizationId] =
    useState<string | null>(null)

  const [sessionTypes, setSessionTypes] =
    useState<SessionTypeRecord[]>([])

  const [locations, setLocations] =
    useState<LocationRecord[]>([])

  const [targetCategories, setTargetCategories] =
    useState<TargetCategoryRecord[]>([])

  const [terminology, setTerminology] =
    useState<TerminologyRecord | null>(null)

  // Shared option form
  const [editingId, setEditingId] =
    useState<string | null>(null)

  const [optionName, setOptionName] = useState("")
  const [optionCode, setOptionCode] = useState("")
  const [optionDescription, setOptionDescription] =
    useState("")

  const [defaultDuration, setDefaultDuration] =
    useState("60")

  const [showOptionForm, setShowOptionForm] =
    useState(false)

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [updatingId, setUpdatingId] =
    useState<string | null>(null)

  const [pageError, setPageError] =
    useState<string | null>(null)

  const [successMessage, setSuccessMessage] =
    useState<string | null>(null)

  const loadOperations = useCallback(
    async (showRefreshState = false) => {
      if (showRefreshState) {
        setRefreshing(true)
      } else {
        setLoading(true)
      }

      setPageError(null)

      try {
        const {
          data: currentOrganizationId,
          error: organizationError,
        } = await supabase.rpc(
          "current_organization_id"
        )

        if (organizationError) {
          throw new Error(
            organizationError.message
          )
        }

        if (!currentOrganizationId) {
          throw new Error(
            "Your account is not connected to an organization."
          )
        }

        setOrganizationId(currentOrganizationId)

        const [
          sessionTypeResult,
          locationResult,
          categoryResult,
          terminologyResult,
        ] = await Promise.all([
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
            .eq(
              "organization_id",
              currentOrganizationId
            )
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
            .eq(
              "organization_id",
              currentOrganizationId
            )
            .order("sort_order", {
              ascending: true,
            })
            .order("name", {
              ascending: true,
            }),

          supabase
            .from("target_categories")
            .select(`
              id,
              organization_id,
              name,
              description,
              active,
              sort_order
            `)
            .eq(
              "organization_id",
              currentOrganizationId
            )
            .order("sort_order", {
              ascending: true,
            })
            .order("name", {
              ascending: true,
            }),

          supabase
            .from("organization_terminology")
            .select(`
              id,
              organization_id,
              client_singular,
              client_plural,
              frontline_singular,
              frontline_plural,
              session_singular,
              session_plural,
              target_singular,
              target_plural
            `)
            .eq(
              "organization_id",
              currentOrganizationId
            )
            .maybeSingle(),
        ])

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

        if (categoryResult.error) {
          throw new Error(
            categoryResult.error.message
          )
        }

        if (terminologyResult.error) {
          throw new Error(
            terminologyResult.error.message
          )
        }

        setSessionTypes(
          (sessionTypeResult.data ||
            []) as SessionTypeRecord[]
        )

        setLocations(
          (locationResult.data ||
            []) as LocationRecord[]
        )

        setTargetCategories(
          (categoryResult.data ||
            []) as TargetCategoryRecord[]
        )

        setTerminology(
          terminologyResult.data
            ? (terminologyResult.data as TerminologyRecord)
            : {
                organization_id:
                  currentOrganizationId,
                ...DEFAULT_TERMINOLOGY,
              }
        )
      } catch (error) {
        console.error(
          "Load operations error:",
          error
        )

        setPageError(
          error instanceof Error
            ? error.message
            : "Unable to load Operations."
        )
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    []
  )

  useEffect(() => {
    loadOperations()
  }, [loadOperations])

  const activeItems = useMemo(() => {
    if (activeTab === "session-types") {
      return sessionTypes
    }

    if (activeTab === "locations") {
      return locations
    }

    if (activeTab === "target-categories") {
      return targetCategories
    }

    return []
  }, [
    activeTab,
    locations,
    sessionTypes,
    targetCategories,
  ])

  const activeCount = activeItems.filter(
    (item) => item.active
  ).length

  const resetOptionForm = () => {
    setEditingId(null)
    setOptionName("")
    setOptionCode("")
    setOptionDescription("")
    setDefaultDuration("60")
    setShowOptionForm(false)
  }

  const openCreateForm = () => {
    setEditingId(null)
    setOptionName("")
    setOptionCode("")
    setOptionDescription("")
    setDefaultDuration("60")
    setShowOptionForm(true)
    setPageError(null)
    setSuccessMessage(null)
  }

  const openEditForm = (
    item: EditableOption
  ) => {
    setEditingId(item.id)
    setOptionName(item.name)
    setOptionDescription(
      item.description || ""
    )

    if ("code" in item) {
      setOptionCode(item.code)
      setDefaultDuration(
        item.default_duration_minutes?.toString() ||
          ""
      )
    } else {
      setOptionCode("")
      setDefaultDuration("60")
    }

    setShowOptionForm(true)
    setPageError(null)
    setSuccessMessage(null)

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    })
  }

  const saveOption = async (
    event: FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault()

    if (!organizationId) {
      setPageError(
        "Your organization could not be identified."
      )
      return
    }

    if (!optionName.trim()) {
      setPageError("A name is required.")
      return
    }

    setSaving(true)
    setPageError(null)
    setSuccessMessage(null)

    try {
      if (activeTab === "session-types") {
        const code =
          optionCode.trim() ||
          createCode(optionName)

        const duration = defaultDuration.trim()
          ? Number(defaultDuration)
          : null

        if (
          duration !== null &&
          (!Number.isInteger(duration) ||
            duration <= 0)
        ) {
          throw new Error(
            "Default duration must be a positive whole number."
          )
        }

        const values = {
          organization_id: organizationId,
          name: optionName.trim(),
          code,
          description:
            optionDescription.trim() || null,
          default_duration_minutes: duration,
        }

        if (editingId) {
          const { error } = await supabase
            .from("session_types")
            .update(values)
            .eq("id", editingId)

          if (error) {
            throw new Error(error.message)
          }
        } else {
          const nextSortOrder =
            getNextSortOrder(sessionTypes)

          const { error } = await supabase
            .from("session_types")
            .insert({
              ...values,
              active: true,
              sort_order: nextSortOrder,
            })

          if (error) {
            throw new Error(error.message)
          }
        }
      }

      if (activeTab === "locations") {
        const values = {
          organization_id: organizationId,
          name: optionName.trim(),
          description:
            optionDescription.trim() || null,
        }

        if (editingId) {
          const { error } = await supabase
            .from("organization_locations")
            .update(values)
            .eq("id", editingId)

          if (error) {
            throw new Error(error.message)
          }
        } else {
          const { error } = await supabase
            .from("organization_locations")
            .insert({
              ...values,
              active: true,
              sort_order:
                getNextSortOrder(locations),
            })

          if (error) {
            throw new Error(error.message)
          }
        }
      }

      if (
        activeTab === "target-categories"
      ) {
        const values = {
          organization_id: organizationId,
          name: optionName.trim(),
          description:
            optionDescription.trim() || null,
        }

        if (editingId) {
          const { error } = await supabase
            .from("target_categories")
            .update(values)
            .eq("id", editingId)

          if (error) {
            throw new Error(error.message)
          }
        } else {
          const { error } = await supabase
            .from("target_categories")
            .insert({
              ...values,
              active: true,
              sort_order:
                getNextSortOrder(
                  targetCategories
                ),
            })

          if (error) {
            throw new Error(error.message)
          }
        }
      }

      setSuccessMessage(
        editingId
          ? "Option updated successfully."
          : "Option created successfully."
      )

      resetOptionForm()
      await loadOperations()
    } catch (error) {
      console.error(
        "Save operations option error:",
        error
      )

      setPageError(
        error instanceof Error
          ? error.message
          : "Unable to save this option."
      )
    } finally {
      setSaving(false)
    }
  }

  const toggleOptionStatus = async (
    item: EditableOption
  ) => {
    setUpdatingId(item.id)
    setPageError(null)
    setSuccessMessage(null)

    try {
      const table =
        activeTab === "session-types"
          ? "session_types"
          : activeTab === "locations"
            ? "organization_locations"
            : "target_categories"

      const { error } = await supabase
        .from(table)
        .update({
          active: !item.active,
        })
        .eq("id", item.id)

      if (error) {
        throw new Error(error.message)
      }

      setSuccessMessage(
        `${item.name} is now ${
          item.active ? "inactive" : "active"
        }.`
      )

      await loadOperations()
    } catch (error) {
      console.error(
        "Toggle option error:",
        error
      )

      setPageError(
        error instanceof Error
          ? error.message
          : "Unable to update this option."
      )
    } finally {
      setUpdatingId(null)
    }
  }

  const saveTerminology = async (
    event: FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault()

    if (!organizationId || !terminology) {
      return
    }

    const requiredValues = [
      terminology.client_singular,
      terminology.client_plural,
      terminology.frontline_singular,
      terminology.frontline_plural,
      terminology.session_singular,
      terminology.session_plural,
      terminology.target_singular,
      terminology.target_plural,
    ]

    if (
      requiredValues.some(
        (value) => !value.trim()
      )
    ) {
      setPageError(
        "Every terminology field is required."
      )
      return
    }

    setSaving(true)
    setPageError(null)
    setSuccessMessage(null)

    try {
      const { error } = await supabase
        .from("organization_terminology")
        .upsert(
          {
            organization_id: organizationId,

            client_singular:
              terminology.client_singular.trim(),

            client_plural:
              terminology.client_plural.trim(),

            frontline_singular:
              terminology.frontline_singular.trim(),

            frontline_plural:
              terminology.frontline_plural.trim(),

            session_singular:
              terminology.session_singular.trim(),

            session_plural:
              terminology.session_plural.trim(),

            target_singular:
              terminology.target_singular.trim(),

            target_plural:
              terminology.target_plural.trim(),
          },
          {
            onConflict: "organization_id",
          }
        )

      if (error) {
        throw new Error(error.message)
      }

      setSuccessMessage(
        "Organization terminology saved."
      )

      await loadOperations()
    } catch (error) {
      console.error(
        "Save terminology error:",
        error
      )

      setPageError(
        error instanceof Error
          ? error.message
          : "Unable to save terminology."
      )
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <OperationsLoading />
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Header */}
      <header className="relative overflow-hidden rounded-[var(--rj-radius-xl)] border border-[var(--rj-border)] bg-white p-6 shadow-[var(--rj-shadow-soft)] sm:p-8">
        <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-[var(--rj-teal-100)] opacity-60" />

        <div className="pointer-events-none absolute -bottom-24 right-28 h-48 w-48 rounded-full bg-[var(--rj-lavender-100)] opacity-50" />

        <div className="relative flex flex-col justify-between gap-6 lg:flex-row lg:items-center">
          <div className="max-w-2xl">
            <span className="inline-flex items-center gap-2 rounded-full bg-[var(--rj-teal-50)] px-3 py-1.5 text-sm font-bold text-[var(--rj-teal-700)]">
              <Sparkles size={15} />
              Organization Setup
            </span>

            <h1 className="rj-heading-1 mt-4">
              Operations
            </h1>

            <p className="rj-body mt-3 text-[var(--rj-text-secondary)]">
              Customize the reusable options that
              administrators use when creating clients,
              goals, and sessions.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Link
              href="/team-management"
              className="rj-button rj-button-secondary"
            >
              <Users size={19} />
              Manage People
            </Link>

            <button
              type="button"
              onClick={() =>
                loadOperations(true)
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
          text={pageError}
        />
      )}

      {successMessage && (
        <MessageBanner
          success
          text={successMessage}
        />
      )}

      {/* Summary cards */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          label="Session Types"
          value={sessionTypes.length}
          icon={Clock3}
          background="var(--rj-blue-100)"
          foreground="var(--rj-blue-700)"
        />

        <SummaryCard
          label="Locations"
          value={locations.length}
          icon={MapPin}
          background="var(--rj-teal-100)"
          foreground="var(--rj-teal-700)"
        />

        <SummaryCard
          label="Target Categories"
          value={targetCategories.length}
          icon={ListChecks}
          background="var(--rj-lavender-100)"
          foreground="var(--rj-lavender-700)"
        />

        <SummaryCard
          label="Active Options"
          value={
            sessionTypes.filter(
              (item) => item.active
            ).length +
            locations.filter(
              (item) => item.active
            ).length +
            targetCategories.filter(
              (item) => item.active
            ).length
          }
          icon={CheckCircle2}
          background="var(--rj-mint-100)"
          foreground="var(--rj-mint-700)"
        />
      </section>

      {/* Tabs */}
      <section className="rj-card p-2">
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <OperationsTabButton
            active={
              activeTab === "session-types"
            }
            label="Session Types"
            icon={Clock3}
            onClick={() => {
              resetOptionForm()
              setActiveTab("session-types")
            }}
          />

          <OperationsTabButton
            active={activeTab === "locations"}
            label="Locations"
            icon={MapPin}
            onClick={() => {
              resetOptionForm()
              setActiveTab("locations")
            }}
          />

          <OperationsTabButton
            active={
              activeTab ===
              "target-categories"
            }
            label="Target Categories"
            icon={ListChecks}
            onClick={() => {
              resetOptionForm()
              setActiveTab(
                "target-categories"
              )
            }}
          />

          <OperationsTabButton
            active={
              activeTab === "terminology"
            }
            label="Terminology"
            icon={Languages}
            onClick={() => {
              resetOptionForm()
              setActiveTab("terminology")
            }}
          />
        </div>
      </section>

      {activeTab !== "terminology" && (
        <>
          {/* Option header */}
          <section className="rj-card p-6">
            <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-center">
              <div>
                <p className="rj-label">
                  {getTabEyebrow(activeTab)}
                </p>

                <h2 className="rj-heading-2 mt-1">
                  {getTabTitle(activeTab)}
                </h2>

                <p className="rj-caption mt-2 max-w-2xl">
                  {getTabDescription(
                    activeTab
                  )}
                </p>
              </div>

              <button
                type="button"
                onClick={openCreateForm}
                className="rj-button rj-button-primary"
              >
                <Plus size={19} />
                Add {getSingularLabel(activeTab)}
              </button>
            </div>
          </section>

          {showOptionForm && (
            <OptionForm
              activeTab={activeTab}
              editing={Boolean(editingId)}
              name={optionName}
              code={optionCode}
              description={optionDescription}
              duration={defaultDuration}
              saving={saving}
              setName={setOptionName}
              setCode={setOptionCode}
              setDescription={
                setOptionDescription
              }
              setDuration={setDefaultDuration}
              onSubmit={saveOption}
              onCancel={resetOptionForm}
            />
          )}

          {/* Options list */}
          <section className="rj-card overflow-hidden">
            <div className="flex items-center justify-between gap-4 border-b border-[var(--rj-border)] p-6">
              <div>
                <p className="rj-label">
                  Current Configuration
                </p>

                <h2 className="rj-heading-3 mt-1">
                  {activeItems.length} total ·{" "}
                  {activeCount} active
                </h2>
              </div>

              <FolderCog
                size={26}
                className="text-[var(--rj-teal-700)]"
              />
            </div>

            {activeItems.length === 0 ? (
              <div className="p-12 text-center">
                <Settings2
                  size={36}
                  className="mx-auto text-[var(--rj-text-muted)]"
                />

                <h3 className="rj-heading-3 mt-4">
                  No options created
                </h3>

                <p className="rj-caption mt-2">
                  Add your first{" "}
                  {getSingularLabel(
                    activeTab
                  ).toLowerCase()}
                  .
                </p>

                <button
                  type="button"
                  onClick={openCreateForm}
                  className="rj-button rj-button-primary mt-6"
                >
                  <Plus size={19} />
                  Add Option
                </button>
              </div>
            ) : (
              <div className="divide-y divide-[var(--rj-border)]">
                {activeItems.map((item) => (
                  <OptionRow
                    key={item.id}
                    item={item}
                    activeTab={activeTab}
                    updating={
                      updatingId === item.id
                    }
                    onEdit={() =>
                      openEditForm(item)
                    }
                    onToggle={() =>
                      toggleOptionStatus(item)
                    }
                  />
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {activeTab === "terminology" &&
        terminology && (
          <TerminologyForm
            terminology={terminology}
            saving={saving}
            setTerminology={
              setTerminology
            }
            onSubmit={saveTerminology}
          />
        )}
    </div>
  )
}

function OptionForm({
  activeTab,
  editing,
  name,
  code,
  description,
  duration,
  saving,
  setName,
  setCode,
  setDescription,
  setDuration,
  onSubmit,
  onCancel,
}: {
  activeTab: Exclude<
    OperationsTab,
    "terminology"
  >
  editing: boolean
  name: string
  code: string
  description: string
  duration: string
  saving: boolean
  setName: (value: string) => void
  setCode: (value: string) => void
  setDescription: (value: string) => void
  setDuration: (value: string) => void
  onSubmit: (
    event: FormEvent<HTMLFormElement>
  ) => void
  onCancel: () => void
}) {
  return (
    <section className="rj-card p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="rj-label">
            {editing
              ? "Edit Configuration"
              : "New Configuration"}
          </p>

          <h2 className="rj-heading-2 mt-1">
            {editing ? "Update" : "Add"}{" "}
            {getSingularLabel(activeTab)}
          </h2>
        </div>

        <button
          type="button"
          onClick={onCancel}
          aria-label="Close form"
          className="rj-icon-button"
        >
          <X size={19} />
        </button>
      </div>

      <form
        onSubmit={onSubmit}
        className="mt-6 grid gap-5 md:grid-cols-2"
      >
        <FormField label="Name">
          <input
            value={name}
            onChange={(event) =>
              setName(event.target.value)
            }
            placeholder={getNamePlaceholder(
              activeTab
            )}
            className="rj-input"
            required
          />
        </FormField>

        {activeTab === "session-types" && (
          <FormField label="Internal code">
            <input
              value={code}
              onChange={(event) =>
                setCode(
                  createCode(
                    event.target.value
                  )
                )
              }
              placeholder="direct_service"
              className="rj-input"
            />

            <p className="rj-caption mt-2">
              Used internally. Leave blank to
              generate it from the name.
            </p>
          </FormField>
        )}

        {activeTab === "session-types" && (
          <FormField label="Default duration">
            <div className="relative">
              <Clock3
                size={18}
                className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--rj-text-muted)]"
              />

              <input
                type="number"
                min={1}
                step={1}
                value={duration}
                onChange={(event) =>
                  setDuration(
                    event.target.value
                  )
                }
                className="rj-input pl-11"
              />
            </div>

            <p className="rj-caption mt-2">
              Duration in minutes.
            </p>
          </FormField>
        )}

        <div
          className={
            activeTab === "session-types"
              ? "md:col-span-2"
              : ""
          }
        >
          <FormField label="Description">
            <textarea
              value={description}
              onChange={(event) =>
                setDescription(
                  event.target.value
                )
              }
              rows={3}
              placeholder="Describe when this option should be used…"
              className="rj-input resize-none"
            />
          </FormField>
        </div>

        <div className="flex flex-col gap-3 md:col-span-2 sm:flex-row">
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
              ? "Saving…"
              : editing
                ? "Save Changes"
                : "Create Option"}
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

function OptionRow({
  item,
  activeTab,
  updating,
  onEdit,
  onToggle,
}: {
  item: EditableOption
  activeTab: Exclude<
    OperationsTab,
    "terminology"
  >
  updating: boolean
  onEdit: () => void
  onToggle: () => void
}) {
  const Icon =
    activeTab === "session-types"
      ? Clock3
      : activeTab === "locations"
        ? MapPin
        : ListChecks

  return (
    <article className="flex flex-col justify-between gap-5 p-5 sm:flex-row sm:items-center sm:p-6">
      <div className="flex min-w-0 gap-4">
        <div
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${
            item.active
              ? "bg-[var(--rj-teal-100)] text-[var(--rj-teal-700)]"
              : "bg-[var(--rj-surface-muted)] text-[var(--rj-text-muted)]"
          }`}
        >
          <Icon size={22} />
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-bold">
              {item.name}
            </h3>

            <span
              className={`rj-badge ${
                item.active
                  ? "rj-badge-success"
                  : "rj-badge-warning"
              }`}
            >
              {item.active
                ? "Active"
                : "Inactive"}
            </span>
          </div>

          {"code" in item && (
            <p className="rj-caption mt-1">
              Code: {item.code}
              {item.default_duration_minutes
                ? ` · ${item.default_duration_minutes} minutes`
                : ""}
            </p>
          )}

          {item.description && (
            <p className="rj-body mt-2 text-[var(--rj-text-secondary)]">
              {item.description}
            </p>
          )}
        </div>
      </div>

      <div className="flex shrink-0 gap-3">
        <button
          type="button"
          onClick={onEdit}
          className="rj-button rj-button-secondary"
        >
          <Pencil size={17} />
          Edit
        </button>

        <button
          type="button"
          onClick={onToggle}
          disabled={updating}
          className={`rj-button ${
            item.active
              ? "rj-button-soft"
              : "rj-button-success"
          }`}
        >
          {updating ? (
            <LoaderCircle
              size={18}
              className="animate-spin"
            />
          ) : item.active ? (
            <ToggleRight size={20} />
          ) : (
            <ToggleLeft size={20} />
          )}

          {item.active
            ? "Deactivate"
            : "Activate"}
        </button>
      </div>
    </article>
  )
}

function TerminologyForm({
  terminology,
  saving,
  setTerminology,
  onSubmit,
}: {
  terminology: TerminologyRecord
  saving: boolean
  setTerminology: (
    value: TerminologyRecord
  ) => void
  onSubmit: (
    event: FormEvent<HTMLFormElement>
  ) => void
}) {
  const updateField = (
    field: keyof TerminologyRecord,
    value: string
  ) => {
    setTerminology({
      ...terminology,
      [field]: value,
    })
  }

  return (
    <section className="rj-card p-6 sm:p-8">
      <div className="flex items-center gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--rj-lavender-100)] text-[var(--rj-lavender-700)]">
          <Languages size={25} />
        </div>

        <div>
          <p className="rj-label">
            Organization Language
          </p>

          <h2 className="rj-heading-2 mt-1">
            Customize Terminology
          </h2>
        </div>
      </div>

      <p className="rj-body mt-4 max-w-3xl text-[var(--rj-text-secondary)]">
        Choose the words that feel natural for your
        organization. A school might use “Student,” while
        another organization may use “Client,” “Resident,”
        or “Child.”
      </p>

      <form
        onSubmit={onSubmit}
        className="mt-8 space-y-8"
      >
        <TerminologyPair
          title="People receiving services"
          description="Examples: Client, Student, Child, Learner, Resident"
          singular={
            terminology.client_singular
          }
          plural={terminology.client_plural}
          setSingular={(value) =>
            updateField(
              "client_singular",
              value
            )
          }
          setPlural={(value) =>
            updateField(
              "client_plural",
              value
            )
          }
        />

        <TerminologyPair
          title="Frontline workers"
          description="Examples: Teacher, Therapist, Educator, Caregiver"
          singular={
            terminology.frontline_singular
          }
          plural={
            terminology.frontline_plural
          }
          setSingular={(value) =>
            updateField(
              "frontline_singular",
              value
            )
          }
          setPlural={(value) =>
            updateField(
              "frontline_plural",
              value
            )
          }
        />

        <TerminologyPair
          title="Scheduled service blocks"
          description="Examples: Session, Class Period, Care Visit, Activity"
          singular={
            terminology.session_singular
          }
          plural={
            terminology.session_plural
          }
          setSingular={(value) =>
            updateField(
              "session_singular",
              value
            )
          }
          setPlural={(value) =>
            updateField(
              "session_plural",
              value
            )
          }
        />

        <TerminologyPair
          title="Goals and objectives"
          description="Examples: Target, Goal, Objective, Skill"
          singular={
            terminology.target_singular
          }
          plural={terminology.target_plural}
          setSingular={(value) =>
            updateField(
              "target_singular",
              value
            )
          }
          setPlural={(value) =>
            updateField(
              "target_plural",
              value
            )
          }
        />

        <div className="rounded-[var(--rj-radius-lg)] bg-[var(--rj-surface-muted)] p-5">
          <p className="rj-label">
            Preview
          </p>

          <p className="rj-body mt-3">
            Create a new{" "}
            <strong>
              {terminology.session_singular}
            </strong>{" "}
            for a{" "}
            <strong>
              {terminology.client_singular}
            </strong>
            , assign a{" "}
            <strong>
              {terminology.frontline_singular}
            </strong>
            , and prepare their{" "}
            <strong>
              {terminology.target_plural}
            </strong>
            .
          </p>
        </div>

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
            ? "Saving…"
            : "Save Terminology"}
        </button>
      </form>
    </section>
  )
}

function TerminologyPair({
  title,
  description,
  singular,
  plural,
  setSingular,
  setPlural,
}: {
  title: string
  description: string
  singular: string
  plural: string
  setSingular: (value: string) => void
  setPlural: (value: string) => void
}) {
  return (
    <fieldset>
      <legend className="font-bold">
        {title}
      </legend>

      <p className="rj-caption mt-1">
        {description}
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <FormField label="Singular">
          <input
            value={singular}
            onChange={(event) =>
              setSingular(
                event.target.value
              )
            }
            className="rj-input"
            required
          />
        </FormField>

        <FormField label="Plural">
          <input
            value={plural}
            onChange={(event) =>
              setPlural(event.target.value)
            }
            className="rj-input"
            required
          />
        </FormField>
      </div>
    </fieldset>
  )
}

function OperationsTabButton({
  active,
  label,
  icon: Icon,
  onClick,
}: {
  active: boolean
  label: string
  icon: typeof Settings2
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
  icon: typeof Settings2
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
          className="flex h-12 w-12 items-center justify-center rounded-full"
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

function MessageBanner({
  success,
  text,
}: {
  success: boolean
  text: string
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

        <p
          className={`font-semibold ${
            success
              ? "text-[var(--rj-mint-700)]"
              : "text-[var(--rj-danger)]"
          }`}
        >
          {text}
        </p>
      </div>
    </div>
  )
}

function OperationsLoading() {
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
          Loading organization setup…
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

function createCode(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
}

function getTabEyebrow(
  tab: Exclude<
    OperationsTab,
    "terminology"
  >
): string {
  switch (tab) {
    case "session-types":
      return "Scheduling"

    case "locations":
      return "Organization Spaces"

    case "target-categories":
      return "Programs and Goals"
  }
}

function getTabTitle(
  tab: Exclude<
    OperationsTab,
    "terminology"
  >
): string {
  switch (tab) {
    case "session-types":
      return "Session Types"

    case "locations":
      return "Locations"

    case "target-categories":
      return "Target Categories"
  }
}

function getTabDescription(
  tab: Exclude<
    OperationsTab,
    "terminology"
  >
): string {
  switch (tab) {
    case "session-types":
      return "Define the types of services your organization schedules and their default durations."

    case "locations":
      return "Create reusable rooms, classrooms, clinics, or service locations."

    case "target-categories":
      return "Organize client targets into clear program or goal categories."
  }
}

function getSingularLabel(
  tab: Exclude<
    OperationsTab,
    "terminology"
  >
): string {
  switch (tab) {
    case "session-types":
      return "Session Type"

    case "locations":
      return "Location"

    case "target-categories":
      return "Target Category"
  }
}

function getNamePlaceholder(
  tab: Exclude<
    OperationsTab,
    "terminology"
  >
): string {
  switch (tab) {
    case "session-types":
      return "Example: Direct Service"

    case "locations":
      return "Example: Room 104"

    case "target-categories":
      return "Example: Communication"
  }
}