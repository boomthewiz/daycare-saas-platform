"use client"
import { useParams } from "next/navigation"
import ActivityWorkspace from "@/components/ActivityWorkspace"
export default function ActivityPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  return <ActivityWorkspace key={sessionId} sessionId={sessionId} />
}
