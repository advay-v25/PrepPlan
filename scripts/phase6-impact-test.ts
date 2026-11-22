/** Real owned setup commits; only this Node process's optional capacity reads are failed. No app test endpoint or schema fault. */
import dotenv from 'dotenv'
dotenv.config({path:'.env.local',quiet:true} as any)
import { createAdminClient } from '../src/lib/supabase/admin'
import { saveWithPlanImpact } from '../src/lib/onboarding/planImpact'
import { saveWeek } from '../src/lib/onboarding/service'
import { createStudent, makeCheck } from './lib/e2eSession'

const db=createAdminClient(), owned:string[]=[], realFetch=globalThis.fetch, {check,finish}=makeCheck()
let failReads=false, hits=0
globalThis.fetch=(async(input:any,init?:any)=>{
  const url=String(typeof input==='string'?input:input?.url??input)
  if(failReads && url.includes('/rest/v1/availability_windows') && (!init?.method||init.method==='GET')) {hits++;return new Response(JSON.stringify({message:'owned optional read fault',code:'P6_FAULT'}),{status:503,headers:{'content-type':'application/json'}})}
  return realFetch(input,init)
}) as typeof fetch

;(async()=>{
 try{
  const s=await createStudent(db,`p6impact${Date.now().toString(36)}`,{onboard:true,register:id=>owned.push(id)})
  const profile=async()=>(await db.from('profiles').select('onboarding_context_version,max_session_minutes').eq('id',s.id).single().throwOnError()).data!
  const tasks=async()=>JSON.stringify((await db.from('plan_blocks').select('id,revision,execution,local_date,duration_minutes').eq('user_id',s.id).order('id').throwOnError()).data)
  const before=await profile(), originalTasks=await tasks()
  const body=(minutes:number)=>({availabilityMode:'windows',windows:[{weekday:1,startTime:'18:30',endTime:'21:30'}],commitments:[],maxSessionMinutes:minutes})
  const receipt:{version?:number}={}
  const impact=await saveWithPlanImpact(s.id,async()=>{await saveWeek(s.id,body(30),before.onboarding_context_version,receipt);failReads=true},receipt)
  failReads=false
  check('a REAL commit followed by a failed optional read returns impact unavailable',!!impact&&'unavailable'in impact&&hits>0,JSON.stringify(impact))
  const after=await profile()
  check('the changed sitting limit and exactly one setup version remain saved',after.max_session_minutes===30&&after.onboarding_context_version===before.onboarding_context_version+1)
  check('the accepted tasks were not moved or rewritten',await tasks()===originalTasks)
  failReads=true;const receipt2:{version?:number}={}
  const impact2=await saveWithPlanImpact(s.id,()=>saveWeek(s.id,body(45),after.onboarding_context_version,receipt2),receipt2)
  failReads=false
  check('a failed before-comparison still allows the authoritative save and reports unavailable',!!impact2&&'unavailable'in impact2&&(await profile()).max_session_minutes===45)
  const latest=await profile();let refused=false
  try{await saveWithPlanImpact(s.id,()=>saveWeek(s.id,body(30),latest.onboarding_context_version-1,{}))}catch{refused=true}
  check('a stale authoritative save is refused, not reported as saved',refused&&JSON.stringify(await profile())===JSON.stringify(latest))
  for(const endpoint of ['/api/tasks','/api/onboarding/week']){
    const r=await s.s.post(endpoint,null)
    check(`${endpoint} refuses JSON null with 400, not a server error`,r.status===400,JSON.stringify(r.body))
  }
  check('invalid requests changed neither profile nor tasks',JSON.stringify(await profile())===JSON.stringify(latest)&&await tasks()===originalTasks)
 }finally{failReads=false;globalThis.fetch=realFetch;for(const id of owned){const r=await db.auth.admin.deleteUser(id);check('owned student cleaned up',!r.error,r.error?.message)}}
 finish()
})().catch(e=>{console.error(e.message);process.exitCode=1})
