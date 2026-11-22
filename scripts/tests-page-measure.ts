/**
 * Controlled timing of /app/tests for one ordinary student with a fixed history (onboarded, no attempts), same bank for every run.
 *   E2E_BASE_URL=http://localhost:3141 npx tsx scripts/tests-page-measure.ts [--label=actual-bank|fixture-bank]
 * Reports sequential runs and an intentional-contention run separately: sample size, p50/p95/max wall time, status codes. Read counts need the
 * server started with TRACE_READS=1 (see scripts/home-measure.ts). The student is deleted by recorded id.
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)
import { createStudent } from './lib/e2eSession'
import { loadEligibleItemPool, countFreshByReading } from '../src/lib/tests/itemPool'

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const label = process.argv.find(a => a.startsWith('--label='))?.slice(8) ?? 'actual-bank'
const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)] }
const stats = (xs: number[]) => ({ n: xs.length, p50_ms: Math.round(pct(xs, 0.5)), p95_ms: Math.round(pct(xs, 0.95)), max_ms: Math.round(Math.max(...xs)) })

async function main() {
  const st = await createStudent(admin, 'perf', { onboard: true })
  try {
    const c = async (q: any) => (await q).count ?? 0
    const inventory = {
      total: await c(admin.from('assessment_items').select('*', { count: 'exact', head: true })),
      // Raw status counts (NOT eligibility): reviewed items before delivery rules, family and exposure exclusions.
      reviewedRoutineRaw: await c(admin.from('assessment_items').select('*', { count: 'exact', head: true }).eq('review_status', 'reviewed').eq('held_out', false)),
      reviewedHeldOutRaw: await c(admin.from('assessment_items').select('*', { count: 'exact', head: true }).eq('review_status', 'reviewed').eq('held_out', true)),
      // Eligible: the serving path's own pool (delivery tiers, family and exposure exclusions) for THIS student, per source.
      routineEligibleForStudent: (await loadEligibleItemPool(st.id, ['r028', 'r029'], undefined, 'routine').catch(() => null))?.length ?? 'read failed',
      heldOutEligibleForStudent: (await loadEligibleItemPool(st.id, ['r028', 'r029'], undefined, 'heldout').catch(() => null))?.length ?? 'read failed',
      freshByReading: Object.fromEntries([...(await countFreshByReading(st.id).catch(() => new Map<string, number>())).entries()].filter(([, n]) => n > 0).slice(0, 12)),
      fixtureItems: await c(admin.from('assessment_items').select('*', { count: 'exact', head: true }).eq('provenance', 'fixture-bank')),
      // This student has no attempts, so every routine item is fresh to them; with history, subtract what they have seen.
      studentSeen: await c(admin.from('assessment_responses').select('*', { count: 'exact', head: true }).eq('user_id', st.id)),
    }
    const timed = async () => { const t = performance.now(); const r = await st.s.req('/app/tests'); await r.text(); return { ms: performance.now() - t, status: r.status } }
    await timed()   // warm the route compile; not counted
    const seq: { ms: number; status: number }[] = []
    for (let i = 0; i < 10; i++) seq.push(await timed())
    const par = await Promise.all(Array.from({ length: 8 }, timed))
    const par2 = await Promise.all(Array.from({ length: 8 }, timed))
    const codes = (xs: { status: number }[]) => [...new Set(xs.map(x => x.status))].join(',')
    console.log(JSON.stringify({ label, inventory, history: 'none (onboarded, no attempts)', sequential: { ...stats(seq.map(x => x.ms)), status: codes(seq) }, contention_8_parallel_x2: { ...stats([...par, ...par2].map(x => x.ms)), status: codes([...par, ...par2]) } }, null, 1))
  } finally { await admin.auth.admin.deleteUser(st.id).catch(() => {}) }
}
main().catch(e => { console.error(e); process.exit(1) })
