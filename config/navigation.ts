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

import type { CapabilityKey } from "@/lib/effective-capabilities"

export type NavigationItem = {
  name: string
  href: string
  icon: typeof LayoutDashboard
  permission: CapabilityKey | null
}

export const navigationItems: NavigationItem[] = [
  { name: "Classes", href: "/classes", icon: Users, permission: "clients" },
  { name: "Attendance", href: "/attendance", icon: ClipboardCheck, permission: "attendance" },
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
    name: "Schedule",
    href: "/sessions",
    icon: CalendarDays,
    permission: "sessions",
  },

  {
    name: "Setup",
    href: "/setup",
    icon: Settings2,
    permission: null,
  },

  {
    name: "People",
    href: "/team-management",
    icon: Users,
    permission: "people",
  },

  {
    name: "Access Requests",
    href: "/access-requests",
    icon: Inbox,
    permission: "accessRequests",
  },

  {
    name: "Reviews",
    href: "/reviews",
    icon: ClipboardCheck,
    permission: "reviews",
  },

  {
    name: "Billing",
    href: "/billing",
    icon: CreditCard,
    permission: "billing",
  },

  {
    name: "Reports",
    href: "/reports",
    icon: BarChart3,
    permission: "reports",
  },

  {
    name: "Profile",
    href: "/profile",
    icon: UserRound,
    permission: null,
  },
]
