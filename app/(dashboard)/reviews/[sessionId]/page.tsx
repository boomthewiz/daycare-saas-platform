"use client"
import { useParams } from 'next/navigation'
import SessionNoteWorkspace from '@/components/SessionNoteWorkspace'
export default function ReviewNotePage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  return <SessionNoteWorkspace key={sessionId} sessionId={sessionId} review />
}
