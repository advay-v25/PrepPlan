import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '../supabase/admin'
import { getPaperManifestId } from '../planning/pulse/paper'
import { getLosTracker } from '../curriculum/losTrackerService'
import { getCompletedCycleScope } from './completedScopeService'
import { getPaperPreview, type PaperKind } from './paperPreview'
import { allocateWeighted, type SubjectWeight, type WeightedBlueprint } from './weightedBlueprint'
import { assembleFromBlueprint } from './assembly'
import { MAX_ASSESSMENT_QUESTIONS, MOCK_MINUTES, MOCK_QUESTIONS, estimatedMinutes } from './limits'
import type { ScopeTarget } from './completedScope'

/**
 * Starting an assessment freezes it: the scope snapshot, the requested blueprint and the exact
 * item set are recorded, and nothing completed afterwards can change this attempt.
 * Idempotent: an open attempt for the same thing is resumed, never duplicated.
 */

export type StartKind = 'weekly' | 'reading' | 'subject' | 'repair' | 'mock'
export type StartInput = {
  kind: StartKind
  /** weekly: the scope revision the student reviewed. */
  expectedRevision?: string
  paperKind?: PaperKind
  readingId?: string
  subjectId?: string
  /** reading/subject: explicitly test the whole reading/subject rather than completed scope. */
  baseline?: boolean
}

export type StartResult =
  | { ok: true; attemptId: string; resumed: boolean; questions: number; estimatedMinutes: number; timed: boolean }
  | { ok: false; code: 'no_scope' | 'scope_changed' | 'bank_insufficient' | 'bad_request' | 'no_cycle' | 'failed'; message: string; preview?: unknown }

const MIN_QUESTIONS = 5

async function subjectWeights(): Promise<SubjectWeight[]> {
  const { data } = await createAdminClient().from('topics').select('id, exam_weight_min, exam_weight_max')
  return (data ?? []).map(t => ({ id: t.id as string, min: Number(t.exam_weight_min), max: Number(t.exam_weight_max) }))
}

function scopeToInput(targets: ScopeTarget[], readings: Map<string, { pageCount: number; subjectId: string }>) {
  const rmap = new Map<string, { readingId: string; subjectId: string; pageCount: number; outcomeIds: string[]; newCount: number; revisionCount: number }>()
  for (const t of targets) {
    const r = rmap.get(t.readingId) ?? { readingId: t.readingId, subjectId: t.subjectId, pageCount: readings.get(t.readingId)?.pageCount ?? 0, outcomeIds: [], newCount: 0, revisionCount: 0 }
    r.outcomeIds.push(t.outcomeId); rmap.set(t.readingId, r)
  }
  return { targets, readings: [...rmap.values()] }
}

async function catalog() {
  const admin = createAdminClient()
  const [{ data: readings }, { data: los }] = await Promise.all([
    admin.from('curriculum_readings').select('id, topic_id, page_count, structure_pending').eq('is_active', true),
    admin.from('reading_los').select('id, reading_id'),
  ])
  const rmap = new Map((readings ?? []).map(r => [r.id as string, { id: r.id as string, subjectId: r.topic_id as string, pageCount: Number(r.page_count), pending: Boolean(r.structure_pending) }]))
  const targets: ScopeTarget[] = (los ?? []).filter(l => rmap.get(l.reading_id as string) && !rmap.get(l.reading_id as string)!.pending).map(l => ({
    outcomeId: l.id as string, readingId: l.reading_id as string, subjectId: rmap.get(l.reading_id as string)!.subjectId, kind: 'new' as const, weight: 1, sources: [],
  }))
  return { rmap, targets }
}

export async function startAssessment(db: SupabaseClient, userId: string, input: StartInput): Promise<StartResult> {
  const admin = createAdminClient()
  const cycleRow = (await admin.from('planning_cycles').select('id').eq('user_id', userId).eq('status', 'active').maybeSingle()).data
  const cycleId = (cycleRow?.id as string | undefined) ?? null
  const weights = await subjectWeights()
  const manifestId = await getPaperManifestId()
  if (!manifestId) return { ok: false, code: 'bank_insufficient', message: 'No question bank is active yet.' }

  let blueprint: WeightedBlueprint
  let scopeSnapshot: unknown = null
  let scopeRevision: string | null = null
  let paperKind: PaperKind | null = null
  let openKey: { column: string; value: string }
  let purposeLabel: string
  let timed = false
  let tiersFor: 'weekly_cumulative' = 'weekly_cumulative'

  if (input.kind === 'weekly') {
    if (!cycleId) return { ok: false, code: 'no_cycle', message: 'There is no open week, so there is no weekly paper. Prepare your week in Calendar first.' }
    const preview = await getPaperPreview(userId, input.paperKind)
    if (preview.noPaperReason) return { ok: false, code: 'no_scope', message: preview.noPaperReason, preview }
    if (input.expectedRevision && input.expectedRevision !== preview.scope.revision) {
      return { ok: false, code: 'scope_changed', message: 'Your completed work changed since you reviewed it. Review the updated scope before starting.', preview }
    }
    blueprint = preview.blueprint; scopeSnapshot = preview.scope; scopeRevision = preview.scope.revision; paperKind = preview.paperKind
    openKey = { column: 'paper_kind', value: `${cycleId}:${paperKind}` }
    purposeLabel = `weekly_${paperKind}`
  } else if (input.kind === 'reading' || input.kind === 'subject') {
    const { rmap, targets: all } = await catalog()
    const id = input.kind === 'reading' ? input.readingId : input.subjectId
    if (!id) return { ok: false, code: 'bad_request', message: 'Choose what to test.' }
    const inScope = (t: ScopeTarget) => (input.kind === 'reading' ? t.readingId === id : t.subjectId === id)
    let targets: ScopeTarget[]
    if (input.baseline) targets = all.filter(inScope)
    else {
      const scope = await getCompletedCycleScope(userId)
      targets = scope.targets.filter(inScope); scopeSnapshot = scope; scopeRevision = scope.revision
    }
    if (targets.length === 0) {
      return { ok: false, code: 'no_scope', message: input.baseline ? 'That reading or subject has no examinable outcomes yet.' : 'Nothing you have completed falls in that reading or subject. Complete some work first, or choose a baseline check.' }
    }
    blueprint = allocateWeighted({ scope: scopeToInput(targets, rmap), subjects: weights, kinds: ['new', 'revision'] })
    openKey = { column: input.kind === 'reading' ? 'reading' : 'subject', value: id }
    purposeLabel = `${input.kind}${input.baseline ? '_baseline' : ''}`
  } else if (input.kind === 'repair') {
    const tracker = await getLosTracker(userId)
    const rows = tracker.topics.flatMap(t => t.modules.flatMap(m => m.rows)).filter(r => r.band === 'repair' || r.verdict === 'concept_miss' || r.verdict === 'known_gap')
    if (rows.length === 0) return { ok: false, code: 'no_scope', message: 'You have no open repair work to re-check.' }
    const { rmap } = await catalog()
    const perOutcome = rows.map(r => ({ outcomeId: r.outcomeId, readingId: r.readingId, subjectId: rmap.get(r.readingId)?.subjectId ?? '', questions: 2, kind: 'revision' as const }))
    const byReading = new Map<string, number>()
    for (const o of perOutcome) byReading.set(o.readingId, (byReading.get(o.readingId) ?? 0) + o.questions)
    const perReading = [...byReading].map(([readingId, questions]) => ({ readingId, subjectId: rmap.get(readingId)?.subjectId ?? '', questions, pages: rmap.get(readingId)?.pageCount ?? 0 }))
    blueprint = {
      totalQuestions: Math.min(MAX_ASSESSMENT_QUESTIONS, perOutcome.reduce((s, o) => s + o.questions, 0)), estimatedMinutes: 0, perOutcome, perReading, perSubject: [], sections: [{ kind: 'revision', questions: perOutcome.length * 2 }],
      rollingCoverage: [], bankShortfalls: [], policy: { breadthFloor: 0, ceiling: MAX_ASSESSMENT_QUESTIONS, certainty: 'full', note: 'Repair re-check: independent, unseen items on previously missed outcomes.' },
    }
    openKey = { column: 'cycle_id', value: cycleId ?? 'none' }
    purposeLabel = 'repair'
  } else if (input.kind === 'mock') {
    const { rmap, targets } = await catalog()
    blueprint = allocateWeighted({ scope: scopeToInput(targets, rmap), subjects: weights, kinds: ['new'], totalOverride: MOCK_QUESTIONS })
    timed = true
    openKey = { column: 'attempt_kind', value: 'mock' }
    purposeLabel = 'mock'
  } else {
    return { ok: false, code: 'bad_request', message: 'Unknown assessment type.' }
  }

  // Resume an open attempt for the same thing rather than creating a second.
  const open = await findOpenAttempt(admin, userId, input.kind, cycleId, openKey)
  if (open) return { ok: true, attemptId: open.id, resumed: true, questions: open.questions, estimatedMinutes: estimatedMinutes(open.questions), timed: Boolean(open.timed) }

  const assembly = await assembleFromBlueprint(userId, blueprint, tiersFor)
  const need = input.kind === 'mock' ? MOCK_QUESTIONS : MIN_QUESTIONS
  if (assembly.delivered < need) {
    const gaps = assembly.shortfalls.map(s => `${s.readingId}: ${s.delivered} of ${s.wanted}`).join('; ')
    return {
      ok: false, code: 'bank_insufficient',
      message: input.kind === 'mock'
        ? `A mock needs ${MOCK_QUESTIONS} unseen approved questions across the syllabus; the bank can serve ${assembly.delivered} right now.`
        : `The question bank can serve ${assembly.delivered} unseen approved question${assembly.delivered === 1 ? '' : 's'} for this scope, and at least ${MIN_QUESTIONS} are needed. ${gaps ? `Short: ${gaps}.` : ''} Nothing was started.`,
    }
  }

  const { data: bp, error: bpErr } = await admin.from('assessment_blueprints').insert({
    manifest_id: manifestId, purpose: input.kind === 'mock' ? 'weekly_cumulative' : input.kind === 'repair' ? 'repair_recheck' : input.kind === 'weekly' ? 'weekly_cumulative' : 'module_diagnostic',
    requested_scope: { kind: input.kind, label: purposeLabel, readingIds: blueprint.perReading.map(r => r.readingId) },
    constraints: { maxQuestions: assembly.delivered, resolvedLength: assembly.delivered, allowedTiers: ['reviewed'], requested: blueprint.totalQuestions, ceiling: MAX_ASSESSMENT_QUESTIONS },
  }).select('id').single()
  if (bpErr || !bp) return { ok: false, code: 'failed', message: 'Could not record the paper.' }
  const { data: form, error: formErr } = await admin.from('assessment_forms').insert({ blueprint_id: bp.id, delivery_mode: 'fixed' }).select('id').single()
  if (formErr || !form) return { ok: false, code: 'failed', message: 'Could not record the paper.' }
  const { error: fiErr } = await admin.from('form_items').insert(assembly.items.map((it, i) => ({ form_id: form.id, item_id: it.itemId, sequence_number: i + 1 })))
  if (fiErr) return { ok: false, code: 'failed', message: 'Could not record the paper’s questions.' }

  const now = new Date()
  const attemptRow: Record<string, unknown> = {
    user_id: userId, form_id: form.id, delivery_mode: 'fixed', status: 'ready',
    attempt_kind: input.kind, paper_kind: paperKind, cycle_id: cycleId, open_key: openKey.value,
    requested_blueprint: { ...blueprint, label: purposeLabel, scopeRevision, key: openKey.value },
    delivered_coverage: { delivered: assembly.delivered, requested: assembly.requested, perReading: assembly.perReading, shortfalls: assembly.shortfalls, balance: assembly.balance },
  }
  if (timed) { attemptRow.time_limit_minutes = MOCK_MINUTES; attemptRow.deadline_at = new Date(now.getTime() + MOCK_MINUTES * 60_000).toISOString() }
  const { data: attempt, error: aErr } = await db.from('assessment_attempts').insert(attemptRow).select('id').single()
  if (aErr && aErr.code === '23505') {
    // A concurrent start won the unique open-attempt slot: discard our unused paper and resume theirs.
    await admin.from('form_items').delete().eq('form_id', form.id)
    await admin.from('assessment_forms').delete().eq('id', form.id)
    await admin.from('assessment_blueprints').delete().eq('id', bp.id)
    const winner = await findOpenAttempt(admin, userId, input.kind, cycleId, openKey)
    if (winner) return { ok: true, attemptId: winner.id, resumed: true, questions: winner.questions, estimatedMinutes: estimatedMinutes(winner.questions), timed: Boolean(winner.timed) }
  }
  if (aErr || !attempt) { console.error('[startAssessment] attempt insert', aErr?.message); return { ok: false, code: 'failed', message: 'Could not start the attempt.' } }

  if (scopeSnapshot) {
    await admin.from('paper_scope_snapshots').insert({ user_id: userId, cycle_id: cycleId, purpose: purposeLabel, revision: scopeRevision ?? 'n/a', scope: scopeSnapshot, attempt_id: attempt.id })
  }
  if (input.kind === 'weekly' && cycleId) {
    // Link the paper to the cycle's scheduled paper block so weekly closure sees this attempt.
    const { data: blk } = await admin.from('plan_blocks').select('id, attempt_id').eq('user_id', userId).eq('cycle_id', cycleId).eq('task_type', 'diagnostic').is('attempt_id', null).limit(1).maybeSingle()
    if (blk) await admin.from('plan_blocks').update({ attempt_id: attempt.id }).eq('id', blk.id as string).is('attempt_id', null)
  }
  return { ok: true, attemptId: attempt.id as string, resumed: false, questions: assembly.delivered, estimatedMinutes: estimatedMinutes(assembly.delivered), timed }
}

async function findOpenAttempt(admin: ReturnType<typeof createAdminClient>, userId: string, kind: StartKind, cycleId: string | null, key: { column: string; value: string }) {
  let q = admin.from('assessment_attempts').select('id, status, form_id, time_limit_minutes, paper_kind, cycle_id, requested_blueprint, open_key').eq('user_id', userId).eq('attempt_kind', kind).in('status', ['ready', 'in_progress'])
  if (kind === 'weekly' && cycleId) q = q.eq('cycle_id', cycleId)
  const { data } = await q.order('started_at', { ascending: false, nullsFirst: false })
  const match = (data ?? []).find(a => ((a.requested_blueprint as any)?.key ?? null) === key.value || (a as any).open_key === key.value)
  if (!match) return null
  const { count } = await admin.from('form_items').select('*', { count: 'exact', head: true }).eq('form_id', match.form_id as string)
  return { id: match.id as string, questions: count ?? 0, timed: match.time_limit_minutes }
}
