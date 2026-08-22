import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL!

const supabaseServiceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY!

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL

const supabaseAdmin = createClient(
  supabaseUrl,
  supabaseServiceRoleKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
)

const ALLOWED_ROLES = [
  "admin",
  "manager",
  "director",
  "therapist",
  "teacher",
  "educator",
  "assistant",
  "aide",
  "caregiver",
  "staff",
] as const

type AllowedRole =
  (typeof ALLOWED_ROLES)[number]

const ADMIN_ROLES = [
  "owner",
  "admin",
  "manager",
  "director",
]

type InviteRequestBody = {
  fullName?: unknown
  email?: unknown
  role?: unknown
  organizationId?: unknown
  resend?: unknown
}

export async function POST(
  request: Request
) {
  try {
    // =====================================================
    // 1. Verify caller authentication
    // =====================================================

    const authorization =
      request.headers.get("authorization")

    if (
      !authorization ||
      !authorization.startsWith("Bearer ")
    ) {
      return NextResponse.json(
        {
          error:
            "Missing authentication token.",
        },
        {
          status: 401,
        }
      )
    }

    const accessToken =
      authorization.slice("Bearer ".length)

    const {
      data: callerAuthData,
      error: callerAuthError,
    } =
      await supabaseAdmin.auth.getUser(
        accessToken
      )

    if (
      callerAuthError ||
      !callerAuthData.user
    ) {
      console.error(
        "Invite-user caller auth error:",
        callerAuthError
      )

      return NextResponse.json(
        {
          error:
            "Your login session is invalid or expired.",
        },
        {
          status: 401,
        }
      )
    }

    const callerId =
      callerAuthData.user.id

    // =====================================================
    // 2. Load and authorize caller profile
    // =====================================================

    const {
      data: callerProfile,
      error: callerProfileError,
    } = await supabaseAdmin
      .from("users")
      .select(`
        id,
        organization_id,
        role,
        status
      `)
      .eq("id", callerId)
      .single()

    if (
      callerProfileError ||
      !callerProfile
    ) {
      console.error(
        "Invite-user caller profile error:",
        callerProfileError
      )

      return NextResponse.json(
        {
          error:
            "Unable to verify your organization account.",
        },
        {
          status: 403,
        }
      )
    }

    if (
      callerProfile.status !== "active"
    ) {
      return NextResponse.json(
        {
          error:
            "Your account is not active.",
        },
        {
          status: 403,
        }
      )
    }

    if (
      !ADMIN_ROLES.includes(
        callerProfile.role
      )
    ) {
      return NextResponse.json(
        {
          error:
            "You do not have permission to invite team members.",
        },
        {
          status: 403,
        }
      )
    }

    if (
      !callerProfile.organization_id
    ) {
      return NextResponse.json(
        {
          error:
            "Your account is not connected to an organization.",
        },
        {
          status: 400,
        }
      )
    }

    // =====================================================
    // 3. Parse and validate request
    // =====================================================

    const body =
      (await request.json()) as InviteRequestBody

    const fullName =
      typeof body.fullName === "string"
        ? body.fullName.trim()
        : ""

    const email =
      typeof body.email === "string"
        ? body.email
            .trim()
            .toLowerCase()
        : ""

    const role =
      typeof body.role === "string"
        ? body.role.trim()
        : ""

    const requestedOrganizationId =
      typeof body.organizationId ===
      "string"
        ? body.organizationId.trim()
        : ""

    const resend =
      body.resend === true

    if (!fullName) {
      return NextResponse.json(
        {
          error:
            "A full name is required.",
        },
        {
          status: 400,
        }
      )
    }

    if (!isValidEmail(email)) {
      return NextResponse.json(
        {
          error:
            "Enter a valid email address.",
        },
        {
          status: 400,
        }
      )
    }

    if (
      !ALLOWED_ROLES.includes(
        role as AllowedRole
      )
    ) {
      return NextResponse.json(
        {
          error:
            "The selected role is not allowed.",
        },
        {
          status: 400,
        }
      )
    }

    // Never trust organizationId supplied by the browser.
    if (
      requestedOrganizationId &&
      requestedOrganizationId !==
        callerProfile.organization_id
    ) {
      return NextResponse.json(
        {
          error:
            "You cannot invite users into another organization.",
        },
        {
          status: 403,
        }
      )
    }

    const organizationId =
      callerProfile.organization_id

    // Managers/directors cannot create administrators.
    if (
      role === "admin" &&
      !["owner", "admin"].includes(
        callerProfile.role
      )
    ) {
      return NextResponse.json(
        {
          error:
            "Only owners and administrators can create administrator accounts.",
        },
        {
          status: 403,
        }
      )
    }

    // =====================================================
    // 4. Check public.users for duplicate email
    // =====================================================

    const {
      data: existingPublicUsers,
      error:
        existingPublicUserError,
    } = await supabaseAdmin
      .from("users")
      .select(`
        id,
        email,
        full_name,
        organization_id,
        role,
        status
      `)
      .ilike("email", email)
      .limit(2)

    if (existingPublicUserError) {
      console.error(
        "Existing public user lookup error:",
        existingPublicUserError
      )

      return NextResponse.json(
        {
          error:
            "Unable to check whether this email is already in use.",
        },
        {
          status: 500,
        }
      )
    }

    /*
     * This should normally return zero or one row because
     * we created a case-insensitive unique email index.
     */
    const existingPublicUser =
      existingPublicUsers?.[0] || null

    if (existingPublicUser) {
      // -----------------------------------------------
      // Existing email belongs to another organization
      // -----------------------------------------------

      if (
        existingPublicUser.organization_id !==
        organizationId
      ) {
        return NextResponse.json(
          {
            error:
              "This email address is already tied to another ReJoyce account or organization. Use a different email address, or contact ReJoyce support if the user needs to be moved between organizations.",
            code: "EMAIL_ALREADY_IN_USE",
          },
          {
            status: 409,
          }
        )
      }

      // -----------------------------------------------
      // Existing user belongs to this organization
      // -----------------------------------------------

      if (!resend) {
        return NextResponse.json(
          {
            error:
              "A team member with this email already exists in your organization. Open their account from People to manage the user or resend their invitation.",
            code:
              "USER_ALREADY_IN_ORGANIZATION",
            user_id:
              existingPublicUser.id,
          },
          {
            status: 409,
          }
        )
      }

      /*
       * Resend path.
       *
       * We do not create a second public.users row.
       * We send another invitation/authentication email
       * to the existing user's address.
       */
      const resendResult =
        await resendExistingInvitation({
          userId:
            existingPublicUser.id,
          email,
          fullName:
            existingPublicUser.full_name ||
            fullName,
          role:
            existingPublicUser.role ||
            role,
          organizationId,
        })

      if (!resendResult.ok) {
        return NextResponse.json(
          {
            error:
              resendResult.error,
          },
          {
            status:
              resendResult.status,
          }
        )
      }

      return NextResponse.json(
        {
          user_id:
            existingPublicUser.id,
          email,
          role:
            existingPublicUser.role,
          invited: true,
          resent: true,
          message:
            "Invitation resent successfully.",
        },
        {
          status: 200,
        }
      )
    }

    // =====================================================
    // 5. Check Auth itself for an existing email
    //
    // This catches cases where an auth.user exists but a
    // public.users profile is missing or incomplete.
    // =====================================================

    const existingAuthUser =
      await findAuthUserByEmail(email)

    if (existingAuthUser) {
      /*
       * An Auth account exists but it did not appear in
       * public.users above.
       *
       * Do NOT silently attach this person to the caller's
       * organization. That could accidentally take over an
       * existing account.
       */
      return NextResponse.json(
        {
          error:
            "This email address is already tied to another ReJoyce login. The existing account cannot be automatically attached to your organization. Use another email address or contact ReJoyce support.",
          code:
            "AUTH_EMAIL_ALREADY_EXISTS",
        },
        {
          status: 409,
        }
      )
    }

    // =====================================================
    // 6. Invite brand-new Auth user
    // =====================================================

    const {
      data: inviteData,
      error: inviteError,
    } =
      await supabaseAdmin.auth.admin.inviteUserByEmail(
        email,
        {
          data: {
            full_name: fullName,
            role,
            organization_id:
              organizationId,
          },

          redirectTo: siteUrl
            ? `${siteUrl}/set-pin`
            : undefined,
        }
      )

    if (
      inviteError ||
      !inviteData.user
    ) {
      console.error(
        "Supabase new-user invite error:",
        inviteError
      )

      /*
       * Supabase may independently detect an existing
       * email. Convert that into a friendlier product
       * message instead of exposing raw Auth wording.
       */
      if (
        inviteError?.message
          ?.toLowerCase()
          .includes("already") ||
        inviteError?.message
          ?.toLowerCase()
          .includes("registered")
      ) {
        return NextResponse.json(
          {
            error:
              "This email address is already tied to another ReJoyce login. Use a different email address or contact ReJoyce support.",
            code:
              "EMAIL_ALREADY_IN_USE",
          },
          {
            status: 409,
          }
        )
      }

      return NextResponse.json(
        {
          error:
            inviteError?.message ||
            "Unable to send the invitation.",
        },
        {
          status: 400,
        }
      )
    }

    const invitedUserId =
      inviteData.user.id

    // =====================================================
    // 7. Guarantee the organization profile
    // =====================================================

    const {
      error: profileUpsertError,
    } = await supabaseAdmin
      .from("users")
      .upsert(
        {
          id: invitedUserId,
          email,
          full_name: fullName,
          role,
          organization_id:
            organizationId,

          /*
           * Keeping invited users active is compatible
           * with your current flow.
           *
           * Later we can make this "invited" until the
           * person accepts the invitation.
           */
          status: "active",
        },
        {
          onConflict: "id",
        }
      )

    if (profileUpsertError) {
      console.error(
        "Invited user profile upsert error:",
        profileUpsertError
      )

      return NextResponse.json(
        {
          error:
            "The login invitation was created, but the organization profile could not be completed.",
        },
        {
          status: 500,
        }
      )
    }

    // =====================================================
    // 8. Create default granular permissions
    // =====================================================

    const defaultPermissions = {
      user_id: invitedUserId,
      organization_id: organizationId,
      can_manage_users: false,
      can_manage_clients: false,
      can_manage_sessions: false,
      can_review_sessions: false,
      can_view_reports: false,
      can_manage_billing: false,
    }

    const {
      error: permissionError,
    } = await supabaseAdmin
      .from("user_permissions")
      .upsert(
        defaultPermissions,
        {
          onConflict: "user_id",
        }
      )

    if (permissionError) {
      /*
       * The invitation itself is still valid.
       * Log this so configuration can be corrected
       * without falsely telling the owner the invite
       * failed.
       */
      console.warn(
        "Default permissions were not created:",
        permissionError.message
      )
    }

    // =====================================================
    // 9. Success
    // =====================================================

    return NextResponse.json(
      {
        user_id: invitedUserId,
        email,
        role,
        invited: true,
        resent: false,
        message:
          "Team member invited successfully.",
      },
      {
        status: 200,
      }
    )
  } catch (error) {
    console.error(
      "Invite-user route error:",
      error
    )

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unexpected server error.",
      },
      {
        status: 500,
      }
    )
  }
}

/* =========================================================
   Helpers
   ========================================================= */

function isValidEmail(
  value: string
): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
    value
  )
}

async function findAuthUserByEmail(
  email: string
) {
  /*
   * Supabase Admin does not provide a simple
   * getUserByEmail() method in every client version,
   * so page through the Auth directory.
   *
   * This is acceptable for the MVP.
   * Later, account lookup can be moved behind a
   * dedicated system-admin function if necessary.
   */

  let page = 1
  const perPage = 1000

  while (page <= 10) {
    const {
      data,
      error,
    } =
      await supabaseAdmin.auth.admin.listUsers(
        {
          page,
          perPage,
        }
      )

    if (error) {
      console.error(
        "Auth email lookup error:",
        error
      )

      /*
       * We don't want an inability to inspect Auth to
       * accidentally allow a duplicate account.
       */
      throw new Error(
        "Unable to verify whether this email is already tied to a ReJoyce login."
      )
    }

    const match =
      data.users.find(
        (user) =>
          user.email
            ?.trim()
            .toLowerCase() === email
      )

    if (match) {
      return match
    }

    if (
      data.users.length < perPage
    ) {
      break
    }

    page += 1
  }

  return null
}

async function resendExistingInvitation({
  userId,
  email,
  fullName,
  role,
  organizationId,
}: {
  userId: string
  email: string
  fullName: string
  role: string
  organizationId: string
}): Promise<
  | {
      ok: true
    }
  | {
      ok: false
      error: string
      status: number
    }
> {
  try {
    /*
     * First verify that the Auth account really exists
     * and matches this public profile.
     */
    const {
      data: authUserData,
      error: authUserError,
    } =
      await supabaseAdmin.auth.admin.getUserById(
        userId
      )

    if (
      authUserError ||
      !authUserData.user
    ) {
      console.error(
        "Existing Auth user lookup failed:",
        authUserError
      )

      return {
        ok: false,
        status: 404,
        error:
          "The organization profile exists, but its login account could not be found. Contact ReJoyce support before creating another account with this email.",
      }
    }

    const authEmail =
      authUserData.user.email
        ?.trim()
        .toLowerCase()

    if (authEmail !== email) {
      return {
        ok: false,
        status: 409,
        error:
          "The account email does not match the authentication record. Contact ReJoyce support before resending the invitation.",
      }
    }

    /*
     * Supabase inviteUserByEmail may reject an address
     * that already represents an established user.
     *
     * Generate a recovery/magic-link style action
     * for the existing login instead.
     *
     * This lets the user re-enter the account setup
     * flow without attempting to create a duplicate
     * Auth account.
     */
    const {
      data: linkData,
      error: linkError,
    } =
      await supabaseAdmin.auth.admin.generateLink({
        type: "recovery",
        email,
        options: {
          redirectTo: siteUrl
            ? `${siteUrl}/set-pin`
            : undefined,
        },
      })

    if (linkError) {
      console.error(
        "Resend account link error:",
        linkError
      )

      return {
        ok: false,
        status: 400,
        error:
          "Unable to resend the account setup link.",
      }
    }

    /*
     * generateLink() generates the action link but does
     * not itself send your custom email.
     *
     * If your current Supabase email workflow already
     * sends recovery emails elsewhere, replace this
     * helper with that route.
     *
     * For now, try Supabase's password-reset email,
     * which sends through your configured Auth email
     * provider.
     */
    const userClient = createClient(
      supabaseUrl,
      process.env
        .NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    )

    const {
      error: resetError,
    } =
      await userClient.auth.resetPasswordForEmail(
        email,
        {
          redirectTo: siteUrl
            ? `${siteUrl}/set-pin`
            : undefined,
        }
      )

    if (resetError) {
      console.error(
        "Resend password/setup email error:",
        resetError
      )

      return {
        ok: false,
        status: 400,
        error:
          "The account exists, but ReJoyce could not send a new setup email.",
      }
    }

    /*
     * Keep the public profile synchronized. We don't
     * change organization ownership here.
     */
    const {
      error: profileError,
    } = await supabaseAdmin
      .from("users")
      .update({
        full_name: fullName,
        role,
        organization_id:
          organizationId,
      })
      .eq("id", userId)
      .eq(
        "organization_id",
        organizationId
      )

    if (profileError) {
      console.warn(
        "Profile refresh during resend failed:",
        profileError.message
      )
    }

    /*
     * linkData exists mainly as confirmation that Auth
     * could generate a valid action for the account.
     * Do not return its URL to the browser.
     */
    void linkData

    return {
      ok: true,
    }
  } catch (error) {
    console.error(
      "Resend invitation helper error:",
      error
    )

    return {
      ok: false,
      status: 500,
      error:
        error instanceof Error
          ? error.message
          : "Unable to resend the invitation.",
    }
  }
}