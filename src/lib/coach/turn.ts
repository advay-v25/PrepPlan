import { createHash, randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '../supabase/admin'
import { deterministicReply, planLinks, planProposals, type CoachIntent } from './actions'
import { interpret } from './interpret'
import { interpretWithModel } from './interpretModel'
import { isAffirmation, mergePending } from './context'
import { makeGateway } from './modelGateway'
import { modelReply, type Provider } from './model'
import { INTERPRETER_PROMPT_VERSION } from './prompts'
import { buildCoachContext, COACH_PROMPT_VERSION } from './response'
import { beginTurn, decideProposal, finishTurn, loadCoachWorld, loadHistory, loadLastTurn, loadTurnAnswer, reserveModelCall, settleModelCall, type PendingContext, type TurnMeta } from './service'
import { dayLabel } from './move'
import { INTERPRETER_VERSION } from './interpret'
import { boundedStage, BudgetExceeded } from '../ops/requestBudget'

/** The Coach's context stage must finish inside this, or the question is kept and the student is asked to retry (nothing is guessed). */
export const WORLD_BUDGET_MS = 25_000

/** A cost and abuse guard, generous for a student and small for a script. The turn allowance counts a student turn once; model requests are counted separately. */
export const HOURLY_TURNS = 40
export const HOURLY_MODEL_CALLS = 60

/** The server decides. A hint wins only to break a tie between intents the message really contains; it can never add one. */
export function resolveIntent(message: string, hint?: string): { intent: CoachIntent; teaching: boolean; correction: boolean; when: string | null; hintIgnored: boolean } {
  const i = interpret(message)
  const hinted = hint && (i.intents as string[]).includes(hint) ? (hint as CoachIntent) : null
  return { intent: hinted ?? i.primary, teaching: i.teaching, correction: i.correction, when: i.when, hintIgnored: Boolean(hint) && !hinted && hint !== i.primary }
}

export type TurnInput = { userId: string; db: SupabaseClient; message: string; hint?: string; attemptId?: string; taskId?: string; readingId?: string; reportId?: string; turnKey?: string; provider?: Provider; hasKey?: boolean
  /** Test seam: the world loader. Production uses loadCoachWorld, which needs a request scope. */
  loadWorld?: typeof loadCoachWorld
  /** Test seam only (server-side callers); the HTTP route never passes it, so no request can change the budget. */
  worldBudgetMs?: number }
export type TurnResult = { status: number; body: Record<string, any> }

const hashOf = (m: string, taskId?: string, attemptId?: string, readingId?: string, reportId?: string) => createHash('sha256').update(JSON.stringify({ m, t: taskId ?? null, a: attemptId ?? null, r: readingId ?? null, ...(reportId ? { p: reportId } : {}) })).digest('hex')

function replayBody(turnKey: string, m: NonNullable<Awaited<ReturnType<typeof loadTurnAnswer>>>) {
  // Authoritative stored metadata: a replay never claims a fresh model answer, and reports the versions that actually produced it.
  return { ok: true, replayed: true, turnKey, reply: m.body, fallback: m.meta?.fallback ?? false, fallbackReason: m.meta?.fallbackReason ?? null, source: m.meta?.source ?? null,
    interpreterVersion: m.meta?.interpreter ?? null, promptVersion: m.meta?.prompt ?? null, intent: m.intent, links: m.links, proposals: m.proposals, messageId: m.id }
}

function receiptSentence(r: Awaited<ReturnType<typeof decideProposal>>, title: string): string {
  if (!r.ok) return r.code === 'STALE' ? `${r.error}` : 'That could not be confirmed, and nothing was changed. Check Calendar, then ask again.'
  const pl = r.effects?.placement
  if (pl) return `Done. It is now on ${dayLabel(pl.toDate)}${pl.startsAt ? '' : ' with no set time'}. Open it in Calendar to see it there.`
  const n = r.applied ?? r.effects?.deferred ?? 0
  return `Done. ${n} task${n === 1 ? ' is' : 's are'} set aside for now and stay due.${r.effects?.placedMinutes ? ` ${r.effects.placedMinutes} minutes were placed on later sessions.` : ' Nothing has been placed on another day yet.'}`
}

export async function runTurn(input: TurnInput): Promise<TurnResult> {
  const { userId, db, message } = input
  const turnKey = input.turnKey ?? randomUUID()
  const admin = createAdminClient()
  // Stage timings (ms), kept with the turn; with TRACE_READS=1 they are logged between the [reads] lines so reads per stage can be counted.
  const stages: Record<string, number> = {}; let lastLap = Date.now()
  const lap = (k: string) => { const n = Date.now(); stages[k] = (stages[k] ?? 0) + n - lastLap; lastLap = n }
  if (process.env.TRACE_READS === '1') console.log(`[coach-turn] start ${turnKey}`)
  const det = interpret(message)
  try {
    const turn = await beginTurn(userId, turnKey, message, resolveIntent(message, input.hint).intent, HOURLY_TURNS, hashOf(message, input.taskId, input.attemptId, input.readingId, input.reportId))
    lap('admission')
    if (turn.state === 'limited') return { status: 429, body: { error: 'That is a lot of questions in an hour. Give it a little while, then ask again.' } }
    if (turn.state === 'conflict') return { status: 409, body: { code: 'TURN_KEY_CONFLICT', error: 'That retry does not match the question it was started with, so nothing new was done. Send it as a new question.' } }
    if (turn.state === 'replay' && turn.coachId) {
      const m = await loadTurnAnswer(userId, turn.coachId)
      if (m) return { status: 200, body: replayBody(turnKey, m) }
    }
    if (turn.state === 'busy' || !turn.token) return { status: 202, body: { busy: true, turnKey, retryAfterMs: 1500 } }
    const token = turn.token

    // The one outstanding clarification or proposal from the last answer (recent only) gives short follow-ups their meaning.
    const last = await loadLastTurn(userId).catch(() => null)
    const pending = last?.meta?.pending ?? null
    const pendingProposals = (last?.proposals ?? []).filter(p => p.status === 'pending')
    lap('last_turn')

    // "yes": confirms exactly one fresh, visible proposal through the same command as the button; otherwise it asks.
    if (isAffirmation(message)) {
      const reply0 = pendingProposals.length === 1 ? receiptSentence(await decideProposal(db, userId, pendingProposals[0].id, 'accept'), pendingProposals[0].title)
        : pendingProposals.length === 0 ? 'Nothing is waiting for your confirmation. What would you like to change?'
        : 'Two suggestions are waiting, so I will not guess. Use the Confirm button on the one you mean.'
      const meta: TurnMeta = { interpreter: INTERPRETER_VERSION, prompt: null, fallback: false, fallbackReason: 'affirmation', source: 'deterministic', pending: null }
      lap('confirm')
      return done(userId, turnKey, token, reply0, 'free', [], null, [], meta)
    }

    const merged = mergePending(det, pending, message, input.taskId ?? null)
    let intent: CoachIntent = merged.intent !== det.primary ? merged.intent : resolveIntent(message, input.hint).intent
    const taskId = merged.taskId ?? input.taskId ?? undefined
    let when = merged.when
    let { teaching, correction } = det
    let preparation = det.preparation === true
    let source: TurnMeta['source'] = 'deterministic'
    let clarify: string | null = null

    const gateway = makeGateway({ reserve: () => reserveModelCall(userId, turnKey, token, HOURLY_MODEL_CALLS), settle: (id, s) => settleModelCall(userId, id, s) })

    // Unresolved wording only: a bounded model reading, validated and re-resolved by the server. A clear, simple request never reaches it.
    // A MATCHED request that is negated, multi-intent or multi-clause is reviewed too: a keyword match must not hide a question that needs asking.
    // The review can only remove a request the student negated, add a note about an excluded part, or hold previews while one question is asked;
    // it never replaces a matched request with another.
    let interpretReason: string | null = null, holdActions = false, exclusions: NonNullable<ReturnType<typeof interpret>['exclusions']> = []
    const words = message.trim().split(/\s+/).length
    const complex = intent !== 'free' && intent !== 'teach' && !teaching && merged.reason !== 'choice' && words >= 3 &&
      (det.negated.length > 0 || det.intents.length > 1 || (words >= 14 && /[;,]|\b(?:and|but|also|then|instead)\b/.test(det.normalised)))
    if ((intent === 'free' && !teaching && words >= 3) || complex) {
      const r = await interpretWithModel({ message, base: det, gateway, provider: input.provider, hasKey: input.hasKey })
      if (r.ok && r.resolved) {
        const ri = r.resolved.interpretation
        exclusions = ri.exclusions ?? []
        if (intent === 'free') {
          preparation = ri.preparation === true; intent = ri.primary === 'teach' ? 'teach' : ri.primary; teaching = ri.teaching; correction = ri.correction; when = ri.when ?? when
          clarify = r.resolved.clarify; source = 'model_interpreted'
        } else {
          if (ri.preparation) preparation = true
          const dropped = ri.negated.includes(intent) && !ri.intents.includes(intent)
          if (dropped) intent = det.intents.find(i => i !== intent && !ri.negated.includes(i)) ?? 'free'
          if (r.resolved.clarify) { clarify = r.resolved.clarify; holdActions = true }
          if (dropped || clarify || exclusions.length) source = 'model_interpreted'
        }
      } else if (!r.ok) interpretReason = r.reason
    }
    lap('interpret')
    if (merged.amends && pendingProposals.length) {
      // The student changed the target: an old preview must not stay confirmable.
      await admin.from('coach_proposals').update({ status: 'rejected', decided_at: new Date().toISOString() }).in('id', pendingProposals.map(p => p.id)).eq('user_id', userId).eq('status', 'pending')
    }

    let world: Awaited<ReturnType<typeof loadCoachWorld>>
    try { world = await boundedStage('coach context', input.worldBudgetMs ?? WORLD_BUDGET_MS, () => (input.loadWorld ?? loadCoachWorld)(userId, intent, new Date(), input.attemptId, { taskId, when, readingId: input.readingId, reportId: input.reportId, message })) }
    catch (error) {
      const timedOut = error instanceof BudgetExceeded
      console.error(timedOut ? `Coach context exceeded its budget (${(error as BudgetExceeded).ms} ms); reads aborted, late result discarded` : 'Coach context unavailable', timedOut ? '' : error)
      // Free the lease NOW (fenced to this worker's token) so the student's retry with the same key resumes at once instead of waiting out the lease;
      // this worker can no longer finish the turn, so abandoned work can never add a message or proposal.
      await admin.from('coach_messages').update({ lease_until: new Date().toISOString() }).eq('user_id', userId).eq('turn_key', turnKey).eq('role', 'student').eq('lease_token', token)
      return { status: 503, body: { code: timedOut ? 'CONTEXT_TIMEOUT' : 'CONTEXT_UNAVAILABLE', error: 'Your current plan could not be checked in time. Your question is saved; send it again to retry.', turnKey, retry: true } }
    }

    lap('world')
    world.situation.preparation = preparation
    const { proposals: drafts, notes } = planProposals(world.situation)
    if (holdActions) drafts.length = 0
    const links = planLinks(world.situation)
    let reply = deterministicReply(world.situation, world.band, notes, drafts)
    lap('plan')
    let fallback = intent !== 'free'
    let fallbackReason: string | null = intent === 'free' ? interpretReason : (source === 'model_interpreted' ? 'interpreted' : 'verified_intent')
    let promptUsed: string | null = source === 'model_interpreted' ? INTERPRETER_PROMPT_VERSION : null
    const exclusionOnly = intent === 'free' && exclusions.length > 0
    if (exclusionOnly) { fallback = true; fallbackReason = 'exclusion_clarified' }
    if (intent === 'free' && !exclusionOnly) {
      // Earlier refusals and the teaching requests behind them are left out: with them in view the model copied the refusal onto a legitimate study-method question (seen in the browser, 13 Nov).
      const history = (await loadHistory(userId, 8)).slice(0, -1).filter(h => h.role === 'coach' ? !/does not teach|can’t teach the chapter/.test(h.body) && h.intent !== 'teach' : !interpret(h.body).teaching && h.intent !== 'teach').map(h => ({ role: h.role === 'coach' ? 'assistant' as const : 'user' as const, content: h.body }))
      const ctx = buildCoachContext(world.situation, world.band, { proposals: drafts.map(d => d.title), links: links.map(l => l.label) }, [...(world.pack?.unknowns ?? []), ...world.unavailable.map(u => `${u} could not be read`)])
      const out = await modelReply({ ctx, history, message, gateway, provider: input.provider, hasKey: input.hasKey })
      if (out.reply) { reply = out.reply; fallback = false; source = 'model_reply'; promptUsed = COACH_PROMPT_VERSION; fallbackReason = null } else { fallback = true; fallbackReason = out.reason; console.warn(`[coach ${COACH_PROMPT_VERSION}] model reply not used: ${out.reason}`) }
    }
    lap('reply_model')
    if (exclusionOnly) reply = 'I plan and review your study; I do not explain or solve curriculum content, and I will not guess that you want planning help. ' + (exclusions[0].span ? `I read “${exclusions[0].span}” as a request to explain material. ` : 'I read part of your message as a request to explain material. ') + 'If you meant how to plan or review that topic, say so and I will help with that.'
    else if (exclusions.length && !teaching) reply = `${reply} I answered the planning part. ${exclusions[0].span ? `I left “${exclusions[0].span}” unanswered` : 'I left one part unanswered'} because it reads as a request to explain material, which I do not do; tell me if you meant planning help.`
    if (holdActions && clarify) reply = clarify
    else if (clarify && !drafts.length) reply = `${reply} ${clarify}`
    if (teaching && intent !== 'teach') reply = `${reply} I can’t teach the chapter itself — use your course material for that, and I’ll plan around it.`
    if (correction) reply = `Understood — I won’t treat today as missed, and nothing was changed. ${reply}`
    if (merged.amends) reply = `Understood — I have dropped the earlier suggestion. ${reply}`
    if (world.unavailable.length) reply = `${reply} I could not read ${world.unavailable.join(' or ')} just now, so I am not describing ${world.unavailable.length === 1 ? 'it' : 'them'}.`

    const sel = world.situation.selectedTask
    const outstanding = intent === 'move_block' && (!drafts.length)
    const nextPending: PendingContext | null = intent === 'move_block'
      ? { intent, taskId: sel?.id ?? null, taskChoices: world.situation.taskChoices?.map(c => c.id), when, asked: outstanding ? (notes[0] ?? '') : '' } : null
    const meta: TurnMeta = { interpreter: INTERPRETER_VERSION, prompt: promptUsed, fallback, fallbackReason, source, pending: nextPending, timings: stages }
    const { data: cycle } = await admin.from('planning_cycles').select('id').eq('user_id', userId).eq('status', 'active').maybeSingle()
    lap('cycle')
    return done(userId, turnKey, token, reply, intent, links, (cycle?.id as string) ?? null, drafts, meta, intent === 'teach' || teaching)
  } catch (error) {
    console.error('Coach failed', error)
    return { status: 500, body: { error: 'The Coach could not respond. Your question is saved; send it again to retry.', turnKey, retry: true } }
  }
}

async function done(userId: string, turnKey: string, token: string, reply: string, intent: CoachIntent, links: { label: string; href: string }[], cycleId: string | null, drafts: any[], meta: TurnMeta, teaching = false): Promise<TurnResult> {
  const t = Date.now()
  const fin = await finishTurn(userId, turnKey, token, reply, intent, links, cycleId, drafts, meta)
  if (process.env.TRACE_READS === '1') console.log(`[coach-turn] end ${turnKey} ${JSON.stringify({ ...meta.timings, finish: Date.now() - t, intent, source: meta.source })}`)
  if (fin.error === 'NO_TURN') return { status: 409, body: { code: 'CLEARED', error: 'This conversation was cleared while I was answering, so nothing was added.' } }
  if (fin.error === 'FENCED' || !fin.coachId) return { status: 202, body: { busy: true, turnKey, retryAfterMs: 1500 } }
  const stored = await loadTurnAnswer(userId, fin.coachId)
  if (!stored) return { status: 202, body: { busy: true, turnKey, retryAfterMs: 1500 } }
  if (fin.replayed) return { status: 200, body: replayBody(turnKey, stored) }
  return { status: 200, body: { ok: true, replayed: false, turnKey, reply: stored.body, fallback: meta.fallback, fallbackReason: meta.fallbackReason, source: meta.source, interpreterVersion: meta.interpreter, promptVersion: meta.prompt,
    ...(teaching ? { boundary: 'planning_not_tutoring' } : {}), intent, links: stored.links, proposals: stored.proposals, messageId: fin.coachId } }
}
