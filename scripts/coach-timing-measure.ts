/**
 * Coach latency, by class, with stage timings and database read counts. Needs the dev server started with TRACE_READS=1 and its log path.
 *   E2E_BASE_URL=http://localhost:3141 npx tsx scripts/coach-timing-measure.ts <dev.log> [samples]
 * Classes: simple next action (deterministic), interpreted clarification (bounded LIVE model reading + reply), preview, confirmation ("yes").
 * Uses one ORDINARY throwaway student, removed afterwards. Dev-server numbers (cold compiles included in the first sample, reported as max).
 */
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)
import { createStudent } from './lib/e2eSession'

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const logPath = process.argv[2], N = Number(process.argv[3] ?? 5)
const made: string[] = []
const addDays = (d: string, n: number) => new Date(new Date(`${d}T12:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10)
const pct = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)] }

function reads(key: string) {
  const lines = fs.readFileSync(logPath, 'utf8').split('\n')
  const a = lines.findIndex(l => l.includes(`[coach-turn] start ${key}`)), b = lines.findIndex(l => l.includes(`[coach-turn] end ${key}`))
  if (a < 0 || b < 0) return { reads: null as number | null, stages: null as any }
  const by: Record<string, number> = {}
  for (const l of lines.slice(a, b).filter(l => l.startsWith('[reads]'))) { const k = l.split(' ')[1]; by[k] = (by[k] ?? 0) + 1 }
  return { reads: lines.slice(a, b).filter(l => l.startsWith('[reads]')).length, bySource: by, stages: JSON.parse(lines[b].replace(/^.*end \S+ /, '')) }
}
async function main() {
  const st = await createStudent(admin, 'timing', { onboard: true }); made.push(st.id)
  await admin.from('planning_cycles').update({ ends_at_local: addDays(new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' }), 6) }).eq('user_id', st.id).eq('status', 'active')
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' })
  const rows: Record<string, { ms: number; reads: number | null; stages: any; ok: boolean; bySource?: Record<string, number> }[]> = { simple: [], interpreted: [], preview: [], confirm: [] }
  const ask = async (cls: string, body: any) => {
    const key = `tm${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, t = Date.now()
    const r = await st.s.post('/api/coach', { ...body, turnKey: key }); const ms = Date.now() - t
    await new Promise(r => setTimeout(r, 150))
    rows[cls].push({ ms, ok: r.status === 200, ...reads(key) }); return r
  }
  for (let i = 0; i < N; i++) await ask('simple', { message: 'What should I focus on next?' })
  for (let i = 0; i < N; i++) await ask('interpreted', { message: `could you possibly sort out my afternoon somehow ${i}` })
  for (let i = 0; i < N; i++) {
    const mk = await st.s.post('/api/tasks', { title: `Timing task ${i}`, date: today, durationMinutes: 30 })
    await ask('preview', { message: 'move it to tomorrow', taskId: mk.body.task.id })
    await ask('confirm', { message: 'yes' })
  }
  console.log(`samples per class: ${N}; dev server (cold compile inflates the first sample)\n`)
  for (const [cls, v] of Object.entries(rows)) {
    const ms = v.map(x => x.ms), rd = v.map(x => x.reads).filter((x): x is number => x !== null)
    const stages: Record<string, number[]> = {}; for (const x of v) for (const [k, t] of Object.entries(x.stages ?? {})) if (typeof t === 'number') (stages[k] ??= []).push(t)
    console.log(`${cls.padEnd(12)} n=${v.length} ok=${v.filter(x => x.ok).length}  total ms p50=${pct(ms, .5)} p95=${pct(ms, .95)} max=${Math.max(...ms)}  reads p50=${rd.length ? pct(rd, .5) : 'n/a'} max=${rd.length ? Math.max(...rd) : 'n/a'}`)
    const src: Record<string, number[]> = {}; for (const x of v) for (const [k, c] of Object.entries(x.bySource ?? {})) (src[k] ??= []).push(c)
    console.log('             reads by source (max): ' + Object.entries(src).map(([k, a]) => `${k}=${Math.max(...a)}`).join(' '))
    console.log('             stage p50 ms: ' + Object.entries(stages).map(([k, a]) => `${k}=${pct(a, .5)}`).join(' '))
  }
}
main().catch(e => { console.error(e); process.exitCode = 1 }).finally(async () => { for (const id of made) await admin.auth.admin.deleteUser(id).catch(() => {}) })
