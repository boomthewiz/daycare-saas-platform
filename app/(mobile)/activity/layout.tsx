import WorkspaceLayout from "@/components/WorkspaceLayout"
export default function ActivityLayout({ children }: { children: React.ReactNode }) {
  return <WorkspaceLayout stickySidebar>{children}</WorkspaceLayout>
}
