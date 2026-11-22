/** Same canonical weekly gate, with no unused next-week generation on Home. Owned synthetic students only. */
import dotenv from 'dotenv'
dotenv.config({path:'.env.local',quiet:true} as any)
import assert from 'node:assert/strict'
import { createAdminClient } from '../src/lib/supabase/admin'
import { getWeeklyReviewState } from '../src/lib/planning/weeklyReview/service'
import { addDays } from '../src/lib/planning/studyWeek'
import { createStudent, makeCheck } from './lib/e2eSession'

const db=createAdminClient(), owned:string[]=[], {check,finish}=makeCheck(), realFetch=globalThis.fetch
let counting=false, reads=0
// Counts only this process's read requests; it changes no response or policy.
globalThis.fetch=(async(input:any,init?:any)=>{if(counting)reads++;return realFetch(input,init)}) as typeof fetch
async function compare(id:string,now:Date,label:string) {
  counting=true;reads=0;const short=await getWeeklyReviewState(id,now,'gate'), shortReads=reads
  reads=0;const full=await getWeeklyReviewState(id,now),fullReads=reads;counting=false
  const expected=full.status==='active'?{status:full.status,gate:full.gate}:full
  assert.deepEqual(short,expected)
  check(`${label}: the reduced read returns exactly the full canonical gate`,true)
  check(`${label}: no empty or invented next-week plan is returned`,'next' in short===false)
  if(full.status==='active'){
    check(`${label}: the actual review still receives its full next-week preview`,!!full.next.week&&Array.isArray(full.next.days))
    check(`${label}: Home avoids unused planning reads`,shortReads<fullReads,JSON.stringify({shortReads,fullReads}))
  }
  console.log(JSON.stringify({label,gate:short.status==='active'?short.gate.kind:short.status,shortReads,fullReads}))
}
;(async()=>{
 try{
  const s=await createStudent(db,`p6gate${Date.now().toString(36)}`,{onboard:true,register:id=>owned.push(id)})
  const cycle=(await db.from('planning_cycles').select('starts_at_local,ends_at_local').eq('user_id',s.id).eq('status','active').single().throwOnError()).data!
  const state=async()=>JSON.stringify((await db.from('plan_blocks').select('id,execution,revision,local_date,duration_minutes').eq('user_id',s.id).order('id').throwOnError()).data)
  const before=await state(),now=new Date()
  await compare(s.id,now,'current week')
  await compare(s.id,new Date(`${addDays(cycle.ends_at_local,2)}T12:00:00Z`),'ended-week clock fixture')
  await db.from('mock_outcomes').insert({user_id:s.id,kind:'provider_mock',outcome:'taken',planned_date:cycle.starts_at_local,actual_date:cycle.starts_at_local,choice_at_record:'use_mock',reported_result:'48% (synthetic self-report fixture)'}).throwOnError()
  await compare(s.id,now,'external mock chosen as assessment')
  check('both read paths leave accepted work and history attribution unchanged',await state()===before)
  check('a reported external score creates no demonstrated evidence',(await db.from('evidence_events').select('id',{count:'exact',head:true}).eq('user_id',s.id).throwOnError()).count===0)
  const fresh=await createStudent(db,`p6gateempty${Date.now().toString(36)}`,{onboard:false,register:id=>owned.push(id)})
  await compare(fresh.id,now,'no cycle')
 }finally{
  counting=false;globalThis.fetch=realFetch
  for(const id of owned){const r=await db.auth.admin.deleteUser(id);check('owned gate student removed',!r.error,r.error?.message)}
 }
 finish()
})().catch(e=>{console.error(e.message);process.exitCode=1})
