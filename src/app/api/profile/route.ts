import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '../../../lib/supabase/server'

const profileSchema = z.object({
  name: z.string().min(1).max(100),
  examDate: z.string().date().optional().nullable(),
  maxSessionMinutes: z.union([z.literal(30), z.literal(45), z.literal(60), z.literal(90)]).optional().nullable(),
  prepMode: z.enum(['coaching', 'self-study', 'both']).optional().nullable()
})

export async function GET() {
  const supabase = await createClient()
  const { data: authData, error: authError } = await supabase.auth.getUser()
  if (authError || !authData.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = authData.user.id

  const [profileRes, examRes] = await Promise.all([
    supabase.from('profiles').select('display_name, max_session_minutes, prep_mode').eq('id', userId).single(),
    supabase.from('exam_attempts').select('target_exam_date, provisional_weekly_minutes').eq('user_id', userId).eq('status', 'active').maybeSingle()
  ])

  if (profileRes.error) return NextResponse.json({ error: 'Failed to load profile' }, { status: 500 })
  
  return NextResponse.json({
    profile: {
      name: profileRes.data.display_name,
      maxSessionMinutes: profileRes.data.max_session_minutes,
      prepMode: profileRes.data.prep_mode,
      examDate: examRes.data?.target_exam_date || null,
      recommendedWeeklyMinutes: examRes.data?.provisional_weekly_minutes || null
    }
  })
}

export async function PUT(request: Request) {
  const parsed = profileSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid profile data.' }, { status: 400 })
  const input = parsed.data
  
  const supabase = await createClient()
  const { data: authData, error: authError } = await supabase.auth.getUser()
  if (authError || !authData.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = authData.user.id

  const profileUpdate = await supabase.from('profiles').update({
    display_name: input.name,
    max_session_minutes: input.maxSessionMinutes || null,
    prep_mode: input.prepMode || null,
    updated_at: new Date().toISOString()
  }).eq('id', userId)

  if (profileUpdate.error) {
    console.error('Profile update error:', profileUpdate.error)
    return NextResponse.json({ error: 'Failed to update profile.' }, { status: 500 })
  }

  if (input.examDate) {
    const examUpdate = await supabase.from('exam_attempts').update({
      target_exam_date: input.examDate,
      updated_at: new Date().toISOString()
    }).eq('user_id', userId).eq('status', 'active')

    if (examUpdate.error) {
      console.error('Exam attempt update error:', examUpdate.error)
    }
  }

  return NextResponse.json({ ok: true })
}
