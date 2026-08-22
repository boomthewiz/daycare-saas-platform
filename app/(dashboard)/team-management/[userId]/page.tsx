"use client"

import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  CreditCard,
  FileCheck2,
  KeyRound,
  LoaderCircle,
  Mail,
  RefreshCw,
  Save,
  Send,
  ShieldCheck,
  ToggleLeft,
  ToggleRight,
  UserRound,
  Users,
} from "lucide-react"

import { supabase } from "@/lib/supabase"

type UserRole =
  | "owner"
  | "admin"
  | "manager"
  | "director"
  | "therapist"
  | "teacher"
  | "educator"
  | "assistant"
  | "aide"
  | "caregiver"
  | "staff"

type UserStatus =
  | "active"
  | "inactive"
  | "invited"
  | "suspended"

type TeamMember = {
  id: string
  organization_id: string | null
  full_name: string | null
  email: string | null
  role: UserRole
  status: UserStatus
  created_at: string | null
  updated_at: string | null
}

type PermissionRecord = {
  user_id: string
  organization_id: string | null
  can_manage_users: boolean
  can_manage_clients: boolean
  can_manage_sessions: boolean
  can_review_sessions: boolean
  can_view_reports: boolean
  can_manage_billing: boolean
}

type ClientRecord = {
  id: string
  first_name: string
  preferred_name: string | null
  status: string
}

type SessionRecord = {
  id: string
  client_id: string
  status: string
  scheduled_start: string | null
  scheduled_end: string | null
  location: string | null
}

type PermissionKey =
  | "can_manage_users"
  | "can_manage_clients"
  | "can_manage_sessions"
  | "can_review_sessions"
  | "can_view_reports"
  | "can_manage_billing"

const ROLE_OPTIONS: {
  value: Exclude<UserRole, "owner">
  label: string
}[] = [
  { value: "admin", label: "Administrator" },
  { value: "manager", label: "Manager" },
  { value: "director", label: "Director" },
  { value: "therapist", label: "Therapist" },
  { value: "teacher", label: "Teacher" },
  { value: "educator", label: "Educator" },
  { value: "assistant", label: "Assistant" },
  { value: "aide", label: "Aide" },
  { value: "caregiver", label: "Caregiver" },
  { value: "staff", label: "Staff" },
]

const EMPTY_PERMISSIONS: Omit<
  PermissionRecord,
  "user_id" | "organization_id"
> = {
  can_manage_users: false,
  can_manage_clients: false,
  can_manage_sessions: false,
  can_review_sessions: false,
  can_view_reports: false,
  can_manage_billing: false,
}

export default function ManageTeamMemberPage() {
  const params = useParams<{ userId: string }>()
  const userId = params.userId

  const [member, setMember] =
    useState<TeamMember | null>(null)

  const [permissions, setPermissions] =
    useState<PermissionRecord | null>(null)

  const [assignedClients, setAssignedClients] =
    useState<ClientRecord[]>([])

  const [upcomingSessions, setUpcomingSessions] =
    useState<SessionRecord[]>([])

  const [callerId, setCallerId] =
    useState<string | null>(null)

  const [callerRole, setCallerRole] =
    useState<UserRole | null>(null)

  const [callerCanManageUsers, setCallerCanManageUsers] =
    useState(false)

  const [fullName, setFullName] = useState("")
  const [role, setRole] =
    useState<UserRole>("staff")

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [savingProfile, setSavingProfile] =
    useState(false)
  const [savingPermissions, setSavingPermissions] =
    useState(false)
  const [accountActionLoading, setAccountActionLoading] =
    useState(false)

  const [pageError, setPageError] =
    useState<string | null>(null)

  const [successMessage, setSuccessMessage] =
    useState<string | null>(null)

  const loadUser = useCallback(
    async (showRefresh = false) => {
      if (!userId) return

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

        setCallerId(user.id)

        const {
          data: callerProfile,
          error: callerError,
        } = await supabase
          .from("users")
          .select(`
            id,
            role,
            organization_id,
            status
          `)
          .eq("id", user.id)
          .single()

        if (callerError) {
          throw new Error(callerError.message)
        }

        const {
          data: callerPermissionData,
          error: callerPermissionError,
        } = await supabase
          .from("user_permissions")
          .select(`
            can_manage_users
          `)
          .eq("user_id", user.id)
          .maybeSingle()

        if (callerPermissionError) {
          throw new Error(
            callerPermissionError.message
          )
        }

        const callerIsOwner =
          callerProfile.role === "owner"

        const canManageUsers =
          callerIsOwner ||
          Boolean(
            callerPermissionData?.can_manage_users
          )

        if (!canManageUsers) {
          throw new Error(
            "You do not have permission to manage organization accounts."
          )
        }

        setCallerRole(
          callerProfile.role as UserRole
        )

        setCallerCanManageUsers(
          canManageUsers
        )

        const {
          data: memberData,
          error: memberError,
        } = await supabase
          .from("users")
          .select(`
            id,
            organization_id,
            full_name,
            email,
            role,
            status,
            created_at,
            updated_at
          `)
          .eq("id", userId)
          .single()

        if (memberError) {
          throw new Error(memberError.message)
        }

        const loadedMember =
          memberData as TeamMember

        if (
          loadedMember.organization_id !==
          callerProfile.organization_id
        ) {
          throw new Error(
            "This account does not belong to your organization."
          )
        }

        const [
          permissionResult,
          clientResult,
          sessionResult,
        ] = await Promise.all([
          supabase
            .from("user_permissions")
            .select(`
              user_id,
              organization_id,
              can_manage_users,
              can_manage_clients,
              can_manage_sessions,
              can_review_sessions,
              can_view_reports,
              can_manage_billing
            `)
            .eq("user_id", userId)
            .maybeSingle(),

          supabase
            .from("clients")
            .select(`
              id,
              first_name,
              preferred_name,
              status
            `)
            .eq("assigned_provider_id", userId)
            .order("preferred_name", {
              ascending: true,
              nullsFirst: false,
            }),

          supabase
            .from("sessions")
            .select(`
              id,
              client_id,
              status,
              scheduled_start,
              scheduled_end,
              location
            `)
            .eq("provider_id", userId)
            .gte(
              "scheduled_start",
              new Date().toISOString()
            )
            .order("scheduled_start", {
              ascending: true,
            })
            .limit(10),
        ])

        if (permissionResult.error) {
          throw new Error(
            permissionResult.error.message
          )
        }

        if (clientResult.error) {
          throw new Error(
            clientResult.error.message
          )
        }

        if (sessionResult.error) {
          throw new Error(
            sessionResult.error.message
          )
        }

        setMember(loadedMember)

        setPermissions(
          permissionResult.data
            ? (permissionResult.data as PermissionRecord)
            : {
                user_id: loadedMember.id,
                organization_id:
                  loadedMember.organization_id,
                ...EMPTY_PERMISSIONS,
              }
        )

        setAssignedClients(
          (clientResult.data || []) as ClientRecord[]
        )

        setUpcomingSessions(
          (sessionResult.data || []) as SessionRecord[]
        )

        setFullName(
          loadedMember.full_name || ""
        )

        setRole(loadedMember.role)
      } catch (error) {
        console.error(
          "Load team member error:",
          error
        )

        setPageError(
          error instanceof Error
            ? error.message
            : "Unable to load this account."
        )
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [userId]
  )

  useEffect(() => {
    loadUser()
  }, [loadUser])

  const isSelf =
    Boolean(
      callerId &&
      member &&
      callerId === member.id
    )

  const memberIsOwner =
    member?.role === "owner"

  const accountLocked =
    Boolean(memberIsOwner || isSelf)

  const canAssignAdmin =
    callerRole === "owner" ||
    callerRole === "admin"

  const visibleRoleOptions =
    ROLE_OPTIONS.filter((option) => {
      if (
        option.value === "admin" &&
        !canAssignAdmin
      ) {
        return false
      }

      return true
    })

  const memberDisplayName =
    member?.full_name ||
    member?.email ||
    "Team Member"

  const clientNameMap = useMemo(
    () =>
      new Map(
        assignedClients.map((client) => [
          client.id,
          client.preferred_name ||
            client.first_name,
        ])
      ),
    [assignedClients]
  )

  const saveProfile = async (
    event: FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault()

    if (
      !member ||
      accountLocked ||
      !callerCanManageUsers
    ) {
      return
    }

    if (!fullName.trim()) {
      setPageError(
        "A full name is required."
      )
      return
    }

    if (role === "owner") {
      setPageError(
        "Ownership cannot be assigned from Team Management."
      )
      return
    }

    if (
      role === "admin" &&
      !canAssignAdmin
    ) {
      setPageError(
        "Only owners and administrators can assign the Administrator role."
      )
      return
    }

    setSavingProfile(true)
    setPageError(null)
    setSuccessMessage(null)

    try {
      const { error } = await supabase
        .from("users")
        .update({
          full_name: fullName.trim(),
          role,
        })
        .eq("id", member.id)

      if (error) {
        throw new Error(error.message)
      }

      setSuccessMessage(
        "Account profile updated successfully."
      )

      await loadUser()
    } catch (error) {
      console.error(
        "Save user profile error:",
        error
      )

      setPageError(
        error instanceof Error
          ? error.message
          : "Unable to update the account."
      )
    } finally {
      setSavingProfile(false)
    }
  }

  const savePermissions = async () => {
    if (
      !member ||
      !permissions ||
      accountLocked ||
      !callerCanManageUsers
    ) {
      return
    }

    setSavingPermissions(true)
    setPageError(null)
    setSuccessMessage(null)

    try {
      const { error } = await supabase
        .from("user_permissions")
        .upsert(
          {
            ...permissions,
            user_id: member.id,
            organization_id:
              member.organization_id,
          },
          {
            onConflict: "user_id",
          }
        )

      if (error) {
        throw new Error(error.message)
      }

      setSuccessMessage(
        "Account permissions updated."
      )

      await loadUser()
    } catch (error) {
      console.error(
        "Save permissions error:",
        error
      )

      setPageError(
        error instanceof Error
          ? error.message
          : "Unable to update permissions."
      )
    } finally {
      setSavingPermissions(false)
    }
  }

  const togglePermission = (
    key: PermissionKey
  ) => {
    if (
      !permissions ||
      accountLocked
    ) {
      return
    }

    setPermissions({
      ...permissions,
      [key]: !permissions[key],
    })
  }

  const toggleAccountStatus = async () => {
    if (
      !member ||
      accountLocked ||
      !callerCanManageUsers
    ) {
      return
    }

    const nextStatus =
      member.status === "active"
        ? "inactive"
        : "active"

    const confirmed = window.confirm(
      nextStatus === "inactive"
        ? "Deactivate this account? The user will lose normal organization access."
        : "Reactivate this account?"
    )

    if (!confirmed) return

    setAccountActionLoading(true)
    setPageError(null)
    setSuccessMessage(null)

    try {
      const { error } = await supabase
        .from("users")
        .update({
          status: nextStatus,
        })
        .eq("id", member.id)

      if (error) {
        throw new Error(error.message)
      }

      setSuccessMessage(
        nextStatus === "active"
          ? "Account reactivated."
          : "Account deactivated."
      )

      await loadUser()
    } catch (error) {
      console.error(
        "Toggle account status error:",
        error
      )

      setPageError(
        error instanceof Error
          ? error.message
          : "Unable to change account status."
      )
    } finally {
      setAccountActionLoading(false)
    }
  }

  const resendInvitation = async () => {
    if (
      !member?.email ||
      accountLocked
    ) {
      return
    }

    setAccountActionLoading(true)
    setPageError(null)
    setSuccessMessage(null)

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session?.access_token) {
        throw new Error(
          "Your login session has expired."
        )
      }

      const response = await fetch(
        "/api/invite-user",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
            Authorization:
              `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            fullName:
              member.full_name ||
              member.email,
            email: member.email,
            role: member.role,
            organizationId:
              member.organization_id,
            resend: true,
          }),
        }
      )

      const result =
        await response.json()

      if (!response.ok) {
        throw new Error(
          result.error ||
            "Unable to resend invitation."
        )
      }

      setSuccessMessage(
        `Account setup email sent to ${member.email}.`
      )
    } catch (error) {
      console.error(
        "Resend invitation error:",
        error
      )

      setPageError(
        error instanceof Error
          ? error.message
          : "Unable to resend invitation."
      )
    } finally {
      setAccountActionLoading(false)
    }
  }

  const requestPinReset = async () => {
    if (
      !member ||
      accountLocked
    ) {
      return
    }

    setAccountActionLoading(true)
    setPageError(null)
    setSuccessMessage(null)

    try {
      const { error } = await supabase
        .from("users")
        .update({
          pin_reset_required: true,
        })
        .eq("id", member.id)

      if (error) {
        throw new Error(error.message)
      }

      setSuccessMessage(
        "PIN reset will be required on the user’s next login."
      )

      await loadUser()
    } catch (error) {
      console.error(
        "PIN reset error:",
        error
      )

      setPageError(
        error instanceof Error
          ? error.message
          : "Unable to require a PIN reset."
      )
    } finally {
      setAccountActionLoading(false)
    }
  }

  if (loading) {
    return <UserLoadingState />
  }

  if (!member) {
    return (
      <div className="mx-auto max-w-xl">
        <section className="rj-card p-8 text-center">
          <CircleAlert
            size={36}
            className="mx-auto text-[var(--rj-danger)]"
          />

          <h1 className="rj-heading-2 mt-4">
            Account unavailable
          </h1>

          <p className="rj-body mt-2 text-[var(--rj-text-secondary)]">
            {pageError ||
              "This team member could not be loaded."}
          </p>

          <Link
            href="/team-management"
            className="rj-button rj-button-primary mt-6"
          >
            <ArrowLeft size={18} />
            Back to People
          </Link>
        </section>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
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
            loadUser(true)
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

      <header className="relative overflow-hidden rounded-[var(--rj-radius-xl)] border border-[var(--rj-border)] bg-white p-6 shadow-[var(--rj-shadow-soft)] sm:p-8">
        <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-[var(--rj-lavender-100)] opacity-65" />

        <div className="pointer-events-none absolute -bottom-24 right-36 h-48 w-48 rounded-full bg-[var(--rj-teal-100)] opacity-50" />

        <div className="relative flex flex-col justify-between gap-6 lg:flex-row lg:items-center">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-full bg-[var(--rj-teal-50)] px-3 py-1.5 text-sm font-bold text-[var(--rj-teal-700)]">
                <ShieldCheck size={15} />
                Account Management
              </span>

              <StatusBadge
                status={member.status}
              />

              <span className="rj-badge rj-badge-info">
                {formatLabel(
                  member.role
                )}
              </span>
            </div>

            <h1 className="rj-heading-1 mt-4">
              {memberDisplayName}
            </h1>

            <p className="rj-body mt-2 text-[var(--rj-text-secondary)]">
              {member.email ||
                "No email address"}
            </p>
          </div>

          {!accountLocked && (
            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={resendInvitation}
                disabled={
                  accountActionLoading ||
                  !member.email
                }
                className="rj-button rj-button-secondary"
              >
                <Send size={18} />
                Resend Setup Email
              </button>

              <button
                type="button"
                onClick={requestPinReset}
                disabled={
                  accountActionLoading
                }
                className="rj-button rj-button-secondary"
              >
                <KeyRound size={18} />
                Require PIN Reset
              </button>
            </div>
          )}
        </div>
      </header>

      {pageError && (
        <MessageBanner
          success={false}
          message={pageError}
        />
      )}

      {successMessage && (
        <MessageBanner
          success
          message={successMessage}
        />
      )}

      {memberIsOwner && (
        <div className="rounded-[var(--rj-radius-md)] bg-[var(--rj-warning-soft)] p-4">
          <p className="font-bold text-[#926c22]">
            Owner account protected
          </p>

          <p className="rj-caption mt-1">
            Owner accounts cannot be modified from
            Team Management. Ownership changes will
            use a separate transfer workflow.
          </p>
        </div>
      )}

      {isSelf && !memberIsOwner && (
        <div className="rounded-[var(--rj-radius-md)] bg-[var(--rj-blue-50)] p-4">
          <p className="font-bold text-[var(--rj-blue-700)]">
            This is your account
          </p>

          <p className="rj-caption mt-1">
            You cannot change your own role,
            permissions, or account status from Team
            Management. Use Profile for personal
            account details.
          </p>
        </div>
      )}

      <section className="grid gap-4 sm:grid-cols-3">
        <SummaryCard
          label="Assigned Clients"
          value={assignedClients.length}
          icon={Users}
          background="var(--rj-blue-100)"
          foreground="var(--rj-blue-700)"
        />

        <SummaryCard
          label="Upcoming Sessions"
          value={upcomingSessions.length}
          icon={CalendarDays}
          background="var(--rj-lavender-100)"
          foreground="var(--rj-lavender-700)"
        />

        <SummaryCard
          label="Account"
          value={0}
          valueText={formatLabel(
            member.status
          )}
          icon={UserRound}
          background="var(--rj-mint-100)"
          foreground="var(--rj-mint-700)"
        />
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(330px,420px)_minmax(0,1fr)]">
        <div className="space-y-6">
          <section className="rj-card p-6">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--rj-blue-100)] text-[var(--rj-blue-700)]">
                <UserRound size={22} />
              </div>

              <div>
                <p className="rj-label">
                  Profile
                </p>

                <h2 className="rj-heading-2 mt-1">
                  Account details
                </h2>
              </div>
            </div>

            <form
              onSubmit={saveProfile}
              className="mt-6 space-y-5"
            >
              <FormField label="Full name">
                <input
                  value={fullName}
                  onChange={(event) =>
                    setFullName(
                      event.target.value
                    )
                  }
                  disabled={accountLocked}
                  className="rj-input"
                  required
                />
              </FormField>

              <FormField label="Email">
                <div className="relative">
                  <Mail
                    size={18}
                    className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--rj-text-muted)]"
                  />

                  <input
                    value={
                      member.email || ""
                    }
                    disabled
                    className="rj-input pl-11 opacity-70"
                  />
                </div>

                <p className="rj-caption mt-2">
                  Email changes should be handled
                  through Supabase Auth rather than
                  directly editing the profile row.
                </p>
              </FormField>

              <FormField label="Role">
                {memberIsOwner ? (
                  <input
                    value="Owner"
                    disabled
                    className="rj-input opacity-70"
                  />
                ) : (
                  <select
                    value={role}
                    onChange={(event) =>
                      setRole(
                        event.target
                          .value as UserRole
                      )
                    }
                    disabled={accountLocked}
                    className="rj-input"
                  >
                    {visibleRoleOptions.map(
                      (option) => (
                        <option
                          key={
                            option.value
                          }
                          value={
                            option.value
                          }
                        >
                          {option.label}
                        </option>
                      )
                    )}
                  </select>
                )}

                {!memberIsOwner &&
                  !canAssignAdmin && (
                    <p className="rj-caption mt-2">
                      Only owners and administrators
                      can assign the Administrator
                      role.
                    </p>
                  )}
              </FormField>

              {!accountLocked && (
                <button
                  type="submit"
                  disabled={
                    savingProfile
                  }
                  className="rj-button rj-button-primary w-full"
                >
                  {savingProfile ? (
                    <LoaderCircle
                      size={19}
                      className="animate-spin"
                    />
                  ) : (
                    <Save size={19} />
                  )}

                  Save Profile
                </button>
              )}
            </form>
          </section>

          <section className="rj-card p-6">
            <p className="rj-label">
              Account Access
            </p>

            <h2 className="rj-heading-2 mt-1">
              Status
            </h2>

            <div className="mt-5 flex items-center justify-between gap-4 rounded-[var(--rj-radius-md)] bg-[var(--rj-surface-muted)] p-4">
              <div>
                <p className="font-bold">
                  {member.status === "active"
                    ? "Active account"
                    : `${formatLabel(
                        member.status
                      )} account`}
                </p>

                <p className="rj-caption mt-1">
                  {member.status === "active"
                    ? "This user can access permitted organization resources."
                    : "Normal organization access is restricted."}
                </p>
              </div>

              {!accountLocked && (
                <button
                  type="button"
                  onClick={
                    toggleAccountStatus
                  }
                  disabled={
                    accountActionLoading
                  }
                  className="rj-icon-button"
                  aria-label="Toggle account status"
                >
                  {accountActionLoading ? (
                    <LoaderCircle
                      size={20}
                      className="animate-spin"
                    />
                  ) : member.status ===
                    "active" ? (
                    <ToggleRight
                      size={25}
                      className="text-[var(--rj-teal-700)]"
                    />
                  ) : (
                    <ToggleLeft
                      size={25}
                    />
                  )}
                </button>
              )}
            </div>
          </section>
        </div>

        <div className="space-y-6">
          <section className="rj-card p-6">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--rj-lavender-100)] text-[var(--rj-lavender-700)]">
                <ShieldCheck size={22} />
              </div>

              <div>
                <p className="rj-label">
                  Permissions
                </p>

                <h2 className="rj-heading-2 mt-1">
                  Administrative access
                </h2>
              </div>
            </div>

            <p className="rj-caption mt-3">
              These grants supplement the user’s role.
              Database RLS remains the final
              authorization layer.
            </p>

            {memberIsOwner && (
              <div className="mt-5 rounded-[var(--rj-radius-md)] bg-[var(--rj-success-soft)] p-4">
                <p className="font-bold text-[var(--rj-mint-700)]">
                  Owners receive organization permissions
                  automatically.
                </p>

                <p className="rj-caption mt-1">
                  Owner access is not controlled by
                  user_permissions toggles.
                </p>
              </div>
            )}

            {permissions &&
              !memberIsOwner && (
                <div className="mt-6 space-y-3">
                  <PermissionToggle
                    label="Manage users"
                    description="Invite, edit, and deactivate organization accounts."
                    icon={Users}
                    enabled={
                      permissions.can_manage_users
                    }
                    disabled={accountLocked}
                    onClick={() =>
                      togglePermission(
                        "can_manage_users"
                      )
                    }
                  />

                  <PermissionToggle
                    label="Manage clients"
                    description="Create and edit client profiles, targets, and behaviors."
                    icon={UserRound}
                    enabled={
                      permissions.can_manage_clients
                    }
                    disabled={accountLocked}
                    onClick={() =>
                      togglePermission(
                        "can_manage_clients"
                      )
                    }
                  />

                  <PermissionToggle
                    label="Manage sessions"
                    description="Create, prepare, edit, and assign sessions."
                    icon={CalendarDays}
                    enabled={
                      permissions.can_manage_sessions
                    }
                    disabled={accountLocked}
                    onClick={() =>
                      togglePermission(
                        "can_manage_sessions"
                      )
                    }
                  />

                  <PermissionToggle
                    label="Review session notes"
                    description="Review submitted documentation and return or approve notes."
                    icon={FileCheck2}
                    enabled={
                      permissions.can_review_sessions
                    }
                    disabled={accountLocked}
                    onClick={() =>
                      togglePermission(
                        "can_review_sessions"
                      )
                    }
                  />

                  <PermissionToggle
                    label="View reports"
                    description="Access organization reporting and analytics."
                    icon={CheckCircle2}
                    enabled={
                      permissions.can_view_reports
                    }
                    disabled={accountLocked}
                    onClick={() =>
                      togglePermission(
                        "can_view_reports"
                      )
                    }
                  />

                  <PermissionToggle
                    label="Manage billing"
                    description="Access subscription and billing administration."
                    icon={CreditCard}
                    enabled={
                      permissions.can_manage_billing
                    }
                    disabled={
                      accountLocked ||
                      !(
                        callerRole ===
                          "owner" ||
                        callerRole ===
                          "admin"
                      )
                    }
                    onClick={() =>
                      togglePermission(
                        "can_manage_billing"
                      )
                    }
                  />

                  {!accountLocked && (
                    <button
                      type="button"
                      onClick={
                        savePermissions
                      }
                      disabled={
                        savingPermissions
                      }
                      className="rj-button rj-button-primary mt-5"
                    >
                      {savingPermissions ? (
                        <LoaderCircle
                          size={19}
                          className="animate-spin"
                        />
                      ) : (
                        <Save size={19} />
                      )}

                      Save Permissions
                    </button>
                  )}
                </div>
              )}
          </section>

          <section className="rj-card overflow-hidden">
            <div className="border-b border-[var(--rj-border)] p-6">
              <p className="rj-label">
                Assignments
              </p>

              <h2 className="rj-heading-2 mt-1">
                Primary Clients
              </h2>
            </div>

            {assignedClients.length === 0 ? (
              <div className="p-7 text-center">
                <p className="rj-caption">
                  No clients currently use this
                  account as their primary frontline
                  worker.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-[var(--rj-border)]">
                {assignedClients.map(
                  (client) => (
                    <Link
                      key={client.id}
                      href={`/clients/${client.id}`}
                      className="flex items-center justify-between gap-4 p-5 transition-colors hover:bg-[var(--rj-surface-muted)]"
                    >
                      <div>
                        <p className="font-bold">
                          {client.preferred_name ||
                            client.first_name}
                        </p>

                        <p className="rj-caption mt-1">
                          {formatLabel(
                            client.status
                          )}
                        </p>
                      </div>

                      <ArrowLeft
                        size={18}
                        className="rotate-180 text-[var(--rj-text-muted)]"
                      />
                    </Link>
                  )
                )}
              </div>
            )}
          </section>

          <section className="rj-card overflow-hidden">
            <div className="border-b border-[var(--rj-border)] p-6">
              <p className="rj-label">
                Schedule
              </p>

              <h2 className="rj-heading-2 mt-1">
                Upcoming Sessions
              </h2>
            </div>

            {upcomingSessions.length === 0 ? (
              <div className="p-7 text-center">
                <p className="rj-caption">
                  No upcoming sessions are assigned
                  to this user.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-[var(--rj-border)]">
                {upcomingSessions.map(
                  (session) => (
                    <Link
                      key={session.id}
                      href={`/sessions/${session.id}`}
                      className="block p-5 transition-colors hover:bg-[var(--rj-surface-muted)]"
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <p className="font-bold">
                            {clientNameMap.get(
                              session.client_id
                            ) ||
                              "Assigned client"}
                          </p>

                          <p className="rj-caption mt-1">
                            {formatDateRange(
                              session.scheduled_start,
                              session.scheduled_end
                            )}
                          </p>

                          {session.location && (
                            <p className="rj-caption mt-1">
                              {
                                session.location
                              }
                            </p>
                          )}
                        </div>

                        <SessionStatusBadge
                          status={
                            session.status
                          }
                        />
                      </div>
                    </Link>
                  )
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

function PermissionToggle({
  label,
  description,
  icon: Icon,
  enabled,
  disabled,
  onClick,
}: {
  label: string
  description: string
  icon: typeof Users
  enabled: boolean
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center justify-between gap-4 rounded-[var(--rj-radius-md)] bg-[var(--rj-surface-muted)] p-4 text-left disabled:cursor-not-allowed disabled:opacity-50"
    >
      <div className="flex gap-3">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
            enabled
              ? "bg-[var(--rj-teal-100)] text-[var(--rj-teal-700)]"
              : "bg-white text-[var(--rj-text-muted)]"
          }`}
        >
          <Icon size={19} />
        </div>

        <div>
          <p className="font-bold">
            {label}
          </p>

          <p className="rj-caption mt-1">
            {description}
          </p>
        </div>
      </div>

      {enabled ? (
        <ToggleRight
          size={26}
          className="shrink-0 text-[var(--rj-teal-700)]"
        />
      ) : (
        <ToggleLeft
          size={26}
          className="shrink-0 text-[var(--rj-text-muted)]"
        />
      )}
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

function SummaryCard({
  label,
  value,
  valueText,
  icon: Icon,
  background,
  foreground,
}: {
  label: string
  value: number
  valueText?: string
  icon: typeof Users
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
            {valueText || value}
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

function StatusBadge({
  status,
}: {
  status: UserStatus
}) {
  const className =
    status === "active"
      ? "rj-badge-success"
      : status === "inactive"
        ? "rj-badge-warning"
        : status === "suspended"
          ? "rj-badge-danger"
          : "rj-badge-info"

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
  message,
}: {
  success: boolean
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

        <p className="font-semibold">
          {message}
        </p>
      </div>
    </div>
  )
}

function UserLoadingState() {
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
          Loading account…
        </p>
      </div>
    </div>
  )
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