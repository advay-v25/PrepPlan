/** MODE=preview: the first-week preview request for a student who has answered setup, as a fresh build (no ready draft) and as a reuse.
 *  Otherwise: Initial HTML bytes, server reads and time of each onboarding step. PERSONA=new: a student who has not finished setup (only the first step renders); default: an onboarded student editing each step. Local stack only. */
import { createClient } from '@supabase/supabase-js'
import { createStudent, createSession } from './lib/e2eSession'
import fs from 'node:fs'
const trace = process.env.E2E_READ_TRACE!, url = process.env.NEXT_PUBLIC_SUPABASE_URL!
if (process.env.LOCAL_STACK !== '1' || !/^http:\/\/127\.0\.0\.1:\d+$/.test(new URL(url).origin) || !trace) throw new Error('Local stack only: source its stack.env and set E2E_READ_TRACE.')
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const q = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]) }
async function main() {
  const owned: string[] = []
  try {
    const st = await createStudent(admin, 'onbm', { onboard: process.env.PERSONA !== 'new', register: id => owned.push(id), onboarding: process.env.MODE === 'preview' ? { answersOnly: true } : undefined })
    const s = createSession(admin, st.email); if (!(await s.signIn())) throw new Error('sign-in failed')
    const out: any[] = []
    if (process.env.MODE === 'preview') {
      const post = async (fresh: boolean) => {
        if (fresh) await admin.from('plan_drafts').update({ status: 'superseded' }).eq('user_id', st.id).eq('status', 'ready')
        const at = fs.statSync(trace).size, t = performance.now(), r = await s.post('/api/onboarding/plan/preview', {})
        const ms = performance.now() - t, lines = fs.readFileSync(trace).subarray(at).toString().split('\n')
        if ((r.body as any)?.ok !== true) throw new Error(`preview failed: ${JSON.stringify(r.body).slice(0, 200)}`)
        return { ms, reads: lines.filter(l => /^\[reads\] \S+ (GET|HEAD) /.test(l)).length, rpcs: lines.filter(l => /^\[reads\] \S+ POST rpc\//.test(l)).length }
      }
      await post(true)
      for (const fresh of [true, false]) {
        const xs: Awaited<ReturnType<typeof post>>[] = []
        for (let i = 0; i < Number(process.env.SAMPLES ?? 15); i++) xs.push(await post(fresh))
        out.push({ request: 'POST /api/onboarding/plan/preview', kind: fresh ? 'fresh build' : 'reused draft', n: xs.length, reads: q(xs.map(x => x.reads), .5), rpcs: q(xs.map(x => x.rpcs), .5), p50ms: q(xs.map(x => x.ms), .5), p95ms: q(xs.map(x => x.ms), .95) })
      }
    } else for (const path of ['/onboarding', '/onboarding/exam', '/onboarding/route', '/onboarding/position', '/onboarding/week', '/onboarding/plan']) {
      const samples: { ms: number; bytes: number; reads: number; status: number; to: string }[] = []
      for (let i = 0; i < Number(process.env.SAMPLES ?? 8) + 1; i++) {
        const at = fs.statSync(trace).size, t = performance.now(), r = await s.req(path), body = await r.arrayBuffer()
        const reads = fs.readFileSync(trace).subarray(at).toString().split('\n').filter(l => /^\[reads\] /.test(l)).length
        if (i > 0) samples.push({ ms: performance.now() - t, bytes: body.byteLength, reads, status: r.status, to: new URL(r.url).pathname })
      }
      out.push({ path, to: samples[0].to, status: samples[0].status, bytes: samples[0].bytes, reads: q(samples.map(x => x.reads), .5), p50ms: q(samples.map(x => x.ms), .5), p95ms: q(samples.map(x => x.ms), .95) })
    }
    console.table(out)
    fs.writeFileSync(process.env.OUT ?? 'docs/evidence/phase4-onboarding-measure.json', JSON.stringify({ at: new Date().toISOString(), rows: out }, null, 2))
  } finally { for (const id of owned) await admin.auth.admin.deleteUser(id) }
}
main().catch(e => { console.error(e); process.exit(1) })
