/**
 * Home, Calendar, the /app/review-week render and the weekly-review preview POST, timed and counted separately, on the isolated local stack.
 * Four personas, one method (same account setup, one worker, sequential, N warm samples each): on track (the review answers every task done), catching
 * up (one week answered not done), choosing formal recovery (four missed weeks accepted, then a path chosen) and a long history that still owes work
 * (HISTORY_WEEKS reviewed weeks, part logged and part carried). Every persona's latest week is unreviewed, so Home and Calendar see owed work in all four.
 * PERSONAS=a,b limits the run. Needs the production-style app started with TRACE_READS=1 and E2E_READ_TRACE pointing at its log.
 * Fixture student only, deleted by id; the time fixture only touches this run-owned student (see scripts/lib/timeFixture.ts).
 */
import { createClient } from '@supabase/supabase-js'
import { createStudent, createSession } from './lib/e2eSession'
import { shiftStudentTimeline } from './lib/timeFixture'
import fs from 'node:fs'
const trace = process.env.E2E_READ_TRACE!, url = process.env.NEXT_PUBLIC_SUPABASE_URL!
if (process.env.LOCAL_STACK !== '1' || !/^http:\/\/127\.0\.0\.1:\d+$/.test(new URL(url).origin) || !trace) throw new Error('Local stack only: source its stack.env and set E2E_READ_TRACE.')
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const N = Number(process.env.SAMPLES ?? 15)
const q = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]) }
let last: string[] = []
const count = (at: number) => fs.readFileSync(trace).subarray(at).toString().split('\n').filter(l => /^\[reads\] /.test(l))
async function once(fn: () => Promise<Response | { status: number; body?: unknown }>) {
  const at = fs.statSync(trace).size, t = performance.now(), r = await fn()
  const ms = performance.now() - t
  const lines = count(at)
  last = lines
  return { ms, status: (r as any).status as number, reads: lines.filter(l => / (GET|HEAD) /.test(l)).length, rpcs: lines.filter(l => / POST rpc\//.test(l)).length }
}
const ALL = ['on_track', 'catching_up', 'recovery', 'history_debt'] as const
const PERSONAS = (process.env.PERSONAS ? ALL.filter(p => process.env.PERSONAS!.split(',').includes(p)) : ALL) as readonly (typeof ALL)[number][]
const HISTORY_WEEKS = Number(process.env.HISTORY_WEEKS ?? 8)
async function persona(kind: (typeof PERSONAS)[number], owned: string[]) {
  const st = await createStudent(admin, 'rvw', { onboard: true, register: id => owned.push(id) })
  const s = createSession(admin, st.email); if (!(await s.signIn())) throw new Error('sign-in failed')
  const cycleId = async () => (await admin.from('planning_cycles').select('id').eq('user_id', st.id).eq('status', 'active').single()).data!.id as string
  const due = async (c: string) => (await admin.from('plan_blocks').select('id').eq('user_id', st.id).eq('cycle_id', c).is('cancelled_at', null).in('execution', ['not_started', 'in_progress', 'partial', 'deferred'])).data ?? []
  const body = async (happened: 'completed' | 'not_done', extra: Record<string, unknown> = {}) => {
    const c = await cycleId()
    return { cycleId: c, choices: Object.fromEntries((await due(c)).map(t => [t.id, happened === 'completed' ? { happened } : { happened, next: 'continue' }])), acknowledgeNoPaper: true, ...extra }
  }
  if (kind === 'recovery') for (let w = 0; w < 4; w++) {
    await shiftStudentTimeline(st.id, 1, owned)
    const p = await s.post('/api/weekly-review/preview', await body('not_done'))
    const a = await s.post('/api/weekly-review/accept', { draftId: (p.body as any).draftId })
    if (!(a.body as any)?.ok) throw new Error(`setup accept failed: ${JSON.stringify(a.body).slice(0, 200)}`)
  }
  let history: { reviewedWeeks: number; loggedSessions: number } | null = null
  if (kind === 'history_debt') {
    let logged = 0
    for (let w = 0; w < HISTORY_WEEKS; w++) {
      // Half the week's study is logged through the real command; the rest is carried by the real review.
      const { data: blocks } = await admin.from('plan_blocks').select('id, revision, lm_id, outcome_id').eq('user_id', st.id).eq('cycle_id', await cycleId()).eq('task_type', 'study').eq('execution', 'not_started').is('cancelled_at', null).order('id')
      for (const b of (blocks ?? []).filter((_, i) => i % 2 === 0)) {
        const o = b.outcome_id ?? (await admin.from('reading_los').select('id').eq('reading_id', b.lm_id!).order('sequence').limit(1).single()).data!.id
        const r = await s.post('/api/log-learning/planned', { task_id: b.id, expected_revision: b.revision, execution: 'completed', duration_minutes: 40, outcome_ids: [o], idempotency_key: crypto.randomUUID() })
        if ((r.body as any)?.ok !== true) throw new Error(`setup log failed: ${JSON.stringify(r.body).slice(0, 200)}`)
        logged++
      }
      await shiftStudentTimeline(st.id, 1, owned)
      const p = await s.post('/api/weekly-review/preview', await body('not_done'))
      const a = await s.post('/api/weekly-review/accept', { draftId: (p.body as any).draftId })
      if (!(a.body as any)?.ok) throw new Error(`setup accept failed (week ${w + 1}): ${JSON.stringify(p.body).slice(0, 200)} ${JSON.stringify(a.body).slice(0, 200)}`)
    }
    history = { reviewedWeeks: HISTORY_WEEKS, loggedSessions: logged }
  }
  await shiftStudentTimeline(st.id, 1, owned)        // the accepted week is now a week old: the review is due
  const request = await body(kind === 'on_track' ? 'completed' : 'not_done', kind === 'recovery' ? { recoveryPath: 'protect_core' } : {})
  const rows: Record<string, { ms: number; status: number; reads: number; rpcs: number }[]> = {}
  const keep = (name: string) => { if (process.env.CALLERS_OUT) fs.writeFileSync(`${process.env.CALLERS_OUT}-${kind}-${name.replace(/\W+/g, '_')}.txt`, last.join('\n')) }
  for (const path of ['/app', '/app/calendar', '/app/review-week']) {
    const page = () => s.req(path).then(async r => { await r.arrayBuffer(); return r })
    await once(page)   // warm the route
    const out: { ms: number; status: number; reads: number; rpcs: number }[] = rows[`GET ${path}`] = []
    for (let i = 0; i < N; i++) out.push(await once(page))
    keep(`GET ${path}`)
  }
  const preview = () => s.post('/api/weekly-review/preview', request)
  const first = await preview()
  const recovery = (first.body as any)?.next?.recovery
  const level = recovery?.status?.level ?? 'on_track'
  const expected = kind === 'on_track' ? 'on_track' : kind === 'catching_up' ? 'catching_up' : kind === 'recovery' ? 'recovery_offered' : null
  if ((expected ? level !== expected : level === 'on_track') || (kind === 'recovery' && recovery.chosenPath !== 'protect_core')) throw new Error(`persona ${kind} is ${level}, not ${expected}: ${JSON.stringify(first.body).slice(0, 300)}`)
  await once(preview)
  const posted: { ms: number; status: number; reads: number; rpcs: number }[] = rows['POST /api/weekly-review/preview'] = []
  for (let i = 0; i < N; i++) posted.push(await once(preview))
  keep('POST preview')
  const size = async (t: string) => (await admin.from(t).select('id', { count: 'exact', head: true }).eq('user_id', st.id)).count
  return { level, rows, answers: Object.keys(request.choices).length, history, rowsOwned: { planBlocks: await size('plan_blocks'), taskEvents: await size('task_events') } }
}
async function main() {
  const owned: string[] = [], out: any[] = [], raw: Record<string, unknown> = {}
  try {
    for (const kind of PERSONAS) {
      const r = await persona(kind, owned)
      raw[kind] = r
      for (const [k, v] of Object.entries(r.rows)) out.push({ persona: kind, level: r.level, request: k, n: v.length, statuses: [...new Set(v.map(x => x.status))].join('/'), reads: q(v.map(x => x.reads), .5), rpcs: q(v.map(x => x.rpcs), .5), p50ms: q(v.map(x => x.ms), .5), p95ms: q(v.map(x => x.ms), .95) })
    }
    console.table(out)
    fs.writeFileSync(process.env.OUT ?? 'docs/evidence/phase5-review-trace-stack.json', JSON.stringify({ at: new Date().toISOString(), samples: N, rows: out, raw }, null, 2))
  } finally { for (const id of owned) await admin.auth.admin.deleteUser(id) }
}
main().catch(e => { console.error(e); process.exit(1) })
