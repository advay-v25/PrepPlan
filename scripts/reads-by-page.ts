/** Counts the database requests one page render makes, by table and as exact duplicates. Needs a dev server started with TRACE_READS=1 and its log.
 *    TRACE_READS=1 node scripts/isolated-next.cjs .next-rd dev -p 3179 > rd.log      E2E_BASE_URL=http://localhost:3179 npx tsx scripts/reads-by-page.ts rd.log /app /app/calendar */
import dotenv from 'dotenv'; dotenv.config({ path: '.env.local', quiet: true } as any)
import fs from 'node:fs'
import { createAdminClient } from '../src/lib/supabase/admin'
import { createStudent } from './lib/e2eSession'
const db = createAdminClient(), o: string[] = [], LOG = process.argv[2], pages = process.argv.slice(3)
const lines = () => fs.readFileSync(LOG, 'utf8').split('\n')
;(async () => {
  const st = await createStudent(db, 'rdpg', { onboard: true, register: i => o.push(i) })
  for (const p of pages) {
    await (await st.s.req(p)).text()
    await new Promise(r => setTimeout(r, 800)); const n = lines().length
    const t = Date.now(); await (await st.s.req(p)).text(); const ms = Date.now() - t
    await new Promise(r => setTimeout(r, 1200))
    const reads = lines().slice(n).filter(l => l.startsWith('[reads]'))
    const key = (l: string) => l.replace(/^\[reads\] \S+ /, '')
    const byKey = new Map<string, number>(); for (const l of reads) byKey.set(key(l), (byKey.get(key(l)) ?? 0) + 1)
    const byTable = new Map<string, number>(); for (const l of reads) { const m = key(l).match(/^(GET|POST|PATCH|DELETE) ([\w/]+)/); const k = m ? `${m[1]} ${m[2]}` : key(l); byTable.set(k, (byTable.get(k) ?? 0) + 1) }
    console.log(`\n=== ${p}: ${reads.length} requests, ${ms}ms (dev), ${byKey.size} distinct`)
    console.log('-- by table'); for (const [k, v] of [...byTable].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(String(v).padStart(4), k)
    console.log('-- exact duplicates'); for (const [k, v] of [...byKey].filter(([, v]) => v > 1).sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(String(v).padStart(4), k.slice(0, 150))
  }
})().finally(async () => { for (const i of o) await db.auth.admin.deleteUser(i).catch(() => {}) })
