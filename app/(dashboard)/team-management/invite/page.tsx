"use client"

import {
  type FormEvent,
  useEffect,
  useMemo,
  useState,
} from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  ArrowLeft,
  CheckCircle2,
  CircleAlert,
  LoaderCircle,
  Mail,
  Send,
  ShieldCheck,
  Sparkles,
  UserPlus,
  Users,
} from "lucide-react"

import { supabase } from "@/lib/supabase"

type UserRole =
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

type RoleOption = {
  value: UserRole
  label: string
  group: "administrative" | "frontline"
  description: string
}

type InviteResult = {
  user_id?: string
  email?: string
  role?: string
  invited?: boolean
  resent?: boolean
  message?: string
  code?: string
}

const ROLE_OPTIONS: RoleOption[] = [
  {
    value: "admin",
    label: "Administrator",
    group: "administrative",
    description:
      "Broad organization access including people, sessions, configuration, and administrative workflows.",
  },
  {
    value: "manager",
    label: "Manager",
    group: "administrative",
    description:
      "Supports staff, scheduling, client programs, and operational workflows.",
  },
  {
    value: "director",
    label: "Director",
    group: "administrative",
    description:
      "Leadership access for organization oversight and session review.",
  },
  {
    value: "therapist",
    label: "Therapist",
    group: "frontline",
    description:
      "Provides direct services and records session data.",
  },
  {
    value: "teacher",
    label: "Teacher",
    group: "frontline",
    description:
      "Runs assigned sessions and records educational or care data.",
  },
  {
    value: "educator",
    label: "Educator",
    group: "frontline",
    description:
      "Provides frontline instruction and session documentation.",
  },
  {
    value: "assistant",
    label: "Assistant",
    group: "frontline",
    description:
      "Supports assigned clients and frontline service workflows.",
  },
  {
    value: "aide",
    label: "Aide",
    group: "frontline",
    description:
      "Provides direct support under the organization’s care or education model.",
  },
  {
    value: "caregiver",
    label: "Caregiver",
    group: "frontline",
    description:
      "Supports direct care and assigned session workflows.",
  },
  {
    value: "staff",
    label: "Staff",
    group: "frontline",
    description:
      "General frontline account with assigned-session access.",
  },
]

export default function InviteTeamMemberPage() {
  const router = useRouter()

  const [fullName, setFullName] = useState("")
  const [email, setEmail] = useState("")
  const [role, setRole] =
    useState<UserRole>("teacher")

  const [organizationId, setOrganizationId] =
    useState<string | null>(null)

  const [checkingAccess, setCheckingAccess] =
    useState(true)

    const [existingUser, setExistingUser] =
  useState<InviteResult | null>(null)

  const [sending, setSending] = useState(false)

  const [pageError, setPageError] =
    useState<string | null>(null)

  const [successMessage, setSuccessMessage] =
    useState<string | null>(null)

  const [inviteResult, setInviteResult] =
    useState<InviteResult | null>(null)

  const selectedRole = useMemo(
    () =>
      ROLE_OPTIONS.find(
        (option) => option.value === role
      ) || null,
    [role]
  )

  useEffect(() => {
    const loadAccess = async () => {
      setCheckingAccess(true)
      setPageError(null)

      try {
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser()

        if (userError) {
          throw new Error(userError.message)
        }

        if (!user) {
          router.push("/login")
          return
        }

        const {
          data: profile,
          error: profileError,
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

        if (profileError) {
          throw new Error(
            profileError.message
          )
        }

        if (
          ![
            "owner",
            "admin",
            "manager",
            "director",
          ].includes(profile.role)
        ) {
          throw new Error(
            "You do not have permission to invite team members."
          )
        }

        if (!profile.organization_id) {
          throw new Error(
            "Your account is not connected to an organization."
          )
        }

        setOrganizationId(
          profile.organization_id
        )
      } catch (error) {
        console.error(
          "Load invitation access error:",
          error
        )

        setPageError(
          error instanceof Error
            ? error.message
            : "Unable to open team invitations."
        )
      } finally {
        setCheckingAccess(false)
      }
    }

    loadAccess()
  }, [router])

const handleInvite = async (
  event: FormEvent<HTMLFormElement>
) => {
  event.preventDefault()

  if (!organizationId) {
    setPageError(
      "Your organization could not be identified."
    )
    return
  }

  if (!fullName.trim()) {
    setPageError(
      "Enter the team member’s name."
    )
    return
  }

  const normalizedEmail =
    email.trim().toLowerCase()

  if (
    !normalizedEmail ||
    !normalizedEmail.includes("@")
  ) {
    setPageError(
      "Enter a valid email address."
    )
    return
  }

  setSending(true)
  setPageError(null)
  setSuccessMessage(null)
  setInviteResult(null)
  setExistingUser(null)

  try {
    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!session?.access_token) {
      throw new Error(
        "Your login session expired. Sign in again and retry."
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
          fullName: fullName.trim(),
          email: normalizedEmail,
          role,
          organizationId,
        }),
      }
    )

    const result =
      (await response.json()) as InviteResult & {
        error?: string
      }

    /*
     * Same organization:
     * this is not really an application failure.
     *
     * Give the owner a direct path to the
     * existing account instead.
     */
    if (
      response.status === 409 &&
      result.code ===
        "USER_ALREADY_IN_ORGANIZATION" &&
      result.user_id
    ) {
      setExistingUser({
        ...result,
        email: normalizedEmail,
      })

      return
    }

    /*
     * Different account / organization:
     * keep this as an actual conflict.
     */
    if (
      response.status === 409 &&
      (
        result.code ===
          "EMAIL_ALREADY_IN_USE" ||
        result.code ===
          "AUTH_EMAIL_ALREADY_EXISTS"
      )
    ) {
      setPageError(
        result.error ||
          "This email address is already tied to another ReJoyce account."
      )

      return
    }

    if (!response.ok) {
      throw new Error(
        result.error ||
          "Unable to invite this team member."
      )
    }

    setInviteResult(result)

    setSuccessMessage(
      result.resent
        ? `A new account setup email was sent to ${normalizedEmail}.`
        : `Invitation sent to ${normalizedEmail}.`
    )

    setFullName("")
    setEmail("")
    setRole("teacher")
  } catch (error) {
    console.error(
      "Invite team member error:",
      error
    )

    setPageError(
      error instanceof Error
        ? error.message
        : "Unable to send the invitation."
    )
  } finally {
    setSending(false)
  }
}

  if (checkingAccess) {
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
            Preparing team invitation…
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <Link
          href="/team-management"
          className="inline-flex items-center gap-2 font-bold text-[var(--rj-teal-700)]"
        >
          <ArrowLeft size={18} />
          People
        </Link>
      </div>

      <header className="relative overflow-hidden rounded-[var(--rj-radius-xl)] border border-[var(--rj-border)] bg-white p-6 shadow-[var(--rj-shadow-soft)] sm:p-8">
        <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-[var(--rj-lavender-100)] opacity-65" />

        <div className="pointer-events-none absolute -bottom-24 right-32 h-48 w-48 rounded-full bg-[var(--rj-teal-100)] opacity-50" />

        <div className="relative">
          <span className="inline-flex items-center gap-2 rounded-full bg-[var(--rj-teal-50)] px-3 py-1.5 text-sm font-bold text-[var(--rj-teal-700)]">
            <Sparkles size={15} />
            Account Setup
          </span>

          <h1 className="rj-heading-1 mt-4">
            Invite Team Member
          </h1>

          <p className="rj-body mt-3 max-w-2xl text-[var(--rj-text-secondary)]">
            Create an organization account and send
            the new team member a secure invitation
            to finish their login setup.
          </p>
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
          title="Invitation sent"
          message={successMessage}
        />
      )}

      {existingUser?.user_id && (
  <section className="rounded-[var(--rj-radius-lg)] border border-[var(--rj-blue-100)] bg-[var(--rj-blue-50)] p-5">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
      <div className="flex gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-[var(--rj-blue-700)]">
          <Users size={21} />
        </div>

        <div>
          <h2 className="font-bold text-[var(--rj-blue-700)]">
            This person is already on your team
          </h2>

          <p className="rj-caption mt-1">
            {existingUser.email} already has an
            account in your organization. You can
            manage their role, status, permissions,
            or resend their account setup email from
            their profile.
          </p>
        </div>
      </div>

      <Link
        href={`/team-management/${existingUser.user_id}`}
        className="rj-button rj-button-primary shrink-0"
      >
        Manage Account
        <ArrowLeft
          size={17}
          className="rotate-180"
        />
      </Link>
    </div>
  </section>
)}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_330px]">
        <section className="rj-card p-6 sm:p-8">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--rj-blue-100)] text-[var(--rj-blue-700)]">
              <UserPlus size={25} />
            </div>

            <div>
              <p className="rj-label">
                New Account
              </p>

              <h2 className="rj-heading-2 mt-1">
                Team member details
              </h2>
            </div>
          </div>

          <form
            onSubmit={handleInvite}
            className="mt-8 space-y-6"
          >
            <FormField label="Full name">
              <input
                type="text"
                value={fullName}
                onChange={(event) =>
                  setFullName(
                    event.target.value
                  )
                }
                placeholder="Example: Jordan Smith"
                className="rj-input"
                autoComplete="name"
                required
              />
            </FormField>

            <FormField label="Email address">
              <div className="relative">
                <Mail
                  size={19}
                  className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--rj-text-muted)]"
                />

                <input
                  type="email"
                  value={email}
                  onChange={(event) => {
  setEmail(event.target.value)

  if (existingUser) {
    setExistingUser(null)
  }

  if (pageError) {
    setPageError(null)
  }
}}
                  placeholder="jordan@example.com"
                  className="rj-input pl-12"
                  autoComplete="email"
                  required
                />
              </div>

              <p className="rj-caption mt-2">
                ReJoyce will use this address for
                authentication and account recovery.
              </p>
            </FormField>

            <FormField label="Account role">
              <select
                value={role}
                onChange={(event) => {
  setRole(
    event.target.value as UserRole
  )

  if (existingUser) {
    setExistingUser(null)
  }
}}
                className="rj-input"
                required
              >
                <optgroup label="Frontline roles">
                  {ROLE_OPTIONS.filter(
                    (option) =>
                      option.group ===
                      "frontline"
                  ).map((option) => (
                    <option
                      key={option.value}
                      value={option.value}
                    >
                      {option.label}
                    </option>
                  ))}
                </optgroup>

                <optgroup label="Administrative roles">
                  {ROLE_OPTIONS.filter(
                    (option) =>
                      option.group ===
                      "administrative"
                  ).map((option) => (
                    <option
                      key={option.value}
                      value={option.value}
                    >
                      {option.label}
                    </option>
                  ))}
                </optgroup>
              </select>

              {selectedRole && (
                <div className="mt-3 rounded-[var(--rj-radius-md)] bg-[var(--rj-blue-50)] p-4">
                  <div className="flex gap-3">
                    {selectedRole.group ===
                    "administrative" ? (
                      <ShieldCheck
                        size={20}
                        className="shrink-0 text-[var(--rj-blue-700)]"
                      />
                    ) : (
                      <Users
                        size={20}
                        className="shrink-0 text-[var(--rj-blue-700)]"
                      />
                    )}

                    <div>
                      <p className="text-sm font-bold text-[var(--rj-blue-700)]">
                        {selectedRole.label}
                      </p>

                      <p className="rj-caption mt-1">
                        {
                          selectedRole.description
                        }
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </FormField>

            <div className="rounded-[var(--rj-radius-lg)] bg-[var(--rj-surface-muted)] p-5">
              <p className="font-bold">
                What happens next?
              </p>

              <div className="mt-4 space-y-4">
                <InvitationStep
                  number={1}
                  title="Invitation email"
                  description="The team member receives a secure account invitation."
                />

                <InvitationStep
                  number={2}
                  title="Account activation"
                  description="They follow the invitation link and establish their authenticated session."
                />

                <InvitationStep
                  number={3}
                  title="Create 4-digit PIN"
                  description="On first login, they create the quick-access PIN used by the mobile workflow."
                />

                <InvitationStep
                  number={4}
                  title="Assigned work appears"
                  description="Sessions assigned by administrators become available in My Sessions."
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={sending}
              className="rj-button rj-button-primary w-full"
            >
              {sending ? (
                <LoaderCircle
                  size={20}
                  className="animate-spin"
                />
              ) : (
                <Send size={20} />
              )}

              {sending
                ? "Sending Invitation…"
                : "Invite Team Member"}
            </button>
          </form>
        </section>

        <aside className="space-y-5">
          <section className="rj-card p-5">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--rj-teal-100)] text-[var(--rj-teal-700)]">
              <ShieldCheck size={21} />
            </div>

            <h2 className="rj-heading-3 mt-4">
              Role-based access
            </h2>

            <p className="rj-caption mt-2">
              Selecting a role controls the
              navigation shown to the user, while
              database RLS determines which records
              they are actually allowed to access.
            </p>
          </section>

          <section className="rj-card p-5">
            <h2 className="font-bold">
              Frontline accounts
            </h2>

            <p className="rj-caption mt-2">
              Teachers, therapists, educators,
              aides, caregivers, and other frontline
              staff see only the sessions and clients
              assigned to them.
            </p>
          </section>

          <section className="rj-card p-5">
            <h2 className="font-bold">
              Administrative accounts
            </h2>

            <p className="rj-caption mt-2">
              Administrative access should be given
              intentionally. Additional permission
              controls can further limit billing,
              reporting, or review access.
            </p>
          </section>

          {inviteResult?.user_id && (
  <section className="rounded-[var(--rj-radius-lg)] bg-[var(--rj-success-soft)] p-5">
    <CheckCircle2
      size={24}
      className="text-[var(--rj-mint-700)]"
    />

    <h2 className="mt-3 font-bold text-[var(--rj-mint-700)]">
      {inviteResult.resent
        ? "Setup email resent"
        : "Account created"}
    </h2>

    <p className="rj-caption mt-2">
      {inviteResult.resent
        ? "A new account setup link was sent to the existing team member."
        : "The team member has been added to your organization and their invitation was sent."}
    </p>

    <Link
      href={`/team-management/${inviteResult.user_id}`}
      className="mt-4 inline-flex items-center gap-2 font-bold text-[var(--rj-teal-700)]"
    >
      Manage Account
      <ArrowLeft
        size={17}
        className="rotate-180"
      />
    </Link>
  </section>
)}
        </aside>
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

function InvitationStep({
  number,
  title,
  description,
}: {
  number: number
  title: string
  description: string
}) {
  return (
    <div className="flex gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-sm font-bold text-[var(--rj-teal-700)]">
        {number}
      </div>

      <div>
        <p className="text-sm font-bold">
          {title}
        </p>

        <p className="rj-caption mt-1">
          {description}
        </p>
      </div>
    </div>
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