/**
 * Phase 0/1 baseline: initial response bytes and cold/warm latency of Home, Calendar, Tests, Coach and the log entry, on the SAME local production build
 * against the deployed project, for a fresh persona and a persona with realistic logged history. Fixture students only, deleted by exact id.
 * Needs E2E_BASE_URL, E2E_ENV_FILE and the usual deployed-project opt-ins (see tests/e2e/lifecycle/helpers.ts). No provider is called: Coach is only opened, not asked.
 */
import { createClient } from '@supabase/supabase-js'
import { createStudent, FRESH_STUDENT_ONBOARDING, createSession } from './lib/e2eSession'
import fs from 'node:fs'
import dotenv from 'dotenv'
dotenv.config({ path: process.env.E2E_ENV_FILE || '.env.local', quiet: true })
const BASE = process.env.E2E_BASE_URL!
const target = process.env.E2E_TARGET || 'mnlezctdqkdfgvmipmcj'
const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!)
const origin = new URL(BASE)
// The isolated local stack (scripts/local-stack.cjs) is also a valid target: a loopback app and a loopback gateway the runner recorded, never a hosted project.
const local = process.env.E2E_SUITE === 'local-stack' && process.env.LOCAL_STACK === '1' && /^http:\/\/127\.0\.0\.1:\d+$/.test(url.origin)
if (!['localhost', '127.0.0.1'].includes(origin.hostname) || (!local && (url.origin !== `https://${target}.supabase.co`
  || (target !== 'mnlezctdqkdfgvmipmcj' && process.env.E2E_ALLOW_TARGET !== target)))) {
  throw new Error('Baseline fixtures require a loopback app and the explicitly selected Supabase project.')
}
const admin = createClient(url.origin, (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)!)
const trace = process.env.E2E_READ_TRACE
const N = Number(process.env.E2E_MEASURE_SAMPLES ?? 15)
if (!Number.isInteger(N) || N < 1 || N > 100) throw new Error('Invalid baseline sample count.')
const q = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]) }

async function time(s: ReturnType<typeof createSession>, path: string) {
  const offset = trace ? fs.statSync(trace).size : 0
  const t = performance.now(); const r = await s.req(path, { signal: AbortSignal.timeout(45_000) }); const body = await r.arrayBuffer()
  const ms = performance.now() - t
  if (!r.ok || r.redirected) throw new Error(`Unexpected HTTP ${r.status} or redirect on ${path.split('?')[0]}.`)
  const lines = trace ? fs.readFileSync(trace).subarray(offset).toString().split('\n') : []
  const reads = trace ? lines.filter(line => /^\[reads\] \S+ (GET|HEAD) /.test(line)).length : null
  const rpcs = trace ? lines.filter(line => /^\[reads\] \S+ POST rpc\//.test(line)).length : null
  return { ms, bytes: body.byteLength, status: r.status, reads, rpcs }
}
async function measure(s: ReturnType<typeof createSession>, path: string) {
  const cold = await time(s, path)
  const warm: Awaited<ReturnType<typeof time>>[] = []
  for (let i = 0; i < N; i++) warm.push(await time(s, path))
  return { path: path.split('?')[0] + (path.includes('?task=') ? '?task=<owned>' : ''), status: cold.status, bytes: cold.bytes,
    firstMs: Math.round(cold.ms), warmP50: q(warm.map(r => r.ms), 0.5), warmP95: q(warm.map(r => r.ms), 0.95), samples: N,
    firstReads: cold.reads, firstRpcs: cold.rpcs, warmReads: warm.map(r => r.reads), warmRpcs: warm.map(r => r.rpcs) }
}

async function main() {
  const ids: string[] = []; const out: any = { at: new Date().toISOString(), base: BASE, clock: new Date().toString(), timezone: 'Europe/London (student)', providers: 'none called', complete: false, personas: {} }
  try {
    for (const persona of ['fresh', 'history'] as const) {
      const st = await createStudent(admin, `ms${persona}`, { onboard: true, register: id => ids.push(id), onboarding: FRESH_STUDENT_ONBOARDING })
      const s = createSession(admin, st.email); if (!(await s.signIn())) throw new Error('Baseline sign-in failed.')
      const saves: number[] = []
      if (persona === 'history') {
        const { data: blocks } = await admin.from('plan_blocks').select('id,revision,lm_id,outcome_id').eq('user_id', st.id).eq('task_type', 'study').is('cancelled_at', null).order('local_date').limit(8)
        for (const b of blocks ?? []) {
          const o = b.outcome_id ?? (await admin.from('reading_los').select('id').eq('reading_id', b.lm_id!).order('sequence').limit(1).single()).data!.id
          const t = performance.now()
          const r = await s.post('/api/log-learning/planned', { task_id: b.id, expected_revision: b.revision, execution: 'completed', duration_minutes: 40, outcome_ids: [o], idempotency_key: crypto.randomUUID() })
          saves.push(performance.now() - t); if (r.body?.ok !== true) throw new Error(JSON.stringify(r.body).slice(0, 200))
        }
      }
      const routes = ['/app', '/app/calendar', '/app/tests', '/app/coach', '/app/log']
      const firstBlock = (await admin.from('plan_blocks').select('id').eq('user_id', st.id).eq('task_type', 'study').is('cancelled_at', null).eq('execution', 'not_started').limit(1).maybeSingle()).data
      const results: Awaited<ReturnType<typeof measure>>[] = []
      out.personas[persona] = { routes: results, plannedSaveMs: saves.length ? { n: saves.length, p50: q(saves, 0.5), p95: q(saves, 0.95) } : null }
      for (const r of routes) results.push(await measure(s, r))
      results.push(await measure(s, '/api/log-learning'))
      if (firstBlock) results.push(await measure(s, `/api/log-learning?task=${firstBlock.id}`))
    }
    out.complete = true
  } finally {
    const failed: string[] = []
    for (const id of ids) {
      const { error } = await admin.auth.admin.deleteUser(id)
      if (error && error.status !== 404) failed.push(id)
    }
    out.cleanup = { deleted: ids.length - failed.length, failed }
    fs.mkdirSync('docs/evidence', { recursive: true })
    fs.writeFileSync(process.env.E2E_MEASURE_OUT || `docs/evidence/baseline-measure-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, JSON.stringify(out, null, 2))
    if (failed.length) throw new Error(`Cleanup failed for owned fixture IDs: ${failed.join(', ')}`)
  }
  console.table(Object.entries(out.personas).flatMap(([p, v]: any) => v.routes.map((r: any) => ({ persona: p, ...r }))))
}
main().catch(e => { console.error(e); process.exit(1) })
