/** Owns one temporary candidate. Exercises real Auth -> app -> deployed SQL; removes all fixtures. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto'),{parse}=require('dotenv'),{createClient}=require('@supabase/supabase-js'),{createServerClient}=require('@supabase/ssr');
async function main(){
 const args=process.argv.slice(2),target=args.find(a=>a.startsWith('--confirm-target='))?.slice(17),raw=args.find(a=>a.startsWith('--base-url='))?.slice(11);
 const e=parse(fs.readFileSync(path.join(__dirname,'../.env.local'))),t=parse(fs.readFileSync(path.join(__dirname,'../.env.staging.local')));
 if(!target||t.E2E_CONFIRMED_DISPOSABLE_PROJECT_REF!==target||new URL(e.NEXT_PUBLIC_SUPABASE_URL).hostname!==target+'.supabase.co')throw Error('Confirm the authorised disposable project.');
 const base=new URL(raw);if(base.protocol!=='http:'||!['localhost','127.0.0.1'].includes(base.hostname)||base.pathname!=='/')throw Error('Use the owned loopback app URL.');
 const admin=createClient(e.NEXT_PUBLIC_SUPABASE_URL,e.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}}),cookies=new Map();
 const session=createServerClient(e.NEXT_PUBLIC_SUPABASE_URL,e.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{autoRefreshToken:false},cookies:{getAll:()=>[...cookies].map(([name,value])=>({name,value})),setAll:cs=>cs.forEach(c=>cookies.set(c.name,c.value))}});
 let uid,passed=0;
 const check=async(name,fn)=>{await fn();passed++;console.log('  ✓ '+name)};
 const req=async(method,url,body,signed=true)=>{const r=await fetch(new URL(url,base),{method,signal:AbortSignal.timeout(30000),headers:{'Content-Type':'application/json',...(signed?{Cookie:[...cookies].map(([k,v])=>k+'='+v).join('; ')}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:r.status,data:await r.json()}};
 const owned=async(table,column='id')=>{const r=await admin.from(table).select(column).eq('user_id',uid);assert.equal(r.error,null,table);return r.data};
 try{
 await check('signed-out logging is refused',async()=>assert.equal((await req('POST','/api/log-learning',{},false)).status,401));
 const email='roadmap-log-'+randomUUID()+'@example.com';const created=await admin.auth.admin.createUser({email,email_confirm:true,user_metadata:{full_name:'Disposable logging QA',roadmap_test_fixture:true}});assert.equal(created.error,null);uid=created.data.user.id;
 const link=await admin.auth.admin.generateLink({type:'magiclink',email});assert.equal(link.error,null);assert.equal((await session.auth.verifyOtp({type:'magiclink',token_hash:link.data.properties.hashed_token})).error,null);
 await check('verified students must finish setup before logging',async()=>assert.equal((await req('POST','/api/log-learning',{})).status,403));
 assert.equal((await admin.from('profiles').update({onboarding_status:'complete',timezone:'UTC'}).eq('id',uid)).error,null);
 const day=new Date();const today=day.toISOString().slice(0,10),mon=new Date(day);mon.setUTCDate(mon.getUTCDate()-((mon.getUTCDay()+6)%7));const end=new Date(mon);end.setUTCDate(end.getUTCDate()+6);
 const cycle=await admin.from('planning_cycles').insert({user_id:uid,status:'active',starts_at:mon.toISOString(),ends_at:end.toISOString(),starts_at_local:mon.toISOString().slice(0,10),ends_at_local:end.toISOString().slice(0,10),timezone:'UTC',anchor_day:0}).select('id').single();assert.equal(cycle.error,null);
 const plannedId='qa-planned-'+randomUUID();assert.equal((await admin.from('plan_blocks').insert({id:plannedId,user_id:uid,cycle_id:cycle.data.id,title:'Planned sitting',detail:'Fixture',local_date:today,day:today,duration:'45',duration_minutes:45,task_type:'study',execution:'not_started',placement:'day_preferred'})).error,null);
 const catalog=await req('GET','/api/log-learning');assert.equal(catalog.status,200);assert.equal(catalog.data.today,today);assert.equal(catalog.data.ownerId,uid);
 const readings=catalog.data.topics.flatMap(t=>t.readings),r28=readings.find(r=>r.id==='r028'),r29=readings.find(r=>r.id==='r029');assert.ok(r28.outcomes.length>=5);
 const key='log-http-'+randomUUID();const entry={activity_type:'independent_study',reading_id:'r028',outcome_ids:r28.outcomes.slice(0,3).map(o=>o.id),duration_minutes:45,idempotency_key:key};let first;
 await check('one 45-minute sitting creates one block, one activity and exact outcome links',async()=>{
 const r=await req('POST','/api/log-learning',entry);assert.equal(r.status,200);first=r.data;assert.equal(first.blocks,1);assert.equal(first.outcomes,3);assert.equal(first.minutes,45);assert.equal(first.inCycle,true);
 const blocks=await owned('plan_blocks','id,duration_minutes,learning_activity_id');assert.equal(blocks.filter(b=>b.learning_activity_id).length,1);assert.equal(blocks.find(b=>b.id===first.taskId).duration_minutes,null);
 const events=await owned('task_events','task_id,actual_duration_minutes');assert.equal(events.length,1);assert.equal(events[0].actual_duration_minutes,45);
 assert.equal((await owned('learning_activities')).length,1);
 });
 await check('concurrent retries and the old quick-study adapter reuse that same sitting',async()=>{
 const results=await Promise.all([req('POST','/api/log-learning',entry),req('POST','/api/log-learning',entry)]);assert.equal(results.every(r=>r.status===200&&r.data.replayed),true);
 const adapter=await req('POST','/api/tests/scope/quick-study',{idempotencyKey:key,outcomeIds:entry.outcome_ids,minutes:45});assert.equal(adapter.status,200);assert.equal(adapter.data.taskId,first.taskId);assert.equal(adapter.data.replayed,true);
 assert.equal((await owned('task_events')).length,1);
 });
 await check('changed retry is a conflict; whole-reading legacy input is retired',async()=>{
 const r=await req('POST','/api/log-learning',{...entry,duration_minutes:60});assert.equal(r.status,409);assert.equal(r.data.code,'IDEMPOTENCY_CONFLICT');
 assert.equal((await req('POST','/api/log-learning',{activity_type:'independent_study',lm_id:'r028',description:'legacy'})).status,409);
 });
 const tracker=async()=>{const r=await req('GET','/api/curriculum/readiness');assert.equal(r.status,200);return r.data.tracker.topics.flatMap(t=>t.modules)};
 await check('the exact subset reaches Tests and Curriculum without finishing the reading',async()=>{
 const scope=await req('GET','/api/tests/scope');assert.equal(scope.status,200);assert.deepEqual(scope.data.preview.scope.targets.map(t=>t.outcomeId).sort(),[...entry.outcome_ids].sort());
 const m=(await tracker()).find(m=>m.id==='r028');assert.equal(m.learning.confirmedOutcomes,3);assert.equal(m.learning.recordedSittings,1);assert.equal(m.coverage,'not_started');assert.equal(m.rows.every(r=>r.band==='untested'&&r.sample===0),true);
 });
 let unknown;
 await check('unknown time stays null through both APIs',async()=>{
 const r=await req('POST','/api/tests/scope/quick-study',{idempotencyKey:'unknown-'+randomUUID(),outcomeIds:['r030-a']});assert.equal(r.status,200);unknown=r.data;
 assert.equal(unknown.minutes,null);const event=(await owned('task_events','task_id,actual_duration_minutes')).find(e=>e.task_id===unknown.taskId);assert.equal(event.actual_duration_minutes,null);
 });
 await check('remaining outcomes finish study coverage through derivation, not an inflated legacy state',async()=>{
 const r=await req('POST','/api/log-learning',{...entry,outcome_ids:r28.outcomes.slice(3).map(o=>o.id),duration_minutes:15,idempotency_key:'rest-'+randomUUID()});assert.equal(r.status,200);
 const m=(await tracker()).find(m=>m.id==='r028');assert.equal(m.coverage,'studied');assert.equal(m.learning.recordedSittings,2);assert.equal(m.rows.every(r=>r.band==='untested'),true);
 assert.equal((await owned('user_module_state','lm_id')).length,0);
 });
 await check('a class log is exposure, not independent study or mastery',async()=>{
 const r=await req('POST','/api/log-learning',{...entry,activity_type:'class',reading_id:'r029',outcome_ids:r29.outcomes.map(o=>o.id),duration_minutes:20,idempotency_key:'class-'+randomUUID()});assert.equal(r.status,200);
 const m=(await tracker()).find(m=>m.id==='r029');assert.equal(m.coverage,'taught');assert.equal(m.rows.every(r=>r.band==='untested'),true);
 });
 await check('historical logs stay outside the open paper; invalid coverage/dates/minutes are refused',async()=>{
 const old=new Date(day);old.setUTCDate(old.getUTCDate()-7);const r=await req('POST','/api/log-learning',{...entry,reading_id:'r031',outcome_ids:['r031-a'],duration_minutes:null,date:old.toISOString().slice(0,10),idempotency_key:'historic-'+randomUUID()});assert.equal(r.status,200);assert.equal(r.data.inCycle,false);
 const s=await req('GET','/api/tests/scope');assert.equal(s.data.preview.scope.targets.some(t=>t.outcomeId==='r031-a'),false);
 for(const patch of [{duration_minutes:0},{outcome_ids:[]},{outcome_ids:['r029-a']},{date:'2099-01-01'}])assert.equal((await req('POST','/api/log-learning',{...entry,...patch,idempotency_key:'bad-'+randomUUID()})).status,400);
 });
 await check('recorded logs cannot be split, moved, reopened or given duplicate time',async()=>{
 for(const body of [{action:'split'},{action:'move',date:today},{action:'execution',execution:'completed',actualDurationMinutes:10},{action:'undo'}]){
 const r=await req('PATCH','/api/tasks/'+first.taskId,{...body,expectedRevision:1});assert.equal(r.status,409);assert.equal(r.data.code,'RECORDED_LEARNING');}
 });
 await check('removing a wrong log removes active coverage and active totals, retaining its audit history',async()=>{
 const stale=await req('DELETE','/api/tasks/'+first.taskId+'?expectedRevision=99');assert.equal(stale.status,409);
 const r=await req('DELETE','/api/tasks/'+first.taskId+'?expectedRevision=1');assert.equal(r.status,200);assert.equal(r.data.cancelled,true);
 const m=(await tracker()).find(m=>m.id==='r028');assert.equal(m.coverage,'not_started');assert.equal(m.learning.confirmedOutcomes,r28.outcomes.length-3);
 const s=await req('GET','/api/tests/scope');assert.equal(s.data.preview.scope.targets.some(t=>entry.outcome_ids.includes(t.outcomeId)),false);
 const events=await owned('task_events','task_id,event_type,actual_duration_minutes');assert.equal(events.filter(e=>e.task_id===first.taskId).length,2);
 const blocks=await owned('plan_blocks','id,cancelled_at');const live=new Set(blocks.filter(b=>!b.cancelled_at).map(b=>b.id));assert.equal(events.filter(e=>live.has(e.task_id)).reduce((n,e)=>n+(e.actual_duration_minutes??0),0),35);
 const replay=await req('POST','/api/log-learning',entry);assert.equal(replay.status,409);assert.equal(replay.data.code,'LOG_REMOVED');
 });
 await check('manual logging never writes answers, confidence or demonstrated understanding',async()=>{
 assert.equal((await owned('evidence_events')).length,0);assert.equal((await owned('assessment_responses')).length,0);assert.equal((await owned('confidence_marks','scope_id')).length,0);
 });
 }finally{
 if(uid){const deleted=await admin.auth.admin.deleteUser(uid);assert.equal(deleted.error,null);
 for(const table of ['plan_blocks','task_events','learning_activities','learning_log_commands','block_scope_confirmations']){const r=await admin.from(table).select('*',{count:'exact',head:true}).eq('user_id',uid);assert.equal(r.error,null);assert.equal(r.count,0)}console.log('  ✓ dedicated identity and all learning-log fixtures removed');}
 cookies.clear();
 }
 console.log(`\n${passed} live learning-log scenarios passed.`);
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
