import { buildRoadmap } from '../curriculum/roadmap'
import { getActiveRoadmap, loadRoadmapInputs } from '../curriculum/roadmapService'
import { buildCommitRows, buildWeekPlanWithPaper } from '../planning/pulse/generateWeek'
import { weekForDate } from '../planning/schedule'
import { addDays, todayInZone } from '../planning/studyWeek'
import { createAdminClient } from '../supabase/admin'
import type { ExamStatus } from './status'

export type RetakePreview = {
  draftId: string; revision: number; satOn: string; examDate: string; week: { start: string; end: string }
  keepsWeek: boolean; sessions: { id: string; date: string | null; title: string; minutes: number }[]
  paper: 'paper' | 'none'
}

export async function prepareRetake(userId: string, status: ExamStatus, now = new Date()) {
  if (!status.satOn) return { ok: false as const, code: 'NOT_SAT' }
  if (!status.followUp?.retakeRequestedAt) return { ok: false as const, code: 'NO_RETAKE_REQUEST' }
  if (!status.examDate || status.examDate <= status.satOn || status.examDate < status.today) return { ok: false as const, code: 'NO_NEW_SITTING' }

  const admin = createAdminClient()
  const [{ data: cycle }, { data: profile }] = await Promise.all([
    admin.from('planning_cycles').select('id, starts_at_local, ends_at_local').eq('user_id', userId).eq('status', 'active').maybeSingle().throwOnError(),
    admin.from('profiles').select('exam_date, onboarding_context_version, timezone').eq('id', userId).single().throwOnError(),
  ])
  const fingerprint = async () => (await admin.rpc('current_week_source_hash', { p_user: userId, p_cycle: cycle?.id ?? null }).throwOnError()).data as string
  const before = await fingerprint()
  if (profile?.exam_date !== status.examDate || profile.onboarding_context_version !== status.version) return { ok: false as const, code: 'STALE_RETAKE' }
  const today = todayInZone(profile.timezone ?? 'UTC', now)
  const keepsWeek = Boolean(cycle && cycle.ends_at_local >= today)
  const { data: latest } = await admin.from('planning_cycles').select('ends_at_local').eq('user_id', userId)
    .order('ends_at_local', { ascending: false }).limit(1).maybeSingle().throwOnError()
  const newStart = latest?.ends_at_local && latest.ends_at_local >= today ? addDays(latest.ends_at_local, 1) : today
  const week = await weekForDate(userId, keepsWeek ? cycle!.starts_at_local : newStart)
  const existing = await getActiveRoadmap(userId)
  const input = existing?.input ?? await loadRoadmapInputs(userId)
  if (!input) throw new Error('Could not read your study plan.')
  const adjusted = { ...input, startDate: keepsWeek ? week.startDate : newStart, targetDate: status.examDate, targetKind: 'booked' as const }
  const roadmap = buildRoadmap(adjusted)
  const firstDay = keepsWeek ? week.startDate : newStart
  const newWeek = { ...week, startDate: firstDay, days: week.days.filter(day => day >= firstDay) }
  const plan = keepsWeek ? null : await buildWeekPlanWithPaper(userId, newWeek, {
    now, closingCycleId: cycle?.id,
    roadmap: { id: existing?.id ?? '', status: 'active', roadmap, input: adjusted },
  })
  const rows = plan ? await buildCommitRows(userId, newWeek, plan.days) : []
  const kept: { id: string; local_date: string | null; title: string; duration_minutes: number; task_type: string }[] = keepsWeek
    ? (await admin.from('plan_blocks').select('id, local_date, title, duration_minutes, task_type')
      .eq('user_id', userId).eq('cycle_id', cycle!.id).is('cancelled_at', null).in('execution', ['not_started', 'in_progress', 'deferred'])
      .or(`local_date.is.null,local_date.gte.${today}`).order('local_date').order('id').throwOnError()).data ?? []
    : []
  const sessions = (keepsWeek ? kept : rows).map(row => ({
    id: row.id as string, date: row.local_date as string | null, title: row.title as string, minutes: Number(row.duration_minutes ?? 0),
  }))
  if (await fingerprint() !== before) return { ok: false as const, code: 'STALE_RETAKE' }
  const { data: draft } = await admin.from('plan_drafts').insert({
    user_id: userId, purpose: 'exam_retake', status: 'ready', revision: 1, cycle_id: cycle?.id ?? null,
    roadmap_id: existing?.id ?? null, onboarding_context_version: status.version, context_fingerprint: before,
    cycle_start_date: firstDay, cycle_end_date: week.endDate, timezone: week.timezone,
    draft_json: {
      satOn: status.satOn, examDate: status.examDate, today, keepsWeek, anchorDay: week.anchorDay, rows,
      roadmap: { route: adjusted.route, inputs: adjusted, phases: roadmap.phases, feasibility: roadmap.feasibility },
    },
  }).select('id, revision').single().throwOnError()
  const preview: RetakePreview = {
    draftId: draft!.id, revision: draft!.revision, satOn: status.satOn, examDate: status.examDate,
    week: { start: firstDay, end: week.endDate }, keepsWeek, sessions,
    paper: plan?.paper.kind === 'paper' || kept.some(row => row.task_type === 'diagnostic') ? 'paper' : 'none',
  }
  return { ok: true as const, preview }
}
