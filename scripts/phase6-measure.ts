/** Owned, synthetic history measurement; never resets a shared account. Run alone, after browser/HTTP suites. */
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { createAdminClient } from '../src/lib/supabase/admin'
import { createStudent, FRESH_STUDENT_ONBOARDING, preflightServer } from './lib/e2eSession'
import { addDays, todayInZone, weekdayOf } from '../src/lib/planning/studyWeek'

const arg = (name: string) => process.argv.find(x => x.startsWith(`--${name}=`))?.slice(name.length + 3)
const serverLog = arg('server-log'), out = arg('out'), transport = arg('transport') ?? 'direct configured development Supabase'
if (!serverLog || !out) throw new Error('Pass --server-log=<owned TRACE_READS log> --out=<evidence.json>. Run with no other app traffic.')
const db = createAdminClient(), owned: string[] = [], runs: any[] = [], initialWeeks: any[] = []
const percentile = (xs: number[], p: number) => [...xs].sort((a,b) => a-b)[Math.max(0, Math.ceil(xs.length*p)-1)]
async function main() {
  await preflightServer()
  for (const mode of ['ordinary', 'long-history']) {
    const s = await createStudent(db, `p6measure${Date.now().toString(36)}`, { onboard: true, onboarding: FRESH_STUDENT_ONBOARDING, register: id => owned.push(id) })
    const initial = (await db.from('plan_blocks').select('id,lm_id,title,local_date,duration_minutes,task_type,sitting_ordinal,dependencies').eq('user_id',s.id).order('local_date').throwOnError()).data!
    const profile = (await db.from('profiles').select('max_session_minutes').eq('id',s.id).single().throwOnError()).data!
    if(initial.some(t=>['study','review','practice'].includes(t.task_type)&&t.duration_minutes>profile.max_session_minutes)) throw new Error('Generated sitting exceeds saved sitting limit')
    initialWeeks.push({mode,seededVia:'real onboarding commands, midweek fresh self-study',sittingLimit:profile.max_session_minutes,days:[...new Set(initial.map(t=>t.local_date))].map(date=>({date,minutes:initial.filter(t=>t.local_date===date).reduce((n,t)=>n+(t.duration_minutes??0),0),sittings:initial.filter(t=>t.local_date===date).length})),tasks:initial,windows:(await db.from('availability_windows').select('weekday,start_time,end_time').eq('user_id',s.id).order('weekday').throwOnError()).data})
    if (mode === 'long-history') {
      const today = todayInZone('Europe/London')
      const monday = addDays(today, -((weekdayOf(today)+6)%7))
      const cycles = Array.from({length:50}, (_,i) => {
        const start = addDays(monday, -350 + i*7), end = addDays(start, 6)
        return { id: randomUUID(), user_id: s.id, starts_at: `${start}T00:00:00Z`, ends_at: `${end}T23:59:59Z`, starts_at_local:start, ends_at_local:end, status:'closed', timezone:'Europe/London', anchor_day:0 }
      })
      await db.from('planning_cycles').insert(cycles).throwOnError()
      const blocks = Array.from({length:1200}, (_,i) => {
        const c = cycles[Math.floor(i/24)], date = addDays(c.starts_at_local, i%6)
        return {id:`p6-history-${s.id}-${i}`, user_id:s.id, cycle_id:c.id, title:`Historical study ${i+1}`, detail:'Synthetic long-history workload, not evidence', task_type:'study', origin:'student', priority:'core', placement:'day_preferred', execution:'completed', local_date:date, day:date, duration_minutes:25, duration:'25', created_by:'student'}
      })
      for (let i=0;i<blocks.length;i+=200) {
        const page=blocks.slice(i,i+200)
        await db.from('plan_blocks').insert(page).throwOnError()
        await db.from('task_events').insert(page.map(b=>({ user_id:s.id, task_id:b.id, event_type:'completed', actual_duration_minutes:25, payload:{execution:'completed'}, created_at:`${b.local_date}T19:00:00Z` }))).throwOnError()
      }
    }
    for (const page of ['/app', '/app/calendar', '/app/curriculum', '/app/tests', '/app/coach', '/app/settings']) {
      const samples:any[]=[]
      for (let i=0;i<6;i++) {
        const offset=fs.statSync(serverLog!).size, t=Date.now()
        const r=await s.s.req(page); await r.text()
        if(r.status!==200) throw new Error(`${mode} ${page}: HTTP ${r.status}`)
        const lines=fs.readFileSync(serverLog!).subarray(offset).toString('utf8').split('\n').filter(l=>l.startsWith('[reads]'))
        const counts=new Map<string,number>(); for(const l of lines) counts.set(l,(counts.get(l)??0)+1)
        samples.push({ms:Date.now()-t, reads:lines.length, identicalTraceLines:[...counts.values()].reduce((n,c)=>n+Math.max(0,c-1),0), cold:i===0})
      }
      const warm=samples.slice(1)
      runs.push({mode,page,samples,p50:percentile(warm.map(x=>x.ms),.5),p95:percentile(warm.map(x=>x.ms),.95),readCounts:warm.map(x=>x.reads)})
      console.log(JSON.stringify(runs.at(-1)))
    }
  }
}
main().catch(e=>{console.error(e.message);process.exitCode=1}).finally(async()=>{
  const cleanup: { id: string; ok: boolean }[]=[]
  for(const id of owned){const r=await db.auth.admin.deleteUser(id);cleanup.push({id,ok:!r.error});if(r.error)process.exitCode=1}
  fs.writeFileSync(out!,JSON.stringify({at:new Date().toISOString(),environment:`isolated Next dev server, ${transport}; no concurrent traffic; small sample, not production SLO`,measurement:'instrumented server HTTP reads, not inner SQL statement counts; identical redacted trace lines may have different filter values and are not proof of duplicate reads',fixture:'ordinary accepted first week versus 50 closed weeks, 1200 completed sittings and 1200 completion events; no diagnostic evidence',initialWeeks,runs,cleanup},null,2))
})
