import WorkspaceLayout from "@/components/WorkspaceLayout"

export default function MySessionsLayout({ children }: { children: React.ReactNode }) {
  return <WorkspaceLayout stickySidebar>{children}</WorkspaceLayout>
}
