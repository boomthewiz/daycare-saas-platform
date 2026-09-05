import {
  LayoutDashboard,
  Settings2,
  CalendarDays,
  Users,
  Inbox,
  CreditCard,
  BarChart3,
  UserRound,
  ListChecks,
  ClipboardCheck,
} from "lucide-react"

export type PermissionKey =
  | "can_manage_billing"
  | "can_manage_access"
  | "can_manage_team"
  | "can_manage_operations"
  | "can_manage_clients"
  | "can_manage_sessions"
  | "can_review_sessions"
  | "can_view_reports"
  | "can_manage_settings"
  | "can_manage_users"

export type NavigationItem = {
  name: string
  href: string
  icon: typeof LayoutDashboard
  permission: PermissionKey | null
}

export const navigationItems: NavigationItem[] = [
  {
    name: "Home",
    href: "/dashboard",
    icon: LayoutDashboard,
    permission: null,
  },

  /*
   * Frontline users can see their own sessions.
   * Administrative users with can_manage_sessions will
   * also receive the administrative Sessions link below.
   */
  {
    name: "My Sessions",
    href: "/my-sessions",
    icon: CalendarDays,
    permission: null,
  },

  {
    name: "Tasks",
    href: "/tasks",
    icon: ListChecks,
    permission: null,
  },

  {
    name: "Sessions",
    href: "/sessions",
    icon: CalendarDays,
    permission: "can_manage_sessions",
  },

  {
    name: "Operations",
    href: "/operations",
    icon: Settings2,
    permission: "can_manage_operations",
  },

  {
    name: "Team",
    href: "/team-management",
    icon: Users,
    permission: "can_manage_team",
  },

  {
    name: "Access Requests",
    href: "/access-requests",
    icon: Inbox,
    permission: "can_manage_access",
  },

  {
    name: "Reviews",
    href: "/reviews",
    icon: ClipboardCheck,
    permission: "can_review_sessions",
  },

  {
    name: "Billing",
    href: "/billing",
    icon: CreditCard,
    permission: "can_manage_billing",
  },

  {
    name: "Reports",
    href: "/reports",
    icon: BarChart3,
    permission: "can_view_reports",
  },

  {
    name: "Profile",
    href: "/profile",
    icon: UserRound,
    permission: null,
  },
]