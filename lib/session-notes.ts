export type NoteStatus = 'draft' | 'submitted' | 'returned' | 'approved' | 'locked'
export type NoteAction = 'save' | 'submit' | 'return' | 'approve' | 'lock' | 'revert_approval' | 'unlock'
export type SessionNote = {
  id: string; session_id: string; author_id: string | null; status: NoteStatus; version: number
  final_note: string | null; generated_note: string | null; therapist_addendum: string | null
  review_notes: string | null; created_at: string; updated_at: string
  submitted_at: string | null; reviewed_at: string | null; locked_at: string | null
  locked_from_status: 'submitted' | 'approved' | null
}

/** UI affordances only; every action is independently authorized in Postgres. */
export function noteActions(note: SessionNote | null, context: {
  userId: string; providerId: string | null; frontline: boolean; reviewer: boolean; admin: boolean; sessionStatus: string
}): NoteAction[] {
  const actions: NoteAction[] = []
  if (context.frontline && context.providerId === context.userId &&
      ['in_progress', 'paused', 'completed'].includes(context.sessionStatus) &&
      (!note || (note.author_id === context.userId && ['draft', 'returned'].includes(note.status)))) {
    actions.push('save')
    if (context.sessionStatus === 'completed') actions.push('submit')
  }
  if (context.reviewer && note?.status === 'submitted') actions.push('return', 'approve', 'lock')
  if (context.reviewer && note?.status === 'approved') actions.push('lock')
  if (context.admin && note?.status === 'approved') actions.push('revert_approval')
  if (context.admin && note?.status === 'locked') actions.push('unlock')
  return actions
}

export function noteFailure(error: unknown): string {
  const failure = error as { code?: string; message?: string }
  if (failure?.code === '40001') return 'Someone changed this note. Your text is still here. Copy any unsaved text, then reload before making another change.'
  if (failure?.code === '42501') return 'Your access may have changed or your device may be locked. Unlock or sign in again, then reload. Your unsaved text is still here.'
  return failure?.message || 'The request could not be confirmed. Your text is still here. Retry the same request to check its outcome safely.'
}
