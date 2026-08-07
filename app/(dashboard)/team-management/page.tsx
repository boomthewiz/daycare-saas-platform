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
  Archive,
  ArrowRight,
  Baby,
  CheckCircle2,
  CircleAlert,
  LoaderCircle,
  MailPlus,
  Plus,
  RefreshCw,
  Search,
  UserRound,
  Users,
} from "lucide-react"

import { supabase } from "@/lib/supabase"

type Tab = "clients" | "team"

type ClientRecord = {
  id: string
  first_name: string
  last_name: string | null
  preferred_name: string | null
  status: string
  assigned_provider_id: string | null
  created_at: string
}

type TeamMemberRecord = {
  id: string
  full_name: string | null
  email: string | null
  role: string
  status: string
}

export default function PeopleManagementPage() {
  const [activeTab, setActiveTab] =
    useState<Tab>("clients")

  const [clients, setClients] =
    useState<ClientRecord[]>([])

  const [team, setTeam] =
    useState<TeamMemberRecord[]>([])

  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName] = useState("")
  const [preferredName, setPreferredName] =
    useState("")
  const [assignedProviderId, setAssignedProviderId] =
    useState("")

  const [search, setSearch] = useState("")
  const [showClientForm, setShowClientForm] =
    useState(false)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [refreshing, setRefreshing] =
    useState(false)

  const [pageError, setPageError] =
    useState<string | null>(null)

  const [successMessage, setSuccessMessage] =
    useState<string | null>(null)

  const loadPeople = useCallback(
    async (showRefresh = false) => {
      if (showRefresh) {
        setRefreshing(true)
      } else {
        setLoading(true)
      }

      setPageError(null)

      try {
        const [clientResult, teamResult] =
          await Promise.all([
            supabase
              .from("clients")
              .select(`
                id,
                first_name,
                last_name,
                preferred_name,
                status,
                assigned_provider_id,
                created_at
              `)
              .order("created_at", {
                ascending: false,
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
              .order("full_name", {
                ascending: true,
                nullsFirst: false,
              }),
          ])

        if (clientResult.error) {
          throw new Error(
            clientResult.error.message
          )
        }

        if (teamResult.error) {
          throw new Error(teamResult.error.message)
        }

        setClients(
          (clientResult.data || []) as ClientRecord[]
        )

        setTeam(
          (teamResult.data || []) as TeamMemberRecord[]
        )
      } catch (error) {
        console.error("Load people error:", error)

        setPageError(
          error instanceof Error
            ? error.message
            : "Unable to load people."
        )
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    []
  )

  useEffect(() => {
    loadPeople()
  }, [loadPeople])

  const frontlineMembers = useMemo(
    () =>
      team.filter((member) =>
        [
          "therapist",
          "teacher",
          "educator",
          "assistant",
          "aide",
          "caregiver",
          "staff",
        ].includes(member.role)
      ),
    [team]
  )

  const filteredClients = useMemo(() => {
    const value = search.trim().toLowerCase()

    if (!value) return clients

    return clients.filter((client) =>
      getClientName(client)
        .toLowerCase()
        .includes(value)
    )
  }, [clients, search])

  const filteredTeam = useMemo(() => {
    const value = search.trim().toLowerCase()

    if (!value) return team

    return team.filter((member) => {
      const searchable = [
        member.full_name,
        member.email,
        member.role,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()

      return searchable.includes(value)
    })
  }, [search, team])

  const createClient = async (
    event: FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault()

    if (!firstName.trim()) {
      setPageError("A first name is required.")
      return
    }

    setSaving(true)
    setPageError(null)
    setSuccessMessage(null)

    try {
      const { data: organizationId, error: orgError } =
        await supabase.rpc(
          "current_organization_id"
        )

      if (orgError) {
        throw new Error(orgError.message)
      }

      if (!organizationId) {
        throw new Error(
          "Your account is not connected to an organization."
        )
      }

      const { error } = await supabase
        .from("clients")
        .insert({
          organization_id: organizationId,
          first_name: firstName.trim(),
          last_name:
            lastName.trim() || null,
          preferred_name:
            preferredName.trim() || null,
          assigned_provider_id:
            assignedProviderId || null,
          status: "active",
        })

      if (error) {
        throw new Error(error.message)
      }

      setFirstName("")
      setLastName("")
      setPreferredName("")
      setAssignedProviderId("")
      setShowClientForm(false)

      setSuccessMessage(
        "Client created successfully."
      )

      await loadPeople()
    } catch (error) {
      console.error("Create client error:", error)

      setPageError(
        error instanceof Error
          ? error.message
          : "Unable to create the client."
      )
    } finally {
      setSaving(false)
    }
  }

  const archiveClient = async (
    clientId: string
  ) => {
    const confirmed = window.confirm(
      "Archive this client? Their historical sessions will remain available."
    )

    if (!confirmed) return

    setPageError(null)
    setSuccessMessage(null)

    const { error } = await supabase
      .from("clients")
      .update({
        status: "inactive",
      })
      .eq("id", clientId)

    if (error) {
      setPageError(error.message)
      return
    }

    setSuccessMessage("Client archived.")
    await loadPeople()
  }

  if (loading) {
    return (
      <div className="flex min-h-[65vh] items-center justify-center">
        <LoaderCircle
          size={34}
          className="animate-spin text-[var(--rj-teal-700)]"
        />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="relative overflow-hidden rounded-[var(--rj-radius-xl)] border border-[var(--rj-border)] bg-white p-6 shadow-[var(--rj-shadow-soft)] sm:p-8">
        <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-[var(--rj-lavender-100)] opacity-65" />

        <div className="relative flex flex-col justify-between gap-6 lg:flex-row lg:items-center">
          <div>
            <p className="rj-label">
              Organization Management
            </p>

            <h1 className="rj-heading-1 mt-1">
              People
            </h1>

            <p className="rj-body mt-3 text-[var(--rj-text-secondary)]">
              Manage clients and the team members who
              deliver their services.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => loadPeople(true)}
              className="rj-button rj-button-secondary"
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

            {activeTab === "clients" ? (
              <button
                type="button"
                onClick={() =>
                  setShowClientForm(true)
                }
                className="rj-button rj-button-primary"
              >
                <Plus size={19} />
                Add Client
              </button>
            ) : (
              <Link
                href="/team-management/invite"
                className="rj-button rj-button-primary"
              >
                <MailPlus size={19} />
                Invite Team Member
              </Link>
            )}
          </div>
        </div>
      </header>

      {pageError && (
        <Message
          success={false}
          text={pageError}
        />
      )}

      {successMessage && (
        <Message
          success
          text={successMessage}
        />
      )}

      <section className="rj-card p-2">
        <div className="grid grid-cols-2 gap-2">
          <TabButton
            active={activeTab === "clients"}
            label="Clients"
            count={clients.length}
            icon={Baby}
            onClick={() => setActiveTab("clients")}
          />

          <TabButton
            active={activeTab === "team"}
            label="Team Members"
            count={team.length}
            icon={Users}
            onClick={() => setActiveTab("team")}
          />
        </div>
      </section>

      {showClientForm &&
        activeTab === "clients" && (
          <section className="rj-card p-6">
            <h2 className="rj-heading-2">
              Create Client
            </h2>

            <p className="rj-caption mt-2">
              Targets and behavior definitions can be
              configured after the profile is created.
            </p>

            <form
              onSubmit={createClient}
              className="mt-6 grid gap-5 md:grid-cols-2"
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

              <FormField label="Primary team member">
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

                  {frontlineMembers.map((member) => (
                    <option
                      key={member.id}
                      value={member.id}
                    >
                      {member.full_name ||
                        member.email ||
                        "Unnamed user"}
                    </option>
                  ))}
                </select>
              </FormField>

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
                    <CheckCircle2 size={19} />
                  )}

                  Create Client
                </button>

                <button
                  type="button"
                  onClick={() =>
                    setShowClientForm(false)
                  }
                  className="rj-button rj-button-secondary"
                >
                  Cancel
                </button>
              </div>
            </form>
          </section>
        )}

      <section className="rj-card overflow-hidden">
        <div className="border-b border-[var(--rj-border)] p-6">
          <div className="relative max-w-md">
            <Search
              size={18}
              className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--rj-text-muted)]"
            />

            <input
              type="search"
              value={search}
              onChange={(event) =>
                setSearch(event.target.value)
              }
              placeholder={
                activeTab === "clients"
                  ? "Search clients…"
                  : "Search team members…"
              }
              className="rj-input pl-11"
            />
          </div>
        </div>

        {activeTab === "clients" ? (
          filteredClients.length === 0 ? (
            <EmptyState
              icon={Baby}
              title="No clients found"
              description="Create a client to begin assigning targets and sessions."
            />
          ) : (
            <div className="divide-y divide-[var(--rj-border)]">
              {filteredClients.map((client) => (
                <div
                  key={client.id}
                  className="flex flex-col justify-between gap-4 p-5 sm:flex-row sm:items-center"
                >
                  <div className="flex items-center gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--rj-blue-100)] text-[var(--rj-blue-700)]">
                      <UserRound size={22} />
                    </div>

                    <div>
                      <h3 className="font-bold">
                        {getClientName(client)}
                      </h3>

                      <span
                        className={`rj-badge mt-2 ${
                          client.status === "active"
                            ? "rj-badge-success"
                            : "rj-badge-warning"
                        }`}
                      >
                        {formatLabel(client.status)}
                      </span>
                    </div>
                  </div>

                  <div className="flex gap-3">
                    <Link
                      href={`/clients/${client.id}`}
                      className="rj-button rj-button-secondary"
                    >
                      Manage
                      <ArrowRight size={17} />
                    </Link>

                    {client.status === "active" && (
                      <button
                        type="button"
                        onClick={() =>
                          archiveClient(client.id)
                        }
                        className="rj-icon-button text-[var(--rj-danger)]"
                      >
                        <Archive size={18} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )
        ) : filteredTeam.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No team members found"
            description="Invite a frontline or administrative team member."
          />
        ) : (
          <div className="divide-y divide-[var(--rj-border)]">
            {filteredTeam.map((member) => (
              <div
                key={member.id}
                className="flex items-center justify-between gap-4 p-5"
              >
                <div className="flex min-w-0 items-center gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[var(--rj-lavender-100)] text-[var(--rj-lavender-700)]">
                    <Users size={22} />
                  </div>

                  <div className="min-w-0">
                    <h3 className="truncate font-bold">
                      {member.full_name ||
                        member.email ||
                        "Unnamed user"}
                    </h3>

                    <p className="rj-caption mt-1 truncate">
                      {formatLabel(member.role)}
                      {member.email
                        ? ` · ${member.email}`
                        : ""}
                    </p>
                  </div>
                </div>

                <span
                  className={`rj-badge ${
                    member.status === "active"
                      ? "rj-badge-success"
                      : "rj-badge-warning"
                  }`}
                >
                  {formatLabel(member.status)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function TabButton({
  active,
  label,
  count,
  icon: Icon,
  onClick,
}: {
  active: boolean
  label: string
  count: number
  icon: typeof Users
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-14 items-center justify-center gap-3 rounded-[var(--rj-radius-md)] px-4 font-bold ${
        active
          ? "bg-[var(--rj-teal-100)] text-[var(--rj-teal-700)]"
          : "text-[var(--rj-text-secondary)]"
      }`}
    >
      <Icon size={20} />
      {label}
      <span className="rounded-full bg-white px-2 py-0.5 text-xs">
        {count}
      </span>
    </button>
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
    <label>
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
}: {
  icon: typeof Users
  title: string
  description: string
}) {
  return (
    <div className="p-10 text-center">
      <Icon
        size={34}
        className="mx-auto text-[var(--rj-text-muted)]"
      />

      <h3 className="rj-heading-3 mt-4">
        {title}
      </h3>

      <p className="rj-caption mt-2">
        {description}
      </p>
    </div>
  )
}

function Message({
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
            className="text-[var(--rj-mint-700)]"
          />
        ) : (
          <CircleAlert
            size={21}
            className="text-[var(--rj-danger)]"
          />
        )}

        <p className="font-semibold">
          {text}
        </p>
      </div>
    </div>
  )
}

function getClientName(
  client: ClientRecord
): string {
  return (
    client.preferred_name?.trim() ||
    [client.first_name, client.last_name]
      .filter(Boolean)
      .join(" ")
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