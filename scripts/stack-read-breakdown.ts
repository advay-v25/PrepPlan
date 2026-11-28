/** Which resources one request to each route reads, from the server's TRACE_READS output. Local stack only (see scripts/local-stack.cjs). Fixture student, deleted by id. */
import { createClient } from '@supabase/supabase-js'
import { createStudent, FRESH_STUDENT_ONBOARDING, createSession } from './lib/e2eSession'
import fs from 'node:fs'
const trace = process.env.E2E_READ_TRACE!, url = process.env.NEXT_PUBLIC_SUPABASE_URL!
if (process.env.LOCAL_STACK !== '1' || !/^http:\/\/127\.0\.0\.1:\d+$/.test(new URL(url).origin) || !trace) throw new Error('Local stack only: source its stack.env and set E2E_READ_TRACE.')
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!)
async function main() {
  const ids: string[] = []
  try {
    const st = await createStudent(admin, 'rbd', { onboard: true, register: id => ids.push(id), onboarding: FRESH_STUDENT_ONBOARDING })
    const s = createSession(admin, st.email); if (!(await s.signIn())) throw new Error('sign-in failed')
    if (process.env.PERSONA === 'history') {     // the same history persona scripts/baseline-measure.ts builds: planned study sittings logged as completed
      const { data: blocks } = await admin.from('plan_blocks').select('id,revision,lm_id,outcome_id').eq('user_id', st.id).eq('task_type', 'study').is('cancelled_at', null).order('local_date').limit(Number(process.env.HISTORY_BLOCKS ?? 6))
      for (const b of blocks ?? []) {
        const o = b.outcome_id ?? (await admin.from('reading_los').select('id').eq('reading_id', b.lm_id!).order('sequence').limit(1).single()).data!.id
        const r = await s.post('/api/log-learning/planned', { task_id: b.id, expected_revision: b.revision, execution: 'completed', duration_minutes: 40, outcome_ids: [o], idempotency_key: crypto.randomUUID() })
        if (r.body?.ok !== true) throw new Error(JSON.stringify(r.body).slice(0, 200))
      }
    }
    for (const route of (process.env.ROUTES ?? '/app,/app/calendar,/app/tests').split(',')) {
      await (await s.req(route)).arrayBuffer()                                   // warm
      const at = fs.statSync(trace).size
      await (await s.req(route)).arrayBuffer()
      const lines = fs.readFileSync(trace).subarray(at).toString().split('\n').filter(l => l.startsWith('[reads]'))
      const by = new Map<string, number>()
      for (const l of lines) { const m = l.match(/^\[reads\] \S+ (GET|HEAD|POST) (\S+)(?: @(\S+))?/); if (m) { const k = `${m[1]} ${m[2].replace(/\?.*/, '')}${m[3] && process.env.BY_CALLER === '1' ? ' @' + m[3] : ''}`; by.set(k, (by.get(k) ?? 0) + 1) } }
      console.log(`\n== ${route}: ${lines.length} calls, ${by.size} distinct`)
      console.table([...by].sort((a, b) => b[1] - a[1]).slice(0, Number(process.env.TOP ?? 25)).map(([k, n]) => ({ call: k, n })))
    }
  } finally { for (const id of ids) await admin.auth.admin.deleteUser(id) }
}
main().catch(e => { console.error(e); process.exit(1) })
