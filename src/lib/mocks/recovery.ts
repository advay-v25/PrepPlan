import { activeCycleId } from '../ops/sharedReads'
import { formatStudyDate } from '../format/date'
import { createHash } from 'node:crypto'
import { createAdminClient } from '../supabase/admin'
import { readAll } from '../supabase/readAll'
import { addDays, todayInZone } from '../planning/studyWeek'
import { roomOfDay } from '../planning/classlog/service'
import { FLOOR_TASK_MINUTES, sittingCeiling } from '../planning/classlog/consolidation'
import type { MockReport, RecoverySelection, SelectionItem } from './report'
import { describeScore } from './report'
import { taskTimes, type TimeEvent } from '../state/reportedTime'
import { recoveryItemState, recoveryItemKey, type ItemState, type ItemStatus, type Occurrence } from './recoveryProgress'
import { calendarTaskHref } from '../routing/calendar'
export type { ItemState, ItemStatus } from './recoveryProgress'
import { ReportError, validKey } from './reportService'

/**
 * Recovery proposal (deterministic; no model owns feasibility or mutations). The student SELECTS what to work on after the debrief; this places those
 * selections as whole sittings inside the real remaining contiguous room of the open week, shows what does not fit, and never moves or removes accepted
 * work. Acceptance is one command (accept_mock_recovery) that re-checks the room, the sitting limit, the report version and source identity.
 */
export type RecoveryTask = {
  id: string; sourceKey: string; date: string; minutes: number; title: string; taskType: 'study' | 'review'; outcomeId: string | null; readingId: string | null
  objective: string; rationale: string; approach: string; completion: string; verification: string; reference: string; itemKey: string
}
export type RecoveryPreview =
  | { ok: false; code: string; message: string }
  | { ok: true; fingerprint: string; reportId: string; reportVersion: number; cycleId: string; maxSitting: number; today: string; cycleEnds: string; runway: { daysToExam: number | null; note: string }
      lastStudyDay: string | null; narrowing: { daysLeft: number; tradeoffs: string[] } | null; wouldDrop: { itemKey: string; label: string; minutes: number }[]
      placed: RecoveryTask[]; alreadyPlanned: { itemKey: string; title: string; status: ItemStatus; note: string; href?: string }[]; remainder: { itemKey: string; title: string; minutes: number; reason: string }[]; displaced: never[]; usableMinutes: number; sourceToken: string }

/** Where one chosen item stands across ALL weeks. `unfinished` = its sitting ended in a closed week without being finished or continued, so the rest is offered again. */

/** What the time left changes (messaging and trade-offs only; no invented workload ratios, no compulsory mocks). */
export function runwayNote(daysToExam: number | null): string {
  if (daysToExam === null) return 'No exam date is set, so this is planned only around your open week. Set it in your exam details if you want it to account for the time left.'
  if (daysToExam <= 7) return 'This is the final week: consolidate what keeps going wrong and keep your existing commitments. Nothing here adds a full mock, and no result is predicted.'
  if (daysToExam <= 14) return 'About two weeks remain: priorities are narrowed to what you chose, anything that does not fit is shown rather than squeezed in, and any check should be proportionate to the time left.'
  if (daysToExam <= 56) return 'Within the final eight weeks: targeted reference review is fine, a new whole-syllabus first pass is not what this proposes. Your mocks and revision stay as planned.'
  return 'Several months remain: targeted review plus spaced maintenance and the mocks you choose. This does not restart a first pass.'
}

const MIN_DEFAULT = 30
export const defaultMinutes = (limit: number) => Math.min(limit, MIN_DEFAULT)

const dateLabel = (d: string) => formatStudyDate(d, 'fullDate')

function textFor(item: SelectionItem, r: MockReport, ctx: { readingNo?: number; readingTitle?: string; outcomeTitle?: string; subject?: string; reportedTopic?: string | null }) {
  const from = `your ${dateLabel(r.takenOn)} mock${r.provider ? ` (${r.provider})` : ''}`
  const reportNote = `Planned from ${from}, which is your own report, not test evidence.`
  if (item.kind === 'pacing') return {
    title: 'Pacing and application practice', objective: `Practise working to time on material you already know, and find where the time goes.`,
    rationale: `${reportNote} You reported running short of time or rushing. That does not mean the concepts were not understood.`,
    approach: 'Choose a short set of questions from your own materials on topics you already know. Give each question a time, stop when it is up, and note where time went: reading, calculating or deciding. Do not look anything up while the clock runs.',
    completion: 'Done when you have worked the set to time and written where the time went. If you only got part of the way, record it as partly done with the minutes you actually spent.',
    verification: 'A later timed practice or a later mock report can show whether timing changed. Your own timing notes are not test evidence.', reference: 'Your own practice questions',
  }
  if (item.kind === 'answer_change') return {
    title: 'Review answer changes', objective: 'Notice when and why you change an answer, and whether the changes helped.',
    rationale: `${reportNote} You reported changing right answers to wrong ones. One mock does not show a pattern, and there is no rule against changing answers.`,
    approach: 'On a set of practice questions from your own materials, note your first answer and how sure you were. When you change one, write the reason. Afterwards count the changes that helped and the ones that hurt.',
    completion: 'Done when you have the list of changes with reasons and the count. Record partly done honestly with the minutes you spent.',
    verification: 'A later mock report or practice set can show whether it changed. Your notes are your own record, not test evidence.', reference: 'Your own practice questions',
  }
  const target = ctx.outcomeTitle ? `${ctx.outcomeTitle} (Reading ${ctx.readingNo}: ${ctx.readingTitle})` : `Reading ${ctx.readingNo}: ${ctx.readingTitle}`
  return {
    title: `Targeted review: ${ctx.outcomeTitle ?? ctx.readingTitle}`, objective: `Review ${target}${ctx.subject ? ` (${ctx.subject})` : ''}: recall it, check the gaps and note what is still unclear.`,
    rationale: `${reportNote} You chose this${ctx.reportedTopic ? ` because you reported ${ctx.reportedTopic}` : ''}. It is a planning choice, not a finding that you do not understand it.`,
    approach: 'Close your notes and write down everything you can recall about this in your own words. Then check against your own notes or the matching section of your book, mark what you missed, and list anything still unclear.',
    completion: 'Done when you have recalled it, checked it and listed the gaps. If you only got part of the way, record it as partly done with the minutes you actually spent.',
    verification: 'A later weekly paper can test this once you confirm what you covered, if enough approved questions exist. Doing the review does not itself show that you understand it, and your reported mock result closes nothing.', reference: ctx.readingNo ? `Reading ${ctx.readingNo}: ${ctx.readingTitle}` : 'Your own materials',
  }
}

const baseKey = recoveryItemKey

/**
 * Logical state of every chosen item, read across every cycle. A continuation replaces the occurrence it continues for logical effort (the same lineage rule
 * every other reader uses), so a chain counts once; time the student reported stays per occurrence and is only ever added, never inferred.
 */
export async function loadItemStates(userId: string, report: MockReport, currentCycleId: string | null): Promise<{ states: Map<string, ItemState>; rows: Occurrence[]; usedKeys: Set<string> }> {
  const admin = createAdminClient()
  const rows = await readAll<Occurrence>((a, z) => admin.from('plan_blocks').select('id, cycle_id, source_key, execution, cancelled_at, duration_minutes, continued_from_task_id, local_date, title, outcome_id, lm_id')
    .eq('user_id', userId).eq('source_report_id', report.id).order('id').range(a, z))
  const events: TimeEvent[] = []
  for (let i = 0; i < rows.length; i += 100) {
    const ids = rows.slice(i, i + 100).map(r => r.id)
    events.push(...await readAll<TimeEvent>((a, z) => admin.from('task_events').select('id, task_id, event_type, actual_duration_minutes, created_at, payload').eq('user_id', userId).in('task_id', ids).order('created_at').order('id').range(a, z)))
  }
  const times = taskTimes(events)
  const states = new Map<string, ItemState>()
  for (const item of report.planSelection?.items ?? []) {
    states.set(item.key, recoveryItemState(item, rows, times, currentCycleId))
  }
  return { states, rows, usedKeys: new Set(rows.map(r => r.source_key)) }
}

const STATUS_NOTE: Record<Exclude<ItemStatus, 'none' | 'unfinished'>, (w: string | null) => string> = {
  planned: w => `Already planned${w ? ` for ${w}` : ' this week'} (not duplicated).`,
  continues: w => `Continues this week from an earlier week${w ? ` (${w})` : ''}; its earlier time stays with that week (not duplicated).`,
  completed: w => `Completed previously${w ? ` (${w})` : ''}; not planned again.`,
  needs_review: () => 'Completion has not been confirmed. Reported time is not proof that the activity is done. Review its history, or deselect it and explicitly remove it from follow-up if nothing remains.',
}

const itemLabel = (i: SelectionItem, rd?: { no: number; title: string }) => i.kind === 'pacing' ? 'Pacing and application practice' : i.kind === 'answer_change' ? 'Review answer changes' : `Targeted review${rd ? `: Reading ${rd.no}, ${rd.title}` : ''}`

async function studyHorizon(userId: string): Promise<{ state: 'open' | 'sat' | 'none'; last: string | null; kind: 'booked' | 'sitting' | null; target: string | null }> {
  const { data, error } = await createAdminClient().rpc('mock_recovery_horizon', { p_user: userId })
  if (error || !data) throw new ReportError('Your exam details could not be read. Nothing was changed; try again.', 'HORIZON_UNAVAILABLE', 503)
  return data as any
}

export async function previewRecovery(userId: string, report: MockReport, selection: RecoverySelection, now = new Date()): Promise<RecoveryPreview> {
  const admin = createAdminClient()
  if (report.status !== 'active') return { ok: false, code: 'withdrawn', message: 'That report was withdrawn.' }
  const [{ data: cycle }, { data: profile }, horizon] = await Promise.all([
    admin.from('planning_cycles').select('id, starts_at_local, ends_at_local, timezone').eq('user_id', userId).eq('status', 'active').maybeSingle().throwOnError(),
    admin.from('profiles').select('max_session_minutes, timezone').eq('id', userId).maybeSingle().throwOnError(),
    studyHorizon(userId),
  ])
  if (horizon.state === 'sat') return { ok: false, code: 'exam_sat', message: 'You have marked your exam as sat, so no new study is planned. This report and its history stay available.' }
  if (!cycle) return { ok: false, code: 'no_cycle', message: 'There is no open week yet. Prepare your week in Calendar first, then come back to this report.' }
  const readToken = async () => {
    const r = await admin.rpc('current_week_source_hash', { p_user: userId, p_cycle: cycle.id })
    if (r.error || typeof r.data !== 'string') throw new ReportError('Your week could not be checked. Try again.', 'SOURCE_UNAVAILABLE', 503)
    return r.data
  }
  const sourceToken = await readToken()
  const tz = (cycle.timezone as string | null) ?? (profile?.timezone as string | null) ?? 'UTC'
  const today = todayInZone(tz, now), ends = cycle.ends_at_local as string, starts = cycle.starts_at_local as string
  const limit = sittingCeiling((profile?.max_session_minutes as number | null) ?? null)
  const daysToExam = horizon.target ? Math.round((Date.parse(`${horizon.target}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000) : null

  // Validate the selection against the real catalog (nothing is trusted from the client). Readings of choices dropped from the saved list are read too, for honest wording.
  const stored = report.planSelection?.items ?? []
  const readingIds = [...new Set([...selection.items, ...stored].flatMap(i => i.readingId ? [i.readingId] : []))], outcomeIds = [...new Set(selection.items.flatMap(i => i.outcomeId ? [i.outcomeId] : []))]
  const readings = new Map<string, { no: number; title: string; topic: string }>(), outcomes = new Map<string, { title: string; reading: string }>()
  if (readingIds.length) for (const r of await readAll<any>((a, z) => admin.from('curriculum_readings').select('id, reading_no, title, topic_id').in('id', readingIds).eq('is_active', true).order('id').range(a, z))) readings.set(r.id, { no: r.reading_no, title: r.title, topic: r.topic_id })
  if (outcomeIds.length) for (const o of await readAll<any>((a, z) => admin.from('reading_los').select('id, reading_id, title').in('id', outcomeIds).order('id').range(a, z))) outcomes.set(o.id, { title: o.title, reading: o.reading_id })
  const topics = new Map<string, string>(); for (const t of await readAll<any>((a, z) => admin.from('topics').select('id, name').order('id').range(a, z))) topics.set(t.id, t.name)
  const seen = new Set<string>()
  for (const i of selection.items) {
    const okKind = ['review', 'pacing', 'answer_change'].includes(i.kind)
    const okMin = Number.isInteger(i.minutes) && i.minutes >= Math.max(FLOOR_TASK_MINUTES, 10) && i.minutes <= limit && i.minutes % 5 === 0
    const okRef = i.kind !== 'review' || (!!i.readingId && readings.has(i.readingId) && (!i.outcomeId || outcomes.get(i.outcomeId)?.reading === i.readingId))
    if (!okKind || !okMin || !okRef || !/^[a-z0-9:_-]{1,80}$/.test(i.key) || seen.has(i.key)) return { ok: false, code: 'bad_selection', message: 'One of the chosen items is not valid, or is longer than your sitting limit.' }
    seen.add(i.key)
  }
  if (selection.items.length === 0 && stored.length === 0) return { ok: false, code: 'empty', message: 'Choose at least one thing to work on.' }
  if (selection.items.length > 30) return { ok: false, code: 'bad_selection', message: 'That is more than one week can hold. Choose fewer items.' }

  // Existing work: identity, never titles, across EVERY week of this report plus equivalent work already in this week.
  const open = await readAll<any>((a, z) => admin.from('plan_blocks').select('id, title, local_date, duration_minutes, execution, cancelled_at, placement, starts_at, outcome_id, lm_id, concept_id, repair_thread_id, task_type, source_report_id, source_key, learning_activity_id')
    .eq('user_id', userId).gte('local_date', today).lt('local_date', ends).is('cancelled_at', null).order('id').range(a, z))
  const live = open.filter(t => !['completed', 'skipped', 'cancelled'].includes(t.execution) && !t.learning_activity_id)
  const { states, rows: own, usedKeys } = await loadItemStates(userId, { ...report, planSelection: { items: [...selection.items, ...stored.filter(s => !selection.items.some(i => i.key === s.key))] } }, cycle.id as string)
  // Work is on the same reading whether it names the reading, one of its outcomes, or (repair work) a concept that maps to one of them.
  const readingOfOutcome = new Map<string, string>(), outcomesOfConcept = new Map<string, string[]>()
  if (readingIds.length) for (const o of await readAll<any>((a, z) => admin.from('reading_los').select('id, reading_id').in('reading_id', readingIds).order('id').range(a, z))) readingOfOutcome.set(o.id, o.reading_id)
  // Repair work carried into a later week names only its thread; the thread names the concept.
  const threadIds = [...new Set(live.flatMap(t => !t.concept_id && t.repair_thread_id ? [t.repair_thread_id as string] : []))], conceptOfThread = new Map<string, string>()
  if (threadIds.length) for (const r of await readAll<any>((a, z) => admin.from('repair_threads').select('id, concept_id').eq('user_id', userId).in('id', threadIds).order('id').range(a, z))) conceptOfThread.set(r.id, r.concept_id)
  for (const t of live) if (!t.concept_id && t.repair_thread_id) t.concept_id = conceptOfThread.get(t.repair_thread_id) ?? null
  const conceptIds = [...new Set(live.flatMap(t => t.concept_id ? [t.concept_id as string] : []))]
  for (let k = 0; k < conceptIds.length; k += 100) for (const m of await readAll<any>((a, z) => admin.from('concept_outcome_map').select('concept_id, outcome_id').in('concept_id', conceptIds.slice(k, k + 100)).order('concept_id').order('outcome_id').range(a, z))) outcomesOfConcept.set(m.concept_id, [...(outcomesOfConcept.get(m.concept_id) ?? []), m.outcome_id])
  const related = (i: SelectionItem, t: { outcome_id: string | null; lm_id: string | null; concept_id?: string | null }) => {
    if (i.kind !== 'review') return false
    const outs = [...(t.outcome_id ? [t.outcome_id] : []), ...(t.concept_id ? outcomesOfConcept.get(t.concept_id) ?? [] : [])]
    if (i.outcomeId) return outs.includes(i.outcomeId) || (outs.length === 0 && t.lm_id === i.readingId)
    return t.lm_id === i.readingId || outs.some(o => readingOfOutcome.get(o) === i.readingId)
  }
  const elsewhere = (i: SelectionItem) => live.find(t => ['study', 'review', 'repair', 'recheck', 'class_consolidation'].includes(t.task_type) && related(i, t) && t.source_report_id !== report.id)
  const sibling = (i: SelectionItem) => own.find(t => !t.cancelled_at && t.execution !== 'cancelled' && baseKey(t.source_key) !== i.key && related(i, t) && ['planned', 'continues', 'completed'].includes(states.get(baseKey(t.source_key))?.status ?? ''))
  const reportedTopic = (topicId?: string) => { const t = report.topics.find(x => x.topicId === topicId); return t ? `${topics.get(t.topicId) ?? 'that subject'} ${t.scale === 'percent' ? `${t.value}%` : t.scale === 'marks' ? `${t.value}/${t.max} marks` : t.scale === 'percentile' ? `${t.value}th percentile` : String(t.value)}` : null }

  const first = today > starts ? today : starts
  const lastDay = horizon.last && horizon.last < ends ? addDays(horizon.last, 1) : ends     // exclusive bound: never past the last study day
  const days: { date: string; gaps: number[] }[] = []
  for (let d = first; d < lastDay; d = addDays(d, 1)) days.push({ date: d, gaps: await roomOfDay(userId, d, tz, now, open.filter(t => t.local_date === d)) })
  const usableMinutes = days.reduce((n, d) => n + d.gaps.reduce((s, g) => s + g, 0), 0)

  const placed: RecoveryTask[] = [], alreadyPlanned: { itemKey: string; title: string; status: ItemStatus; note: string; href?: string }[] = [], remainder: { itemKey: string; title: string; minutes: number; reason: string }[] = []
  const perDay = new Map<string, number>()
  const used = new Set(usedKeys)
  const nextN = (itemKey: string) => { let n = 1; while (used.has(`${itemKey}:${n}`)) n++; used.add(`${itemKey}:${n}`); return n }
  for (const i of selection.items) {
    const rd = i.readingId ? readings.get(i.readingId) : undefined, oc = i.outcomeId ? outcomes.get(i.outcomeId) : undefined
    const txt = textFor(i, report, { readingNo: rd?.no, readingTitle: rd?.title, outcomeTitle: oc?.title, subject: rd ? topics.get(rd.topic) : undefined, reportedTopic: reportedTopic(rd?.topic) })
    const st = states.get(i.key)!
    if (st.status === 'planned' || st.status === 'continues' || st.status === 'completed' || st.status === 'needs_review') {
      alreadyPlanned.push({ itemKey: i.key, title: txt.title, status: st.status, note: STATUS_NOTE[st.status](st.where) + (i.minutes !== st.allocated && st.allocated > 0 ? ` You now chose ${i.minutes} minutes; the existing sitting is kept as it is.` : ''), href: st.taskId ? calendarTaskHref(st.taskId, st.where ?? undefined) : undefined })
      continue
    }
    const sib = sibling(i), other = elsewhere(i)
    if (sib || other) {
      const w = sib ? sib.title : other.title, d = sib ? sib.local_date : other.local_date, type = sib ? 'study' : other.task_type
      alreadyPlanned.push({ itemKey: i.key, title: txt.title, status: 'planned', note: `Already covered by "${w}"${d ? ` on ${d}` : ''}, so this is not added again.${type === 'repair' || type === 'recheck' ? ' That is a repair from your own scored answers; it stays open until its own check, and this report does not close it.' : ''}` })
      continue
    }
    const minutes = st.status === 'unfinished' ? st.remaining : i.minutes
    // one whole sitting, on the earliest day (spreading across the week) whose largest remaining gap holds it
    let spot: { d: typeof days[number]; gi: number } | null = null
    for (const d of [...days].sort((a, b) => (perDay.get(a.date) ?? 0) - (perDay.get(b.date) ?? 0) || a.date.localeCompare(b.date))) {
      const gi = d.gaps.findIndex(g => g >= minutes)
      if (gi >= 0) { spot = { d, gi }; break }
    }
    const title = st.status === 'unfinished' ? `${txt.title}` : txt.title
    if (!spot) {
      const cut = horizon.last && horizon.last < ends ? ` before your last study day (${horizon.last})` : ''
      remainder.push({ itemKey: i.key, title, minutes, reason: usableMinutes === 0 ? `There is no study time left in this open week${cut}.` : `No single free gap of ${minutes} minutes is left this week${cut}.` }); continue
    }
    spot.d.gaps[spot.gi] -= minutes; spot.d.gaps = spot.d.gaps.filter(g => g > 0).sort((a, b) => b - a); perDay.set(spot.d.date, (perDay.get(spot.d.date) ?? 0) + 1)
    const n = nextN(i.key), sourceKey = `${i.key}:${n}`
    placed.push({ id: '', sourceKey, date: spot.d.date, minutes, title: st.status === 'unfinished' ? `${title} (the rest)` : title, taskType: i.kind === 'review' ? 'study' : 'review', outcomeId: i.outcomeId ?? null, readingId: i.readingId ?? null,
      objective: txt.objective, rationale: st.status === 'unfinished' ? `${txt.rationale} You already reported ${st.reported} minutes on it earlier, so this is only the rest.` : txt.rationale, approach: txt.approach, completion: txt.completion, verification: txt.verification, reference: txt.reference, itemKey: i.key })
  }
  placed.sort((a, b) => a.date.localeCompare(b.date) || a.sourceKey.localeCompare(b.sourceKey))

  // Choices recorded earlier that this selection leaves out: dropping unfinished work must be explicit.
  const wouldDrop = stored.filter(o => !selection.items.some(i => i.key === o.key))
    .map(o => ({ itemKey: o.key, label: itemLabel(o, o.readingId ? readings.get(o.readingId) : undefined), minutes: states.get(o.key)?.remaining || o.minutes }))
  const narrowing = daysToExam !== null && daysToExam <= 14 ? { daysLeft: daysToExam, tradeoffs: [
    `${placed.length} of the ${placed.length + remainder.length} sittings you still need fit before your last study day${horizon.last ? ` (${horizon.last})` : ''}${remainder.length ? `; ${remainder.map(r => r.title).join('; ')} ${remainder.length === 1 ? 'does' : 'do'} not, and ${remainder.length === 1 ? 'is' : 'are'} kept rather than squeezed in` : ''}.`,
    'Nothing already planned or committed was moved to make room, and no mock was added.',
  ] } : null
  if (await readToken() !== sourceToken) return { ok: false, code: 'preview_changed', message: 'Your week changed while the preview was prepared. Try again; nothing was changed.' }
  const fingerprint = createHash('sha256').update(JSON.stringify({ r: report.id, v: report.version, c: cycle.id, s: sourceToken, e: ends, l: limit, h: [horizon.state, horizon.last, horizon.kind], n: runwayNote(daysToExam), t: narrowing?.tradeoffs ?? null,
    p: placed.map(t => [t.sourceKey, t.date, t.minutes, t.outcomeId, t.readingId]), a: alreadyPlanned.map(x => [x.itemKey, x.status]), m: remainder.map(x => [x.itemKey, x.minutes]), d: wouldDrop.map(x => x.itemKey) })).digest('hex').slice(0, 24)
  void describeScore
  return { ok: true, fingerprint, reportId: report.id, reportVersion: report.version, cycleId: cycle.id as string, maxSitting: limit, today, cycleEnds: ends, runway: { daysToExam, note: runwayNote(daysToExam) },
    lastStudyDay: horizon.last, narrowing, wouldDrop, placed, alreadyPlanned, remainder, displaced: [], usableMinutes, sourceToken }
}

/**
 * One explicit acceptance. The key is bound to its request in the database (report version + selection + confirmed removals): an exact retry returns the original
 * receipt even after a later edit, clock or cycle change; the same key with anything different is refused with nothing written.
 */
export async function acceptRecovery(userId: string, report: MockReport, a: { key: string; selection: RecoverySelection; fingerprint: string; reportVersion?: number; confirmRemove?: string[] }, now = new Date()): Promise<{ replayed: boolean; taskIds: string[]; placed: number }> {
  if (!validKey(a.key)) throw new ReportError('Missing or invalid request key.', 'INVALID', 400)
  const admin = createAdminClient()
  const version = a.reportVersion ?? report.version
  const confirm = [...new Set(a.confirmRemove ?? [])].sort()
  const sel = { items: a.selection.items, remove: confirm }
  const hash = await admin.rpc('mock_recovery_hash', { p_version: version, p_selection: sel })
  if (hash.error || typeof hash.data !== 'string') throw new ReportError('Save not confirmed. Nothing was partly applied; send it again with the same request, or check Calendar first.', 'SAVE_UNCONFIRMED', 503)
  const prior = await admin.rpc('mock_command_replay', { p_user: userId, p_key: a.key, p_command: 'accept_recovery', p_report: report.id, p_hash: hash.data })
  if (prior.error) throw new ReportError('Save not confirmed. Nothing was partly applied; send it again with the same request, or check Calendar first.', 'SAVE_UNCONFIRMED', 503)
  const pr = prior.data as any
  if (pr) {
    if (pr.ok === true) return { replayed: true, taskIds: pr.taskIds ?? [], placed: pr.tasks ?? 0 }
    throw new ReportError('That retry does not match the request it was started with. Nothing was changed.', 'KEY_REUSED', 409)
  }
  if (report.version !== version) throw new ReportError('The mock report changed since you reviewed the plan. Review the updated plan; nothing was changed.', 'preview_changed', 409)
  const p = await previewRecovery(userId, report, a.selection, now)
  if (!p.ok) throw new ReportError(p.message, p.code, 409)
  if (p.fingerprint !== a.fingerprint) throw new ReportError('Your week, your exam dates or this report changed since you reviewed the plan. Review the updated plan; nothing was changed.', 'preview_changed', 409)
  const unconfirmed = p.wouldDrop.filter(d => !confirm.includes(d.itemKey))
  if (unconfirmed.length) throw new ReportError(`This would drop work you chose earlier (${unconfirmed.map(d => d.label).join('; ')}). Confirm the removal or keep it; nothing was changed.`, 'removal_unconfirmed', 409, { wouldDrop: unconfirmed })
  const tasks = p.placed.map(t => ({ id: `mr-${createHash('sha1').update(`${a.key}:${t.sourceKey}`).digest('hex').slice(0, 24)}`, source_key: t.sourceKey, task_type: t.taskType, local_date: t.date, duration_minutes: t.minutes, title: t.title,
    outcome_id: t.outcomeId ?? '', lm_id: t.readingId ?? '', rationale: t.rationale, learning_objective: t.objective, suggested_approach: t.approach, completion_meaning: t.completion, verification_intent: t.verification, curriculum_reference: t.reference }))
  const { data, error } = await admin.rpc('accept_mock_recovery', { p_user: userId, p_key: a.key, p_report_id: report.id, p_report_version: version, p_cycle_id: p.cycleId, p_selection: { items: a.selection.items, remove: confirm, state_token: p.sourceToken }, p_tasks: tasks })
  if (error) console.error('[accept_mock_recovery]', error.message)
  if (error || !data) throw new ReportError('Save not confirmed. Nothing was partly applied; send it again with the same request, or check Calendar first.', 'SAVE_UNCONFIRMED', 503)
  const r = data as any
  if (r.ok !== true) throw new ReportError(String(r.message ?? 'The plan changed since you reviewed it. Review the updated plan; nothing was changed.'), r.code === 'STALE' ? 'preview_changed' : String(r.code), r.code === 'NOT_FOUND' ? 404 : 409)
  return { replayed: Boolean(r.replayed), taskIds: r.taskIds ?? [], placed: r.tasks ?? 0 }
}

/** Work the student chose that still needs a sitting, derived from the stored selection and what exists in every week. Never invented. `allocated` = minutes already covered. */
export async function recoveryRemainder(userId: string, report: MockReport): Promise<{ itemKey: string; minutes: number; allocated: number; status: ItemStatus }[]> {
  if (!report.planSelection || report.status !== 'active') return []
  const { states } = await loadItemStates(userId, report, await activeCycleId(userId))
  return report.planSelection.items.flatMap(i => { const s = states.get(i.key)!; return ['none', 'unfinished', 'needs_review'].includes(s.status) ? [{ itemKey: i.key, minutes: i.minutes, allocated: i.minutes - s.remaining, status: s.status }] : [] })
}
