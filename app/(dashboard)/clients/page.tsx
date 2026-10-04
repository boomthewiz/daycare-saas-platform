import { redirect } from "next/navigation"

// Keep legacy client-list bookmarks on the existing People workspace.
export default function ClientsPage() {
  redirect("/team-management")
}
