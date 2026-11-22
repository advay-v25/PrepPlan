/**
 * Measures Home on the dedicated +e2e account: load time and database reads per request. Start the dev server with TRACE_READS=1 and pass its log:
 *   TRACE_READS=1 npm run dev -- -p 3102 > dev.log      then      E2E_ALLOW_RESET=1 E2E_BASE_URL=http://localhost:3102 npx tsx scripts/home-measure.ts dev.log
 * Seeds nine recorded fixture tasks (hm-0…hm-8) and removes exactly those, by id and owner.
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import fs from 'node:fs'
dotenv.config({ path: '.env.local', quiet: true } as any)
import { verifyAndGetE2EUser, getE2EEmail } from './lib/e2eIdentity'
import { createSession } from './lib/e2eSession'
import { todayInZone } from '../src/lib/planning/studyWeek'
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
;(async () => {
  const log = process.argv[2]
  const uid = await verifyAndGetE2EUser(admin)
  const { data: cyc } = await admin.from('planning_cycles').select('id, timezone').eq('user_id', uid).eq('status', 'active').single()
  const today = todayInZone((cyc!.timezone as string) || 'UTC'); const add = (d: string, n: number) => new Date(new Date(`${d}T12:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10)
  await admin.from('planning_cycles').update({ starts_at_local: add(today, -3), ends_at_local: add(today, 3) }).eq('id', cyc!.id)
  const ids = Array.from({ length: 9 }, (_, i) => `hm-${i}`)
  await admin.from('plan_blocks').insert(ids.map((id, i) => ({ id, user_id: uid, cycle_id: cyc!.id, title: `Measure ${i}`, detail: 'd', task_type: 'study', origin: 'planner', priority: 'core', placement: 'day_preferred', execution: 'not_started', local_date: i < 6 ? today : add(today, i - 5), day: today, duration_minutes: 30, duration: '30', created_by: 'algorithm', learning_objective: 'o', suggested_approach: 'a', completion_meaning: 'c', lm_id: 'r028', outcome_id: 'r028-a' })))
  try {
    const s = createSession(admin, getE2EEmail()); await s.signIn()
    const times: number[] = []
    for (let i = 0; i < 4; i++) { const t = Date.now(); const r = await s.req('/app'); await r.text(); times.push(Date.now() - t) }
    console.log(`Home load (4 requests, first is cold): ${times.map(t => `${t} ms`).join(', ')}`)
    if (log && fs.existsSync(log)) {
      const lines = fs.readFileSync(log, 'utf8').split('\n'), idx = lines.flatMap((l, i) => /GET \/app 200/.test(l) ? [i] : [])
      if (idx.length >= 2) {
        const reads = lines.slice(idx[idx.length - 2] + 1, idx[idx.length - 1] + 1).filter(l => l.startsWith('[reads]'))
        const dup = new Map<string, number>(); for (const r of reads) dup.set(r, (dup.get(r) ?? 0) + 1)
        const byTable = new Map<string, number>(); for (const r of reads) { const t = r.replace(/\?.*/, ''); byTable.set(t, (byTable.get(t) ?? 0) + 1) }
        console.log(`Last Home request: ${reads.length} database reads, ${[...dup.values()].reduce((n, v) => n + Math.max(0, v - 1), 0)} exact repeats`)
        console.log([...byTable.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `  ${v} ${k}`).join('\n'))
      }
    }
  } finally { await admin.from('plan_blocks').delete().in('id', ids).eq('user_id', uid) }
})().then(() => process.exit(0))
