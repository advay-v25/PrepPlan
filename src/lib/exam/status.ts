import { createAdminClient } from '../supabase/admin'
import { todayInZone } from '../planning/studyWeek'
import { examPhase, type PhaseResult } from './finalStretch'
import { readAll } from '../supabase/readAll'
import { minuteOf, perRequest } from '../ops/perRequest'

export type ExamStatus = PhaseResult & {
  examDate: string | null; today: string; satOn: string | null
  version: number
  followUp: { reportedResult: string | null; psm: 'done' | 'not_done' | 'unsure' | null; retakeRequestedAt: string | null; retakeNote: string | null } | null
}

/** One reader for Home, Calendar, Coach, Settings and the exam page. */
async function loadExamStatusUncached(userId: string, now = new Date()): Promise<ExamStatus> {
  const admin = createAdminClient()
  const [{ data: p }, { data: c }] = await Promise.all([
    admin.from('profiles').select('exam_date, timezone, exam_window_id, onboarding_context_version').eq('id', userId).maybeSingle().throwOnError(),
    admin.from('exam_completion').select('sat_on, reported_result, psm_status, retake_requested_at, retake_note').eq('user_id', userId).maybeSingle().throwOnError(),
  ])
  const today = todayInZone((p?.timezone as string) || 'UTC', now)
  const { data: w } = p?.exam_window_id ? await admin.from('exam_windows').select('window_closes, is_confirmed').eq('id', p.exam_window_id as string).maybeSingle() : { data: null }
  const phase = examPhase({ today, examDate: (p?.exam_date ?? null) as string | null, satOn: (c?.sat_on ?? null) as string | null, windowCloses: (w?.window_closes ?? null) as string | null, windowConfirmed: (w?.is_confirmed ?? null) as boolean | null })
  return {
    ...phase, examDate: (p?.exam_date ?? null) as string | null, today, satOn: (c?.sat_on ?? null) as string | null,
    version: Number(p?.onboarding_context_version ?? 1),
    followUp: c ? { reportedResult: (c.reported_result ?? null) as string | null, psm: (c.psm_status ?? null) as 'done' | 'not_done' | 'unsure' | null, retakeRequestedAt: (c.retake_requested_at ?? null) as string | null, retakeNote: (c.retake_note ?? null) as string | null } : null,
  }
}

export const loadExamStatus = perRequest(loadExamStatusUncached, (userId, now) => `${userId}|${minuteOf(now)}`)

export async function listExamHistory(userId: string) {
  const admin = createAdminClient()
  return readAll((a, z) => admin.from('exam_completion_history').select('id, sat_on, reported_result, psm_status, new_exam_date')
    .eq('user_id', userId).order('archived_at', { ascending: false }).order('id').range(a, z))
}
