/**
 * Gate 0 (A/B/C): successful model interpretation keeps preparation context; the Coach context stage is bounded, aborts its reads and fences late work;
 * Calendar shows a failed progress read. Owned throwaway student, SIMULATED providers/loaders (nothing live is called, nothing here proves live wording).
 *   E2E_BASE_URL=http://localhost:3142 npx tsx scripts/coach-gate0-test.ts
 */
import { randomUUID } from 'node:crypto'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)
import { makeCheck, createStudent } from './lib/e2eSession'
import { interpret } from '../src/lib/coach/interpret'
import { createAdminClient } from '../src/lib/supabase/admin'

const { check, finish } = makeCheck()
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const made: string[] = []
const wait = (ms: number) => new Promise(r => setTimeout(r, ms))
const J = (o: object) => JSON.stringify({ version: 'coach-interp-schema.3', requests: [], excluded: [], correction: false, unresolved: [], clarification: null, ...o })

async function main() {
  const { runTurn } = await import('../src/lib/coach/turn')
  const { beginTurn, finishTurn } = await import('../src/lib/coach/service')
  const st = await createStudent(admin, 'g0', { onboard: true }); made.push(st.id)
  const uid = st.id, db = null as any
  await admin.from('coach_messages').delete().eq('user_id', uid)
  const baseSit = { today: '2026-11-13', todayOpen: [], repairs: [], cycle: null, load: {}, paper: 'none', closing: false }
  const world = (extra: object = {}) => (async (_u: string, intent: any) => ({ situation: { ...baseSit, intent, ...extra }, context: {}, pack: null, band: 'Insufficient evidence', todayTitles: [], unavailable: [] })) as any
  const moveWorld = (async (_u: string, intent: any) => ({ situation: { ...baseSit, intent, todayOpen: [{ id: 'a', title: 'A', revision: 1, durationMinutes: 30, execution: 'not_started', date: '2026-11-13' }],
    selectedTask: { id: 'a', title: 'A', revision: 1, date: '2026-11-13', minutes: 30, movable: true }, placement: { state: 'ok', date: '2026-11-14', dateLabel: 'Saturday 14 Nov', startsAt: '2026-11-14T10:00:00.000Z', startMinutes: 600, timeLabel: '10:00', windowed: true, exact: false, hasWindows: true } }, context: {}, pack: null, band: 'Insufficient evidence', todayTitles: [], unavailable: [] })) as any
  let k = 0; const key = () => `g0${Date.now().toString(36)}${k++}${Math.random().toString(36).slice(2, 6)}`
  const tables = ['plan_blocks', 'block_scope_confirmations', 'evidence_events', 'assessment_attempts', 'mock_outcomes', 'user_module_state', 'learning_activities'] as const
  const snap = async () => Object.fromEntries(await Promise.all(tables.map(async t => [t, (await admin.from(t).select('*', { count: 'exact', head: true }).eq('user_id', uid)).count ?? 0]))) as Record<string, number>
  const counted = (interp: string | (() => Promise<string>) | undefined) => { const log = { calls: 0 }; return { log, provider: async ({ system }: { system: string }) => { if (/You label a student/.test(system)) { log.calls++; return typeof interp === 'function' ? interp() : (interp ?? '') } return '{"reply":"unused"}' } } }
  const before = await snap()

  console.log('\n0A. Preparation context survives a SUCCESSFUL model interpretation\n')
  const REPRO = 'I have gone through every reading and revisited everything once; what would you suggest?'
  check('the reported reproduction is now preparation context before any model is asked', interpret(REPRO).preparation === true && !interpret(REPRO).intents.includes('log_learning'), JSON.stringify(interpret(REPRO)))
  const PARA = 'Honestly I have covered the lot and gone back over it, thoughts?'
  check('a paraphrase the grammar does not know is unresolved (so the model is consulted)', interpret(PARA).primary === 'free' && !interpret(PARA).preparation)
  const ok = counted(J({ requests: [{ capability: 'log_learning', negated: false, span: 'covered the lot' }] }))
  const a = await runTurn({ userId: uid, db, loadWorld: world(), message: PARA, turnKey: key(), provider: ok.provider })
  check('a schema-valid model log_learning without an explicit record request is demoted to planning context', ok.log.calls === 1 && a.body.source === 'model_interpreted' && a.body.intent === 'next', JSON.stringify({ s: a.body.source, i: a.body.intent }))
  check('the reply acknowledges it WITHOUT recording, and offers the canonical position editor, not "Record your study"', /have not changed your coverage, revision status or calendar/.test(a.body.reply) && a.body.links.some((l: any) => /onboarding\/position/.test(l.href)) && !a.body.links.some((l: any) => /Record your study/.test(l.label)) && (a.body.proposals ?? []).length === 0, a.body.reply?.slice(0, 120))
  const explicit = counted(J({ requests: [{ capability: 'log_learning', negated: false, span: 'record' }] }))
  const e = await runTurn({ userId: uid, db, loadWorld: world(), message: 'could you possibly record that I did some reading earlier somehow', turnKey: key(), provider: explicit.provider })
  check('an explicit "record ..." request stays a log request (link to the study log, no preparation acknowledgement)', e.body.intent === 'log_learning' && e.body.links.some((l: any) => /Record your study/.test(l.label)) && !/have not changed your coverage/.test(e.body.reply), JSON.stringify({ i: e.body.intent, l: e.body.links }))
  const neg = counted(J({ requests: [{ capability: 'log_learning', negated: true, span: 'been through every reading' }] }))
  const n = await runTurn({ userId: uid, db, loadWorld: world(), message: "I really haven't been through every reading yet, any advice for me?", turnKey: key(), provider: neg.provider })
  check('negated preparation: never a log, never treated as done; context only', !n.body.links.some((l: any) => /Record your study/.test(l.label)) && (n.body.proposals ?? []).length === 0)
  const flagged = counted(J({ requests: [], context: ['preparation'] }))
  const f = await runTurn({ userId: uid, db, loadWorld: world(), message: 'so that is where I am at right now, what now?', turnKey: key(), provider: flagged.provider })
  check('a validated "context":["preparation"] field alone is enough (ambiguous wording), still no write', f.body.intent === 'next' && /have not changed your coverage/.test(f.body.reply))
  const mixedMsg = 'I have covered the lot and gone back over it all, so move it to saturday and tell me what is next please'
  const mixed = counted(J({ requests: [{ capability: 'log_learning', negated: false, span: 'covered the lot' }, { capability: 'move_block', negated: false, span: 'move it' }] }))
  const m = await runTurn({ userId: uid, db, loadWorld: moveWorld, message: mixedMsg, turnKey: key(), provider: mixed.provider })
  check('a mixed message keeps the genuine move request (a reviewable preview) AND acknowledges the context', (m.body.proposals ?? []).length === 1 && m.body.proposals[0].kind === 'move_task' && /have not changed your coverage/.test(m.body.reply), JSON.stringify({ p: (m.body.proposals ?? []).length, i: m.body.intent, r: m.body.reply?.slice(0, 100) }))
  const bad = counted(J({ requests: [{ capability: 'log_learning', negated: false, span: 'a quote that is not in the message' }] }))
  const bm = await runTurn({ userId: uid, db, loadWorld: world(), message: PARA, turnKey: key(), provider: bad.provider })
  check('a misclassified/invalid model reading (span not in message) is discarded: no context claimed, no log', bm.body.source !== 'model_interpreted' && !/have not changed your coverage/.test(bm.body.reply) && !bm.body.links.some((l: any) => /Record your study/.test(l.label)))
  const failing: [string, any, boolean?][] = [['disabled', undefined, false], ['unreachable', async () => { throw new Error('ECONNREFUSED') }], ['malformed', async () => '{"requests":'], ['slow', () => new Promise<string>(r => setTimeout(() => r(J({})), 12_000))]]
  const outs: any[] = []
  for (const [name, interp, hasKey] of failing) {
    const p = interp === undefined ? undefined : (async () => interp()) as any   // the SAME failure at both the interpreter and the reply stage
    const r = await runTurn({ userId: uid, db, loadWorld: world(), message: PARA, turnKey: key(), provider: p, hasKey: hasKey ?? true }); outs.push(r)
    check(`${name} provider: deterministic fallback, no log link, no acknowledgement of state, no proposal`, r.status === 200 && r.body.fallback === true && !r.body.links.some((l: any) => /Record your study/.test(l.label)) && !/have not changed your coverage/.test(r.body.reply) && (r.body.proposals ?? []).length === 0, `${r.status} ${r.body.fallbackReason}`)
  }
  check('all failure paths leave the same links and permitted actions', new Set(outs.map(o => JSON.stringify(o.body.links))).size === 1)
  check('0A: zero unintended task, scope, evidence, attempt, mock or coverage writes across every turn above', JSON.stringify(await snap()) === JSON.stringify(before), JSON.stringify(await snap()))

  console.log('\n0B. The context stage is bounded, aborts its reads and fences late work\n')
  const never = (async () => new Promise(() => {})) as any
  let t0 = Date.now(); const k1 = key()
  const stalled = await runTurn({ userId: uid, db, loadWorld: never, message: 'What should I do today?', turnKey: k1, worldBudgetMs: 700 })
  check(`a never-resolving context loader gives a clear retryable outcome within the budget (${Date.now() - t0} ms)`, stalled.status === 503 && stalled.body.code === 'CONTEXT_TIMEOUT' && stalled.body.retry === true && stalled.body.turnKey === k1 && Date.now() - t0 < 4000, JSON.stringify(stalled.body))
  const props = async () => (await admin.from('coach_proposals').select('id', { count: 'exact', head: true }).eq('user_id', uid)).count ?? 0
  const propsBase = await props()
  const msgs = async (kk: string, role?: string) => (await admin.from('coach_messages').select('id, role, lease_until').eq('user_id', uid).eq('turn_key', kk).match(role ? { role } : {})).data ?? []
  check('the question is preserved exactly once, with no answer and no proposal', (await msgs(k1, 'student')).length === 1 && (await msgs(k1, 'coach')).length === 0 && (await props()) === propsBase)
  check('the lease was released, so the retry is not told to wait', ((await msgs(k1, 'student'))[0].lease_until ?? '') <= new Date().toISOString())
  const retry = await runTurn({ userId: uid, db, loadWorld: world(), message: 'What should I do today?', turnKey: k1 })
  check('a retry with the SAME key answers, and still exactly one student message and one coach answer exist', retry.status === 200 && (await msgs(k1, 'student')).length === 1 && (await msgs(k1, 'coach')).length === 1, String(retry.status))
  const again = await runTurn({ userId: uid, db, loadWorld: world(), message: 'What should I do today?', turnKey: k1 })
  check('a further duplicate retry replays the stored answer: nothing new', again.body.replayed === true && (await msgs(k1)).length === 2)

  // Late completion: a loader that finishes AFTER the budget must not be used.
  const k2 = key(); let resolved = false
  const late = (async (u: string, intent: any) => { await wait(1500); resolved = true; return await moveWorld(u, intent) }) as any
  const lateRun = await runTurn({ userId: uid, db, loadWorld: late, message: 'Move it to saturday', turnKey: k2, worldBudgetMs: 500 })
  await wait(2200)
  check('a loader that completes after the deadline is discarded: no coach message, no proposal appears later', lateRun.status === 503 && resolved && (await msgs(k2, 'coach')).length === 0 && (await props()) === propsBase)

  // Delayed database read: the budget ABORTS the underlying request.
  const realFetch = globalThis.fetch; let sawAbort = false, started = 0
  globalThis.fetch = ((input: any, init?: any) => {
    const url = String(typeof input === 'string' ? input : input?.url ?? input)
    if (!/\/rest\/v1\/exam_windows/.test(url)) return realFetch(input, init)
    started++
    return new Promise((_, reject) => { const s: AbortSignal | undefined = init?.signal; if (!s) return; const hit = () => { sawAbort = true; reject(Object.assign(new Error('aborted'), { name: 'AbortError' })) }; if (s.aborted) hit(); else s.addEventListener('abort', hit) })
  }) as typeof fetch
  const k3 = key(); t0 = Date.now()
  const slowRead = (async () => { await createAdminClient().from('exam_windows').select('id').limit(1).throwOnError(); return await world()(uid, 'today') }) as any
  const sr = await runTurn({ userId: uid, db, loadWorld: slowRead, message: 'What should I do today?', turnKey: k3, worldBudgetMs: 600 })
  globalThis.fetch = realFetch
  check(`a delayed database read is ABORTED at the budget, not merely ignored (${Date.now() - t0} ms)`, started === 1 && sawAbort && sr.status === 503 && sr.body.code === 'CONTEXT_TIMEOUT', JSON.stringify({ started, sawAbort, s: sr.status }))

  // Lease expiry / elapsed-time jump: the old worker is fenced out and cannot finish.
  const k4 = key(), hash = 'h'.repeat(16)
  const first = await beginTurn(uid, k4, 'What should I do today?', 'today', 40, hash)
  await admin.from('coach_messages').update({ lease_until: new Date(Date.now() - 3_600_000).toISOString() }).eq('user_id', uid).eq('turn_key', k4).eq('role', 'student')   // simulated elapsed-time jump of an hour
  const second = await beginTurn(uid, k4, 'What should I do today?', 'today', 40, hash)
  const oldFinish = await finishTurn(uid, k4, first.token!, 'late answer from the expired worker', 'today', [], null, [], { interpreter: 'x', prompt: null, fallback: true, fallbackReason: null, source: 'deterministic', pending: null } as any)
  check('after the lease expires the retry takes over and the expired worker is FENCED (it cannot add an answer or proposal)', first.state === 'new' && second.state === 'resume' && oldFinish.error === 'FENCED' && (await msgs(k4, 'coach')).length === 0, JSON.stringify({ a: first.state, b: second.state, f: oldFinish }))
  const newFinish = await finishTurn(uid, k4, second.token!, 'answer from the live worker', 'today', [], null, [], { interpreter: 'x', prompt: null, fallback: true, fallbackReason: null, source: 'deterministic', pending: null } as any)
  const dup = await beginTurn(uid, k4, 'What should I do today?', 'today', 40, hash)
  check('the live worker finishes once; a duplicate begin now replays and creates no second student message', !!newFinish.coachId && dup.state === 'replay' && (await msgs(k4, 'student')).length === 1)
  const simultaneous = await Promise.all([...Array(4)].map(() => runTurn({ userId: uid, db, loadWorld: world(), message: 'What should I do next?', turnKey: 'g0same-' + k4 })))
  check('four simultaneous sends of one key: one student message and one answer', (await msgs('g0same-' + k4, 'student')).length === 1 && (await msgs('g0same-' + k4, 'coach')).length === 1 && simultaneous.some(r => r.status === 200), simultaneous.map(r => r.status).join())
  const timing = (await admin.from('coach_messages').select('turn_meta').eq('user_id', uid).eq('turn_key', k1).eq('role', 'coach')).data?.[0]?.turn_meta as any
  console.log(`  server stage timings of the recovered turn (ms, measured by the server, separate from any browser/environment pause): ${JSON.stringify(timing?.timings)}`)

  console.log('\n0C. Calendar shows a failed progress read (and keeps unknown, zero, unavailable and not-requested apart)\n')
  const { PaperStrip } = await import('../src/components/calendar/PaperStrip')
  const preview = { scope: { excluded: [], totals: { outcomes: 3 } } } as any
  const state = { primary: { kind: 'start', deliverable: 20, needed: 10, blocked: null, stale: false }, paperLabel: 'Weekly diagnostic', planned: null } as any
  const html = (signals: any) => renderToStaticMarkup(createElement(PaperStrip, { preview, state, signals, retryHref: '/app/calendar?week=2026-11-16' }))
  const failed = html(null), zero = html({ execution: { pressure: 'none' } }), pressured = html({ execution: { pressure: 'high' } })
  check('a failed read renders a compact unavailable state with a retry link, and the paper facts remain', /data-testid="calendar-signals-unavailable"/.test(failed) && /Try again/.test(failed) && /href="\/app\/calendar\?week=2026-11-16"/.test(failed) && /20/.test(failed))
  check('a known zero/none is NOT shown as unavailable', !/calendar-signals-unavailable/.test(zero))
  check('a known value still renders its own message', /needs a decision at weekly review/.test(pressured) && !/calendar-signals-unavailable/.test(pressured))
  const bank = html({ execution: { pressure: 'none' } }).length > 0 && /This week/.test(renderToStaticMarkup(createElement(PaperStrip, { preview, state: { ...state, primary: { ...state.primary, blocked: 'x' } }, signals: { execution: { pressure: 'none' } } as any })))
  check('bank-unavailable is its own state (assessment availability link), separate from a failed read', bank && /View assessment availability/.test(renderToStaticMarkup(createElement(PaperStrip, { preview, state: { ...state, primary: { ...state.primary, blocked: 'x' } }, signals: { execution: { pressure: 'none' } } as any }))))
}

main().catch(e => { console.error(e); process.exitCode = 1 }).finally(async () => {
  for (const id of made) await admin.auth.admin.deleteUser(id).catch(() => {})
  console.log(`cleaned ${made.length} owned student(s)`)
  finish()
})
