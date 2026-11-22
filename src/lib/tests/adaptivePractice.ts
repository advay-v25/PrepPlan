import { createAdminClient } from '../supabase/admin'
import { readAll } from '../supabase/readAll'
import { toLevel } from '../curriculum/confidence'
import { getPaperManifestId } from '../planning/pulse/paper'
import { assembleEligiblePool, type Mix } from './assembly'
import { practiceSetBlueprint } from './assessmentDecision'
import { loadEligibleItemPool } from './itemPool'
import { loadDifficultyEvidence, selectionSeed } from './difficultyEvidence'
import { CONFIG, DIFFICULTY_POLICY, POLICY_PATCH, PROFILE_LABEL, PROFILE_MIX, MIX_LEVELS, apportion, decideReadingProfile, practiceProfile, practiceSetStats, seededRandom, type PracticeAnswer, type PracticeDelivered, type PracticeSet, type Profile } from './difficultyPolicy'
import { estimatedMinutes } from './limits'
import { paperJson } from './reserve'

/**
 * Adaptive practice: a bounded run of fixed five-question sets on one reading. Practice only — a set is an ordinary practice attempt, so it
 * writes no evidence event, closes no repair and earns no weekly credit; the practice-only decision below never feeds the evidence ledger.
 */
const SIZE = CONFIG.practice.setSize
const TERMINAL = ['submitted', 'scored', 'rescored', 'partially_voided', 'expired']
export const POLICY = `${DIFFICULTY_POLICY}/practice`

export type AdaptiveInput = { readingId: string; outcomeIds?: string[]; cap?: number }
export type SetPreview = {
  state: 'start' | 'insufficient' | 'unavailable' | 'no_bank' | 'no_scope'
  message: string | null
  readingName: string
  profile: Profile; label: string; reasons: string[]
  size: number; minutes: number; cap: number; remaining: number
  target: Record<'foundation' | 'standard' | 'difficult', number>; actual: Mix | null
  deliverable: number
  evidenceRevision: string
  statement: string
}
const STATEMENT = 'Practice does not verify understanding, close a repair or count toward a weekly paper. Each set uses questions you have not seen; once answered they are not reused.'
export type SetPlan = { itemIds: string[]; levels: Record<string, string>; seed: string; decision: Record<string, unknown> }

const capOf = (c?: number) => (c === 20 ? 20 : CONFIG.practice.defaultCap)

type Raw = { status: string; createdAt: string; delivered: PracticeDelivered[]; answers: Map<string, PracticeAnswer>; excluded: Set<string> }

/** Bulk read of the sets' attempts (no per-set queries). Validity is the challenge record, exactly as in results; a failed read throws rather than shrinking the sample. */
async function loadRaw(userId: string, sets: { attemptId: string; createdAt: string }[]): Promise<Map<string, Raw>> {
  const out = new Map<string, Raw>(), ids = sets.map(s => s.attemptId)
  if (!ids.length) return out
  const admin = createAdminClient()
  const att = await readAll<{ id: string; status: string; form_id: string }>((a, z) => admin.from('assessment_attempts').select('id, status, form_id').eq('user_id', userId).in('id', ids).order('id').range(a, z))
  const done = att.filter(x => TERMINAL.includes(x.status))
  if (!done.length) return out
  const doneIds = done.map(x => x.id), forms = [...new Set(done.map(x => x.form_id))]
  const [resp, fi, ch] = await Promise.all([
    readAll<any>((a, z) => admin.from('assessment_responses').select('attempt_id, item_id, selected_option_index, is_correct, self_reported_confidence').eq('user_id', userId).in('attempt_id', doneIds).order('attempt_id').order('item_id').range(a, z)),
    readAll<any>((a, z) => admin.from('form_items').select('form_id, item_id, difficulty_level, difficulty_basis, item:assessment_items(outcome_id, family_id)').in('form_id', forms).order('form_id').order('item_id').range(a, z)),
    readAll<any>((a, z) => admin.from('item_challenges').select('id, attempt_id, item_id, status').eq('user_id', userId).in('attempt_id', doneIds).in('status', ['pending', 'resolved_voided']).order('id').range(a, z)),
  ])
  const created = new Map(sets.map(s => [s.attemptId, s.createdAt]))
  for (const t of done) {
    const answers = new Map<string, PracticeAnswer>()
    for (const r of resp) if (r.attempt_id === t.id && r.selected_option_index !== null && r.selected_option_index !== undefined) answers.set(r.item_id, { correct: r.is_correct === true, confidence: toLevel(r.self_reported_confidence as number | null) })
    out.set(t.id, {
      status: t.status, createdAt: created.get(t.id) ?? '', answers,
      delivered: fi.filter((f: any) => f.form_id === t.form_id).map((f: any) => ({ itemId: f.item_id, outcomeId: f.item?.outcome_id ?? null, familyId: f.item?.family_id ?? null, level: f.difficulty_basis === 'confirmed' ? f.difficulty_level : null })),
      excluded: new Set(ch.filter((c: any) => c.attempt_id === t.id).map((c: any) => c.item_id as string)),   // voided AND disputed: neither may drive a level change
    })
  }
  return out
}

/** Earliest valid evidence exposure per family, for provenance: a family the learner had already met before a set is not a first exposure. */
async function familiarSince(userId: string, families: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (!families.length) return out
  const admin = createAdminClient()
  const items = await readAll<{ id: string; family_id: string }>((a, z) => admin.from('assessment_items').select('id, family_id').in('family_id', families).order('id').range(a, z))
  if (!items.length) return out
  const fam = new Map(items.map(i => [i.id, i.family_id]))
  const ev = await readAll<{ id: string; item_id: string; created_at: string }>((a, z) => admin.from('evidence_events').select('id, item_id, created_at').eq('user_id', userId).eq('validity', 'valid').eq('evidence_mode', 'evidence').in('item_id', [...fam.keys()]).order('id').range(a, z))
  for (const e of ev) { const f = fam.get(e.item_id)!; if (!out.has(f) || e.created_at < out.get(f)!) out.set(f, e.created_at) }
  return out
}

/**
 * Scored sets of this student's adaptive practice, oldest first, inside the shared recency window, counted for the scope being planned only:
 * questions outside it are not evidence for it, a set with none of its questions is dropped, and an open set elsewhere does not hide later ones.
 */
async function chain(userId: string, readingId: string, relevantOutcomes: string[], now: Date): Promise<{ sets: PracticeSet[]; partial: number }> {
  const admin = createAdminClient(), since = new Date(now.getTime() - CONFIG.windowDays * 86_400_000).toISOString()
  const runs = await readAll<{ id: string }>((a, z) => admin.from('practice_runs').select('id').eq('user_id', userId).eq('reading_id', readingId).order('id').range(a, z))
  if (!runs.length) return { sets: [], partial: 0 }
  const rows = await readAll<{ attempt_id: string; created_at: string }>((a, z) => admin.from('practice_run_sets').select('attempt_id, created_at').in('run_id', runs.map(r => r.id)).gte('created_at', since).order('created_at').order('attempt_id').range(a, z))
  const raw = await loadRaw(userId, rows.map(r => ({ attemptId: r.attempt_id, createdAt: r.created_at })))
  const ordered = rows.map(r => raw.get(r.attempt_id)).filter((x): x is Raw => !!x)
  const first = await familiarSince(userId, [...new Set(ordered.flatMap(r => r.delivered.map(d => d.familyId).filter((f): f is string => !!f)))])
  const relevant = new Set(relevantOutcomes), seen = new Set<string>(), sets: PracticeSet[] = []
  let partial = 0
  for (const r of ordered) {
    const familiar = new Set([...first].filter(([, t]) => t < r.createdAt).map(([f]) => f))
    const st = practiceSetStats({ delivered: r.delivered, answers: r.answers, excluded: r.excluded, relevant, seen, familiar })
    if (!st.inScope) continue
    if (st.outOfScope || st.inScope < SIZE) partial++
    sets.push(st)
  }
  return { sets, partial }
}

/** The next set for this scope: profile (practice-only decision), integer target, selection and the exact items. Read-only. */
export async function planNextSet(userId: string, input: AdaptiveInput, used: number, now = new Date()): Promise<{ preview: SetPreview; plan: SetPlan | null }> {
  const cap = capOf(input.cap), outs = [...new Set(input.outcomeIds ?? [])].sort()
  const base: SetPreview = { state: 'unavailable', message: null, readingName: '', profile: 'balanced', label: PROFILE_LABEL.balanced, reasons: [], size: SIZE, minutes: estimatedMinutes(SIZE), cap, remaining: Math.max(0, cap - used), target: { foundation: 0, standard: 0, difficult: 0 }, actual: null, deliverable: 0, evidenceRevision: '', statement: STATEMENT }
  if (used + SIZE > cap) return { preview: { ...base, message: 'You have reached the cap for this run.' }, plan: null }
  if (!(await getPaperManifestId())) return { preview: { ...base, state: 'no_bank', message: 'No question bank is active yet.' }, plan: null }
  const sb = await practiceSetBlueprint(input.readingId, outs, SIZE)
  if (!sb) return { preview: { ...base, state: 'no_scope', message: 'That reading has no examinable outcomes to practise.' }, plan: null }
  const [pool, ev, { sets, partial }] = await Promise.all([loadEligibleItemPool(userId, [input.readingId]), loadDifficultyEvidence(userId, [input.readingId], now), chain(userId, input.readingId, sb.outcomes, now)])
  const ed = decideReadingProfile({ paperOutcomeIds: sb.outcomes, readingObs: ev.byReading.get(input.readingId) ?? [], history: undefined, now })
  const step = practiceProfile(ed.proposed, sets)
  const target = (() => { const c = apportion(SIZE, MIX_LEVELS.map(l => PROFILE_MIX[step.profile][l])); return { foundation: c[0], standard: c[1], difficult: c[2] } })()
  const seed = selectionSeed([userId, 'practice', input.readingId, outs.join(','), cap, used, ev.version, pool.map(i => `${i.id}:${i.item_version}:${i.level ?? ''}`).sort().join(',')])
  const sim = assembleEligiblePool(sb.bp, pool, seededRandom(seed), { target })
  const p: SetPreview = { ...base, readingName: sb.readingName, profile: step.profile, label: PROFILE_LABEL[step.profile], reasons: [...(sets.length === 0 ? ed.reasons : []), ...step.reasons, ...(partial ? ['Some earlier practice covered other outcomes in this reading; only its questions on this scope were counted, and they cannot move the level up on their own.'] : [])], target, actual: sim.mix, deliverable: sim.delivered, evidenceRevision: ev.version }
  if (sim.delivered < SIZE) {
    return { preview: { ...p, state: 'insufficient', message: `Only ${sim.delivered} fresh human-reviewed question${sim.delivered === 1 ? '' : 's'} remain on this scope; a set needs ${SIZE}. Nothing is repeated or padded.${used ? ' You can end here.' : ' Practise from your own materials in the meantime.'}` }, plan: null }
  }
  const lv = new Map(pool.map(i => [i.id, i.level ?? '']))
  const itemIds = sim.items.map(i => i.itemId)
  return { preview: { ...p, state: 'start' }, plan: { itemIds, levels: Object.fromEntries(itemIds.map(i => [i, lv.get(i) ?? ''])), seed, decision: { policy: POLICY, profile: step.profile, reasons: p.reasons, target, actual: sim.mix, shortfall: sim.mixShortfall, seed, base: { profile: ed.proposed, basis: ed.basis, n: ed.n }, priorSets: sets.length, practiceOnly: true, patch: POLICY_PATCH, partialSets: partial } } }
}

const paper = async (userId: string, input: AdaptiveInput, plan: SetPlan, label: string) => {
  const manifest = (await getPaperManifestId())!
  const sb = (await practiceSetBlueprint(input.readingId, input.outcomeIds ?? [], SIZE))!
  return { ...paperJson({
    userId, manifestId: manifest, kind: 'practice', openKey: null, cycleId: null, paperKind: null, purpose: 'module_diagnostic', itemIds: plan.itemIds,
    requestedScope: { kind: 'practice', label: 'adaptive_practice', readingIds: [input.readingId] }, constraints: { maxQuestions: SIZE, resolvedLength: SIZE, allowedTiers: ['reviewed'], ceiling: SIZE, eligibility: 'approved-version-v1' },
    requested: { ...sb.bp, label, adaptivePractice: true, difficulty: plan.decision }, coverage: { delivered: SIZE, requested: SIZE, difficulty: plan.decision, selection: { policy: 'approved-version-v1' } },
    scopeLabel: 'adaptive_practice', timeLimitMinutes: null, minQuestions: SIZE,
  }), levels: plan.levels }   // the confirmed levels the plan was built on; the reservation refuses if any changed
}

type Reserved = { ok: true; runId: string; attemptId: string; revision: number; resumed: boolean; replay?: boolean; runStatus?: string; block?: number } | { ok: false; code: string; message: string; preview?: SetPreview }
const MSG: Record<string, string> = {
  STALE_RUN: 'This run changed in another tab or device. Reload to see where it is.', SET_OPEN: 'Finish or submit the open set first.', CAP_REACHED: 'You have reached the cap for this run.',
  RUN_CLOSED: 'This run has ended.', NOT_FOUND: 'That practice run was not found.', BANK_CHANGED: 'The available questions changed while starting. Nothing was started; review the updated set.', DECISION_CHANGED: 'The available questions or their levels changed while starting. Nothing was started; review the updated set.', KEY_CONFLICT: 'That request key was already used for something else. Reload and try again.', BANK_INSUFFICIENT: 'Not enough fresh questions remain. Nothing was started.',
}
const defOf = (input: AdaptiveInput) => ({ readingId: input.readingId, outcomeIds: [...new Set(input.outcomeIds ?? [])].sort(), cap: capOf(input.cap), policy: POLICY })
const fail = (code: string, message: string): Reserved => ({ ok: false, code, message })
const toResult = (r: any): Reserved => r?.ok ? { ok: true, runId: r.runId, attemptId: r.attemptId, revision: r.revision, resumed: Boolean(r.resumed), replay: Boolean(r.replay), runStatus: r.runStatus, block: r.block }
  : fail(r?.code === 'DECISION_CHANGED' ? 'stale' : String(r?.code ?? 'failed').toLowerCase(), MSG[r?.code] ?? 'Could not start the set. Nothing was started.')

/** A SUCCESSFUL earlier operation with this key, resolved before any fresh inventory, evidence, cap or stopped-state check; the original set comes back, never a newer one. */
async function receipt(userId: string, key: string, runId: string | null, input: AdaptiveInput): Promise<Reserved | null> {
  const { data, error } = await createAdminClient().rpc('practice_run_receipt', { p_user: userId, p_request_key: key, p_run: runId, p_def: defOf(input) })
  if (error) { console.error('[practice_run_receipt]', error.message); return fail('failed', 'Could not check this request. Nothing was started.') }
  return data ? toResult(data) : null
}

async function reserve(userId: string, runId: string | null, key: string, expected: number | null, input: AdaptiveInput, plan: SetPlan): Promise<Reserved> {
  const { data, error } = await createAdminClient().rpc('practice_run_reserve', {
    p_user: userId, p_run: runId, p_request_key: key, p_expected_revision: expected, p_def: defOf(input),
    p_decision: plan.decision, p_paper: await paper(userId, input, plan, 'adaptive'),
  })
  if (error) { console.error('[practice_run_reserve]', error.message); return { ok: false, code: 'failed', message: 'Could not start the set. Nothing was started.' } }
  return toResult(data)
}

/** Read-only preview of the first set of a new run. Creates no run, form or exposure. */
export async function previewAdaptive(userId: string, input: AdaptiveInput) { return (await planNextSet(userId, input, 0)).preview }

/** Run `op`; if it fails, a concurrent request with the SAME key may just have succeeded, so look the receipt up once more before reporting failure. */
async function replayable(userId: string, key: string, runId: string | null, input: AdaptiveInput, op: () => Promise<Reserved | { ok: false; code: string; message: string; preview?: SetPreview }>) {
  const first = await receipt(userId, key, runId, input)
  if (first) return first
  let r: Awaited<ReturnType<typeof op>>
  try { r = await op() } catch (e) { console.error('[adaptive practice]', (e as Error).message); return fail('failed', 'Could not read your practice history. Nothing was started.') }
  if (!r.ok) { const again = await receipt(userId, key, runId, input); if (again) return again }
  return r
}

export async function startAdaptive(userId: string, input: AdaptiveInput, key: string, expectedDecision?: string) {
  return replayable(userId, key, null, input, async () => {
    const { preview, plan } = await planNextSet(userId, input, 0)
    if (!plan) return { ok: false as const, code: 'unavailable', message: preview.message ?? 'Adaptive practice is not available for this scope.', preview }
    if (expectedDecision && expectedDecision !== preview.evidenceRevision) return { ok: false as const, code: 'stale', message: 'Your recent results changed since you reviewed this set. Review the updated set before starting.', preview }
    return reserve(userId, null, key, null, input, plan)
  })
}

export async function loadRun(userId: string, runId: string) {
  const admin = createAdminClient()
  const { data: run } = await admin.from('practice_runs').select('*').eq('id', runId).eq('user_id', userId).maybeSingle()
  if (!run) return null
  const sets = await readAll<{ block_no: number; attempt_id: string; decision: any; created_at: string }>((a, z) => admin.from('practice_run_sets').select('block_no, attempt_id, size, decision, created_at').eq('run_id', runId).order('block_no').range(a, z))
  const att = await readAll<{ id: string; status: string }>((a, z) => admin.from('assessment_attempts').select('id, status').in('id', sets.map(s => s.attempt_id)).order('id').range(a, z))
  const status = new Map(att.map(a => [a.id, a.status]))
  const raw = await loadRaw(userId, sets.map(s => ({ attemptId: s.attempt_id, createdAt: s.created_at })))
  const detail = sets.map(s => {
    const r = raw.get(s.attempt_id)   // the run's own summary: every delivered question, minus voided or disputed ones
    return { block: s.block_no, attemptId: s.attempt_id, status: status.get(s.attempt_id) ?? 'unknown', decision: s.decision, stats: r ? practiceSetStats({ delivered: r.delivered, answers: r.answers, excluded: r.excluded }) as PracticeSet : null }
  })
  return { run, sets: detail }
}

/** Owned state, completed sets, the pending next-set preview and the permitted action. Read-only. */
export async function runState(userId: string, runId: string) {
  const l = await loadRun(userId, runId)
  if (!l) return null
  const { run, sets } = l
  const last = sets[sets.length - 1], used = sets.length * SIZE
  const open = last && !TERMINAL.includes(last.status) ? last : null
  const input: AdaptiveInput = { readingId: run.reading_id as string, outcomeIds: run.outcome_ids as string[], cap: run.cap as number }
  const capped = used >= (run.cap as number)
  const next = run.status === 'active' && !open && !capped ? (await planNextSet(userId, input, used)).preview : null
  const action = run.status === 'stopped' ? 'ended' : open ? 'resume' : capped ? 'summary' : next?.state === 'start' ? 'continue' : 'stop'
  const answered = sets.reduce((n, s) => n + (s.stats?.answered ?? 0), 0), correct = sets.reduce((n, s) => n + (s.stats?.correct ?? 0), 0)
  return { id: run.id as string, readingId: run.reading_id as string, cap: run.cap as number, status: run.status as string, revision: run.revision as number, sets, delivered: used, answered, correct, openAttemptId: open?.attemptId ?? null, next, action, finished: run.status === 'stopped' || (capped && !open), readingName: next?.readingName ?? '' }
}

export async function nextAdaptive(userId: string, runId: string, expectedRevision: number, key: string) {
  let l: Awaited<ReturnType<typeof loadRun>>
  try { l = await loadRun(userId, runId) } catch (e) { console.error('[adaptive practice]', (e as Error).message); return fail('failed', 'Could not read this run. Nothing was started.') }
  if (!l) return { ok: false as const, code: 'not_found', message: MSG.NOT_FOUND }
  const { run, sets } = l
  const input: AdaptiveInput = { readingId: run.reading_id as string, outcomeIds: run.outcome_ids as string[], cap: run.cap as number }
  return replayable(userId, key, runId, input, async () => {
    // New work only: a closed run, a reached cap or an unavailable plan never block the replay of an earlier success (resolved above).
    if (run.status !== 'active') return { ok: false as const, code: 'run_closed', message: MSG.RUN_CLOSED }
    if ((sets.length + 1) * SIZE > (run.cap as number)) return { ok: false as const, code: 'cap_reached', message: MSG.CAP_REACHED }
    const { preview, plan } = await planNextSet(userId, input, sets.length * SIZE)
    if (!plan) return { ok: false as const, code: 'unavailable', message: preview.message ?? 'No further set is available.', preview }
    return reserve(userId, runId, key, expectedRevision, input, plan)
  })
}

export async function stopAdaptive(userId: string, runId: string, expectedRevision: number | null) {
  const { data, error } = await createAdminClient().rpc('practice_run_stop', { p_user: userId, p_run: runId, p_expected_revision: expectedRevision })
  if (error) return { ok: false as const, code: 'failed', message: 'Could not end the run.' }
  const r = data as any
  return r?.ok ? { ok: true as const, revision: r.revision as number } : { ok: false as const, code: String(r?.code ?? 'failed').toLowerCase(), message: MSG[r?.code] ?? 'Could not end the run.' }
}

/** For labels: the run and block an attempt belongs to, or null for any other attempt. */
export async function setOfAttempt(userId: string, attemptId: string): Promise<{ runId: string; block: number; cap: number } | null> {
  const { data, error } = await createAdminClient().from('practice_run_sets').select('run_id, block_no, run:practice_runs!inner(user_id, cap)').eq('attempt_id', attemptId).maybeSingle()
  if (error) throw error
  const run = (data as any)?.run
  return data && run?.user_id === userId ? { runId: data.run_id as string, block: data.block_no as number, cap: run.cap as number } : null
}
