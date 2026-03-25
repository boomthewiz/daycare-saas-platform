import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { createClient } from '@supabase/supabase-js'

export async function POST(req: Request) {
  const { email, daycareId, fullName } = await req.json()

  // 1️⃣ Invite user via Supabase Auth
  const { data: inviteData, error: inviteError } =
    await supabaseAdmin.auth.admin.inviteUserByEmail(email)

  if (inviteError) {
    return NextResponse.json({ error: inviteError.message }, { status: 400 })
  }

  const userId = inviteData.user?.id

  // 2️⃣ Insert into public.users table
  const { error: insertError } = await supabaseAdmin
    .from('users')
    .insert({
      id: userId,
      daycare_id: daycareId,
      full_name: fullName,
      role: 'teacher'
    })

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 400 })
  }

  return NextResponse.json({ success: true })
}