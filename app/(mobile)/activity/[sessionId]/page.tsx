"use client"
import { useParams, useSearchParams } from "next/navigation"
import ActivityWorkspace from "@/components/ActivityWorkspace"
export default function ActivityPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const search = useSearchParams()
  return <ActivityWorkspace editing={search.get("edit")==="1"} key={sessionId} sessionId={sessionId} />
}
