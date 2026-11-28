import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '../supabase/admin'
import { getPaperManifestId } from '../planning/pulse/paper'
import { loadEligibleItemPool } from '../tests/itemPool'
import { EVIDENCE_POLICY_VERSION } from '../diagnostic/evidencePolicy'
import { getAttemptResult, type AttemptResult } from '../tests/resultService'
import { PAPER_SCORE_POLICY, LEGACY_SCORING_POLICY, buildLedger, combineLedgers, isSupportedPolicy, type Ledger } from '../tests/scoreLedger'
import { REHEARSAL_BLUEPRINT_VERSION, SESSION_MINUTES, SESSION_QUESTIONS, planRehearsal, type RehearsalItem, type RehearsalPlan, type SessionShortfall, type TopicWeight } from './blueprint'

/**
 * Linked rehearsal: ONE capability decision (Calendar, Tests, Coach and Settings all read `decideRehearsal`), ONE atomic reservation
 * (`start_rehearsal`, which pins BOTH forms or neither), an explicit start per session (`start_rehearsal_session`; the server owns the
 * clock) and one read model (`getRehearsal`) for the taking screen, Tests and the combined result.
 *
 * The held-out pool is read here, on the server, from its own view; no request parameter selects it.
 */

export type SessionDecision = { no: 1 | 2; wanted: number; deliverable: number; minutes: number; shortfalls: (SessionShortfall & { topic: string })[] }
export type RehearsalDecision = {
  state: 'start' | 'resume' | 'insufficient' | 'no_bank' | 'closed' | 'not_internal' | 'no_appointment'
  appointmentId: string | null
  rehearsalId: string | null
  sessions: SessionDecision[]
  /** Fresh, approved, held-out questions the student could be served right now (all topics, before session split). */
  freshHeldOut: number
  message: string | null
  reasons: string[]
  next: { label: string; href: string } | null
  blueprintVersion: string
}
export type RehearsalDecisionResult = { decision: RehearsalDecision; plan: { plan: RehearsalPlan; manifestId: string } | null }

const topicsAndNames = async () => {
  const { data } = await createAdminClient().from('topics').select('id, name, exam_weight_min, exam_weight_max').throwOnError()
  const weights: TopicWeight[] = (data ?? []).map(t => ({ id: t.id as string, min: Number(t.exam_weight_min), max: Number(t.exam_weight_max) }))
  return { weights, name: new Map((data ?? []).map(t => [t.id as string, t.name as string])) }
}

/** The fresh held-out pool, tagged with each question's topic. */
async function loadPool(userId: string): Promise<RehearsalItem[]> {
  const { data: readings } = await createAdminClient().from('curriculum_readings').select('id, topic_id').eq('is_active', true).throwOnError()
  const topicOf = new Map((readings ?? []).map(r => [r.id as string, r.topic_id as string]))
  const pool = await loadEligibleItemPool(userId, [...topicOf.keys()], undefined, 'heldout')
  return pool.filter(i => topicOf.has(i.lm_id) && i.family_id).map(i => ({ ...i, topic_id: topicOf.get(i.lm_id)! }))
}

const NEXT_PLAN = { label: 'Plan an external mock or keep preparing', href: '/app/calendar#checkpoint' }

/** `betweenReads` is a test seam: it runs after "no open rehearsal" is read and before the pool is loaded, to force a concurrent reservation into that gap. */
export async function decideRehearsal(userId: string, appointmentId: string | null, random: () => number = Math.random, betweenReads?: () => Promise<void>): Promise<RehearsalDecisionResult> {
  const admin = createAdminClient()
  const base = (over: Partial<RehearsalDecision>): RehearsalDecision => ({ state: 'insufficient', appointmentId, rehearsalId: null, sessions: [], freshHeldOut: 0, message: null, reasons: [], next: null, blueprintVersion: REHEARSAL_BLUEPRINT_VERSION, ...over })
  // With no appointment this is the pure capability question ("could a rehearsal be built for me right now?"): the same decision, no appointment checks.
  if (appointmentId) {
    const { data: appt } = await admin.from('mock_appointments').select('id, kind, status').eq('id', appointmentId).eq('user_id', userId).maybeSingle().throwOnError()
    if (!appt) return { decision: base({ state: 'no_appointment', message: 'That appointment could not be found.' }), plan: null }
    if (appt.kind !== 'internal_rehearsal') return { decision: base({ state: 'not_internal', message: 'This is an external mock. You take it outside PrepPlan and record what happened.', next: { label: 'Record it in Calendar', href: `/app/calendar?appointment=${appointmentId}#checkpoint` } }), plan: null }
    if (appt.status !== 'planned') return { decision: base({ state: 'closed', message: `This rehearsal is ${appt.status}.` }), plan: null }
    const { data: open } = await admin.from('mock_rehearsals').select('id').eq('appointment_id', appointmentId).in('status', ['ready', 'in_progress']).maybeSingle().throwOnError()
    if (open) return { decision: base({ state: 'resume', rehearsalId: open.id as string, message: null }), plan: null }
  }
  if (betweenReads) await betweenReads()
  const manifestId = await getPaperManifestId()
  if (!manifestId) return { decision: base({ state: 'no_bank', message: 'No question bank is active yet.', next: NEXT_PLAN }), plan: null }

  const [{ weights, name }, pool] = await Promise.all([topicsAndNames(), loadPool(userId)])
  const plan = planRehearsal(pool, weights, random)
  const sessions: SessionDecision[] = ([0, 1] as const).map(s => ({
    no: (s + 1) as 1 | 2, wanted: SESSION_QUESTIONS, deliverable: plan.sessions[s].length, minutes: SESSION_MINUTES,
    shortfalls: plan.shortfalls[s].map(f => ({ ...f, topic: name.get(f.topicId) ?? f.topicId })),
  }))
  if (plan.ready) return { decision: base({ state: 'start', sessions, freshHeldOut: pool.length, reasons: ['Two sessions of 90 questions, each with its own 135-minute clock, from questions held back from every other paper.'] }), plan: { plan, manifestId } }

  const reasons: string[] = []
  if (pool.length === 0) reasons.push('No approved held-out questions are available to you yet, so neither session can be built.')
  for (const s of sessions) {
    if (!s.shortfalls.length) continue
    const worst = [...s.shortfalls].sort((a, b) => (b.wanted - b.deliverable) - (a.wanted - a.deliverable)).slice(0, 4)
    reasons.push(`Session ${s.no} has ${s.deliverable} of ${s.wanted} questions: ${worst.map(f => `${f.topic} ${f.deliverable} of ${f.wanted}`).join('; ')}${s.shortfalls.length > worst.length ? `; and ${s.shortfalls.length - worst.length} more topic${s.shortfalls.length - worst.length === 1 ? '' : 's'}` : ''}.`)
  }
  reasons.push('Each topic needs enough different, unseen question families for both sessions; a total of 180 questions somewhere in the bank is not enough.')
  return { decision: base({ state: 'insufficient', sessions, freshHeldOut: pool.length, message: 'A full rehearsal cannot be built from approved held-out questions yet. Nothing was started.', reasons, next: NEXT_PLAN }), plan: null }
}

export type StartRehearsalResult =
  | { ok: true; rehearsalId: string; resumed: boolean }
  | { ok: false; code: 'insufficient' | 'changed' | 'closed' | 'failed'; message: string; decision?: RehearsalDecision }

/** The open reservation (if any) for this owned appointment. A concurrent start can pin the forms between our "none open" read and our pool read. */
async function openRehearsalId(userId: string, appointmentId: string): Promise<string | null> {
  const { data } = await createAdminClient().from('mock_rehearsals').select('id').eq('user_id', userId).eq('appointment_id', appointmentId).in('status', ['ready', 'in_progress']).maybeSingle().throwOnError()
  return (data?.id as string | undefined) ?? null
}

export async function startRehearsal(userId: string, appointmentId: string, betweenReads?: () => Promise<void>): Promise<StartRehearsalResult> {
  const r = await decideRehearsal(userId, appointmentId, Math.random, betweenReads)
  const d = r.decision
  if (d.state === 'resume') return { ok: true, rehearsalId: d.rehearsalId!, resumed: true }
  // A shortfall is only honest if no reservation exists: the losing side of a concurrent start sees a pool with the winner's items already pinned.
  if (d.state === 'insufficient') { const open = await openRehearsalId(userId, appointmentId); if (open) return { ok: true, rehearsalId: open, resumed: true } }
  if (d.state !== 'start' || !r.plan) return { ok: false, code: d.state === 'closed' ? 'closed' : 'insufficient', message: d.message ?? 'This rehearsal is not available.', decision: d }
  const { plan, manifestId } = r.plan
  const { data, error } = await createAdminClient().rpc('start_rehearsal', {
    p_user: userId, p_appointment: appointmentId, p_manifest: manifestId, p_s1: plan.sessions[0], p_s2: plan.sessions[1],
    p_blueprint: { version: REHEARSAL_BLUEPRINT_VERSION, allocation: plan.allocation, perSessionAllocation: plan.perSessionAllocation, sessions: 2, questionsPerSession: SESSION_QUESTIONS, minutesPerSession: SESSION_MINUTES },
    p_version: REHEARSAL_BLUEPRINT_VERSION, p_coverage: { '1': plan.coverage[0], '2': plan.coverage[1] },
  })
  if (error) { console.error('[startRehearsal]', error.message); return { ok: false, code: 'failed', message: 'Could not reserve the rehearsal. Nothing was started.' } }
  const x = data as any
  if (x?.ok) return { ok: true, rehearsalId: x.rehearsalId, resumed: Boolean(x.resumed) }
  if (x?.code === 'BANK_CHANGED' || x?.code === 'BANK_INSUFFICIENT') { const open = await openRehearsalId(userId, appointmentId); if (open) return { ok: true, rehearsalId: open, resumed: true } }
  if (x?.code === 'BANK_CHANGED' || x?.code === 'BANK_INSUFFICIENT') return { ok: false, code: 'changed', message: 'The available questions changed while starting. Nothing was started; review the updated decision.', decision: (await decideRehearsal(userId, appointmentId)).decision }
  if (x?.code === 'APPOINTMENT_CLOSED') return { ok: false, code: 'closed', message: 'That appointment is no longer planned.' }
  return { ok: false, code: 'failed', message: 'Could not reserve the rehearsal. Nothing was started.' }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------------------------------------
export type SessionPhase = 'waiting' | 'not_started' | 'running' | 'timed_out' | 'ended'
export type SessionState = {
  no: 1 | 2; attemptId: string; status: string; phase: SessionPhase; questions: number; answered: number; minutes: number
  startedAt: string | null; deadlineAt: string | null; endedAt: string | null; score: number | null; valid: number | null; correct: number | null
  /** Seconds the server says remain right now (null before the clock starts). */
  secondsLeft: number | null; href: string; resultHref: string | null
  /** The scoring policy this session's form was reserved under (null = unknown), read from the pinned form, never assumed. */
  policy: string | null
}
export type RehearsalState = {
  id: string; appointmentId: string | null; status: string; createdAt: string
  /** What the student should see: where they are in the journey. */
  stage: 'ready' | 'session1' | 'break' | 'session2' | 'complete'
  sessions: SessionState[]
  primary: { label: string; href: string } | null
  serverNow: string
}

const ENDED = new Set(['scored', 'expired', 'rescored', 'partially_voided', 'abandoned', 'submitted'])

export async function getRehearsal(userId: string, rehearsalId: string, now = new Date()): Promise<RehearsalState | null> {
  const admin = createAdminClient()
  const { data: r } = await admin.from('mock_rehearsals').select('id, appointment_id, status, created_at').eq('id', rehearsalId).eq('user_id', userId).maybeSingle().throwOnError()
  if (!r) return null
  const { data: attempts } = await admin.from('assessment_attempts').select('id, session_no, status, started_at, deadline_at, completed_at, score, valid_response_count, correct_response_count, time_limit_minutes, form_id, scoring_policy_version')
    .eq('rehearsal_id', rehearsalId).eq('user_id', userId).order('session_no').throwOnError()
  const formIds = (attempts ?? []).map(a => a.form_id as string).filter(Boolean)
  const { data: forms } = formIds.length ? await admin.from('assessment_forms').select('id, scoring_policy').in('id', formIds).throwOnError() : { data: [] as any[] }
  const formPolicy = new Map<string, string | null>((forms ?? []).map(f => [f.id as string, (f.scoring_policy ?? null) as string | null] as [string, string | null]))
  const counts = new Map<string, number>()
  for (const a of attempts ?? []) {
    const { count } = await admin.from('assessment_responses').select('id', { count: 'exact', head: true }).eq('attempt_id', a.id as string).throwOnError()
    if (count === null) throw new Error('Could not count the rehearsal session answers.')
    counts.set(a.id as string, count)
  }
  const sessions: SessionState[] = (attempts ?? []).map(a => {
    const ended = ENDED.has(a.status as string)
    const deadline = a.deadline_at as string | null
    const left = deadline ? Math.max(0, Math.ceil((new Date(deadline).getTime() - now.getTime()) / 1000)) : null
    const prevEnded = a.session_no === 1 || ENDED.has((attempts ?? []).find(x => x.session_no === 1)?.status as string)
    const phase: SessionPhase = ended ? 'ended' : !deadline ? (prevEnded ? 'not_started' : 'waiting') : left === 0 ? 'timed_out' : 'running'
    return {
      no: a.session_no as 1 | 2, attemptId: a.id as string, status: a.status as string, phase, questions: SESSION_QUESTIONS, answered: counts.get(a.id as string) ?? 0, minutes: (a.time_limit_minutes as number) ?? SESSION_MINUTES,
      startedAt: (a.started_at ?? null) as string | null, deadlineAt: deadline, endedAt: (a.completed_at ?? null) as string | null, score: (a.score ?? null) as number | null,
      valid: (a.valid_response_count ?? null) as number | null, correct: (a.correct_response_count ?? null) as number | null, secondsLeft: left,
      href: `/app/tests/${a.id}`, resultHref: a.status === 'scored' ? `/app/tests/${a.id}/result` : null,
      policy: ((a.scoring_policy_version as string | null) ?? formPolicy.get(a.form_id as string) ?? null) as string | null,
    }
  })
  const [s1, s2] = [sessions.find(s => s.no === 1), sessions.find(s => s.no === 2)]
  const stage: RehearsalState['stage'] = !s1 || !s2 ? 'ready'
    : s1.phase === 'ended' && s2.phase === 'ended' ? 'complete'
    : s1.phase === 'ended' ? (s2.phase === 'not_started' || s2.phase === 'waiting' ? 'break' : 'session2')
    : s1.phase === 'not_started' ? 'ready' : 'session1'
  const live = [s1, s2].find(s => s && (s.phase === 'running' || s.phase === 'timed_out'))
  const next = stage === 'break' ? s2 : s1?.phase === 'not_started' ? s1 : null
  const primary = r.status === 'cancelled' || r.status === 'abandoned' ? null
    : stage === 'complete' ? { label: 'See the combined result', href: `/app/tests/rehearsal/${rehearsalId}` }
    : live ? { label: `Resume session ${live.no}`, href: live.href }
    : next ? { label: `Start session ${next.no}`, href: `/app/tests/rehearsal/${rehearsalId}` } : null
  return { id: rehearsalId, appointmentId: (r.appointment_id ?? null) as string | null, status: r.status as string, createdAt: r.created_at as string, stage, sessions, primary, serverNow: now.toISOString() }
}

export type StartSessionResult = { ok: true; started: boolean; deadlineAt: string; attemptId: string } | { ok: false; code: string; message: string }
const SESSION_MESSAGES: Record<string, string> = {
  NOT_FOUND: 'That session could not be found.', REHEARSAL_CLOSED: 'This rehearsal was cancelled or abandoned.', SESSION_ENDED: 'This session has already ended.',
  SESSION_1_OPEN: 'Finish session 1 before starting session 2.',
}
/** Explicit start of one session's clock. A repeat or concurrent call returns the same deadline. */
export async function startSession(userId: string, attemptId: string): Promise<StartSessionResult> {
  const { data, error } = await createAdminClient().rpc('start_rehearsal_session', { p_user: userId, p_attempt: attemptId })
  if (error) { console.error('[startSession]', error.message); return { ok: false, code: 'failed', message: 'Could not start the session. Nothing was started; try again.' } }
  const x = data as any
  if (x?.ok) return { ok: true, started: Boolean(x.started), deadlineAt: x.deadlineAt, attemptId }
  return { ok: false, code: x?.code ?? 'failed', message: SESSION_MESSAGES[x?.code] ?? 'Could not start the session.' }
}

/**
 * Brings a rehearsal's stored state up to date with the clock. A session whose time has run out is finalised from the answers
 * saved before the deadline (the omitted questions stay omitted, with no confidence and no diagnosis invented); a session with no
 * saved answer is closed as expired. Then the rehearsal is marked complete when both sessions have ended. Idempotent.
 * `db` is the student's own client: finalising is the student's own command.
 */
export async function settleRehearsal(db: SupabaseClient, userId: string, rehearsalId: string, now = new Date()): Promise<void> {
  const admin = createAdminClient()
  const { data: attempts } = await admin.from('assessment_attempts').select('id, status, deadline_at, session_no').eq('rehearsal_id', rehearsalId).eq('user_id', userId).throwOnError()
  for (const a of attempts ?? []) {
    if (ENDED.has(a.status as string) || !a.deadline_at) continue
    if (now.getTime() <= new Date(a.deadline_at as string).getTime() + 10_000) continue
    const { count } = await admin.from('assessment_responses').select('id', { count: 'exact', head: true }).eq('attempt_id', a.id as string).throwOnError()
    if (count === null) throw new Error('Could not count the rehearsal session answers.')
    if (count === 0) {
      await admin.from('assessment_attempts').update({ status: 'expired', completed_at: a.deadline_at, submitted_at: a.deadline_at, valid_response_count: 0, correct_response_count: 0 }).eq('id', a.id as string).in('status', ['ready', 'in_progress']).throwOnError()
    } else {
      const { error } = await db.rpc('finalize_assessment_attempt', { p_attempt_id: a.id, p_scoring_policy: '1.0', p_evidence_policy: EVIDENCE_POLICY_VERSION })
      if (error) throw new Error(error.message)
      await admin.from('assessment_attempts').update({ submitted_at: a.deadline_at }).eq('id', a.id as string).is('submitted_at', null).throwOnError()
    }
  }
  await syncRehearsalStatus(userId, rehearsalId)
}

/** complete when both sessions ended. Called after any submit as well. */
export async function syncRehearsalStatus(userId: string, rehearsalId: string): Promise<void> {
  const admin = createAdminClient()
  const { data: attempts } = await admin.from('assessment_attempts').select('status').eq('rehearsal_id', rehearsalId).eq('user_id', userId).throwOnError()
  if ((attempts ?? []).length === 2 && (attempts ?? []).every(a => ENDED.has(a.status as string))) {
    await admin.from('mock_rehearsals').update({ status: 'complete', completed_at: new Date().toISOString() }).eq('id', rehearsalId).eq('user_id', userId).in('status', ['ready', 'in_progress']).throwOnError()
    const { data: rehearsal } = await admin.from('mock_rehearsals').select('appointment_id').eq('id', rehearsalId).eq('user_id', userId).eq('status', 'complete').maybeSingle().throwOnError()
    if (rehearsal?.appointment_id) await admin.from('mock_appointments').update({ status: 'completed' }).eq('id', rehearsal.appointment_id as string).eq('user_id', userId).eq('status', 'planned').throwOnError()
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Combined result and debrief
// ---------------------------------------------------------------------------------------------------------------------------------
export type SessionSummary = {
  no: 1 | 2; attemptId: string; ended: 'scored' | 'expired'; questions: number
  /** Answered and valid (the numbers accuracy is computed from). */
  valid: number; correct: number; omitted: number; invalidated: number
  /** Headline score as a whole percent under the form's scoring policy (paper-score.1: correct / scoreable; legacy 1.0: correct / answered). */
  accuracy: number | null
  /** The session's ledger; null when its policy is unsupported. */
  ledger: Ledger | null
  answeredAccuracy: number | null; completion: number | null; scoreable: number; provisional: number; policy: string
  confidence: { high: number; medium: number; low: number; confidentMisses: number }
  activeMinutes: number; timedOut: boolean; resultHref: string | null
}
export type DebriefItem = { key: string; kind: 'gap' | 'timing' | 'fragile' | 'omitted'; title: string; why: string; support: string; threadId?: string }
export type RehearsalResult =
  | { complete: false; completedSessions: SessionSummary[]; remaining: { label: string; href: string } | null }
  | {
    complete: true; sessions: [SessionSummary, SessionSummary]
    combined: { valid: number; correct: number; omitted: number; invalidated: number; accuracy: number | null; answeredAccuracy: number | null; completion: number | null; scoreable: number; provisional: number; policy: string; questions: number; confidentMisses: number }
    debrief: { items: DebriefItem[]; capped: number; more: number; firstAction: { title: string; why: string } }
    credit: { cycleStart: string | null; cycleEnd: string | null; note: string }
    /** Attempts that were scored (an expired session has nothing to follow up). */
    scoredAttemptIds: string[]
  }

const MAX_DEBRIEF = 5

async function summarise(userId: string, s: SessionState): Promise<{ sum: SessionSummary; result: AttemptResult | null } | null> {
  const admin = createAdminClient()
  if (s.status === 'expired') {
    // Never answered and never scored: every delivered question is an omission. The policy and the size come from the reservation.
    const policy = s.policy ?? LEGACY_SCORING_POLICY
    const ledger = isSupportedPolicy(policy) ? buildLedger({ policy, delivered: Array.from({ length: s.questions }, (_, k) => String(k)), responses: [] }) : null
    return { result: null, sum: { no: s.no, attemptId: s.attemptId, ended: 'expired', questions: s.questions, valid: 0, correct: 0, omitted: s.questions, invalidated: 0, ledger,
      accuracy: ledger?.paperScore === null || !ledger ? null : Math.round(ledger.paperScore * 100), answeredAccuracy: null, completion: ledger ? 0 : null, scoreable: s.questions, provisional: 0, policy,
      confidence: { high: 0, medium: 0, low: 0, confidentMisses: 0 }, activeMinutes: 0, timedOut: true, resultHref: null } }
  }
  const r: AttemptResult | null = await getAttemptResult(userId, s.attemptId)
  if (!r) return null
  const { data: resp } = await admin.from('assessment_responses').select('is_correct, self_reported_confidence').eq('attempt_id', s.attemptId)
  const conf = { high: 0, medium: 0, low: 0, confidentMisses: 0 }
  for (const x of resp ?? []) {
    const c = x.self_reported_confidence as number | null
    if (c === null) continue
    if (c >= 4) { conf.high++; if (!x.is_correct) conf.confidentMisses++ } else if (c === 3) conf.medium++; else conf.low++
  }
  const o = r.analysis.overall
  // ONE ledger (voids removed once; a dispute stays scoreable but provisional). The old subtraction took disputed/challenged items off the denominator twice.
  const L = r.ledger, pct = (v: number | null) => v === null ? null : Math.round(v * 100)
  const timedOut = s.deadlineAt ? new Date(s.endedAt ?? s.deadlineAt).getTime() >= new Date(s.deadlineAt).getTime() - 1000 : false
  return { result: r, sum: {
    no: s.no, attemptId: s.attemptId, ended: 'scored', questions: SESSION_QUESTIONS, valid: L.correct + L.incorrect, correct: L.correct, omitted: L.omitted, invalidated: L.voided,
    accuracy: pct(L.paperScore), ledger: isSupportedPolicy(L.policy) ? L : null, answeredAccuracy: pct(L.answeredAccuracy), completion: pct(L.completion), scoreable: L.scoreable, provisional: L.provisional, policy: L.policy, confidence: conf, activeMinutes: o.activeMinutes, timedOut, resultHref: s.resultHref,
  } }
}

export async function getRehearsalResult(userId: string, rehearsalId: string): Promise<RehearsalResult | null> {
  const state = await getRehearsal(userId, rehearsalId)
  if (!state) return null
  const ended = state.sessions.filter(s => s.phase === 'ended')
  const rows = (await Promise.all(ended.map(s => summarise(userId, s)))).filter(Boolean) as { sum: SessionSummary; result: AttemptResult | null }[]
  const sums = rows.map(r => r.sum)
  if (state.stage !== 'complete' || sums.length !== 2) {
    return { complete: false, completedSessions: sums, remaining: state.primary }
  }
  const [a, b] = sums.sort((x, y) => x.no - y.no) as [SessionSummary, SessionSummary]
  const valid = a.valid + b.valid, correct = a.correct + b.correct
  // ONE combination contract (combineLedgers): counts are summed, never averaged from rounded percentages. Sessions scored under
  // different policies, or under an unsupported one, are NOT blended into a headline score: each is shown on its own.
  const merged = a.ledger && b.ledger ? combineLedgers([a.ledger, b.ledger]) : null
  const pc = (v: number | null | undefined) => v === null || v === undefined ? null : Math.round(v * 100)
  const combined = {
    valid, correct, omitted: a.omitted + b.omitted, invalidated: a.invalidated + b.invalidated, scoreable: a.scoreable + b.scoreable, provisional: a.provisional + b.provisional,
    accuracy: pc(merged?.paperScore), answeredAccuracy: merged ? pc(merged.answeredAccuracy) : null, completion: merged ? pc(merged.completion) : null,
    policy: merged ? merged.policy : 'mixed', questions: a.questions + b.questions, confidentMisses: a.confidence.confidentMisses + b.confidence.confidentMisses,
  }

  // Debrief: a SMALL set of evidence-backed items. Every item names its support; nothing is one block per wrong answer.
  const results = rows.map(r => r.result)   // already read once above; not recomputed
  const items: DebriefItem[] = []
  for (const r of results) {
    if (!r) continue
    for (const f of r.findings) {
      const key = `${f.kind}:${f.title}`
      if (items.some(i => i.key === key)) continue
      const kind: DebriefItem['kind'] = f.kind === 'misconception' ? 'gap' : f.kind === 'timing' ? 'timing' : f.kind === 'omitted' ? 'omitted' : 'fragile'
      if (f.kind === 'interrupted') continue
      items.push({ key, kind, title: f.title, why: f.interpretation, support: `Based on ${f.observations} question${f.observations === 1 ? '' : 's'}.` })
    }
  }
  const order = { gap: 0, timing: 1, fragile: 2, omitted: 3 } as const
  items.sort((x, y) => order[x.kind] - order[y.kind])
  const top = items.slice(0, MAX_DEBRIEF)
  const first = top[0]
  const { data: att } = await createAdminClient().from('assessment_attempts').select('completed_at').eq('rehearsal_id', rehearsalId).eq('session_no', 2).maybeSingle()
  const credit = await creditCycle(userId, (att?.completed_at ?? new Date().toISOString()) as string)
  return {
    complete: true, sessions: [a, b], combined,
    debrief: { items: top, capped: top.length, more: Math.max(0, items.length - top.length),
      firstAction: first ? { title: first.title, why: first.why } : { title: 'Keep your plan as it is', why: 'Nothing in either session was strong enough evidence to act on. A fresh check on anything you felt unsure about is the way to turn it into evidence.' } },
    credit, scoredAttemptIds: sums.filter(x => x.ended === 'scored').map(x => x.attemptId),
  }
}

/** The cycle that receives credit is the one in which the SECOND session was finalised. */
async function creditCycle(userId: string, completedAt: string) {
  const admin = createAdminClient()
  const { data: cycles } = await admin.from('planning_cycles').select('starts_at_local, ends_at_local, starts_at, ends_at').eq('user_id', userId).lte('starts_at', completedAt).gte('ends_at', completedAt).limit(1)
  const c = cycles?.[0]
  return c ? { cycleStart: c.starts_at_local as string, cycleEnd: c.ends_at_local as string, note: `Credit goes to the week of ${c.starts_at_local} to ${c.ends_at_local}, the week in which your second session was finished.` }
    : { cycleStart: null, cycleEnd: null, note: 'No open week covered the day your second session was finished, so it is not credited to a week.' }
}
