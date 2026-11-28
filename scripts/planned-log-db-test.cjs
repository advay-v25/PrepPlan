/** log_planned_session in a disposable LOCAL cluster: atomic minutes + status + coverage, replay, races, refusals. */
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {execFileSync}=require('node:child_process');const assert=require('node:assert/strict');const {Client}=require('pg');
const read=f=>fs.readFileSync(path.join(__dirname,f),'utf8');
async function main(){
 const bin=execFileSync('pg_config',['--bindir'],{encoding:'utf8'}).trim();const dir=fs.mkdtempSync(path.join(os.tmpdir(),'roadmap-planned-'));
 const port=await new Promise(r=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p))})});
 const pg=(n,a)=>execFileSync(path.join(bin,n),a,{stdio:'pipe'});const clients=[];let started=false,passed=0;
 const connect=async()=>{const c=new Client({host:'127.0.0.1',port,user:'test',database:'postgres'});await c.connect();clients.push(c);return c};
 try{
 pg('initdb',['-D',dir+'/data','-U','test','--auth-local=trust','--auth-host=trust','--no-locale']);pg('pg_ctl',['-D',dir+'/data','-l',dir+'/log','-o',`-p ${port} -h 127.0.0.1 -k ${dir}`,'-w','start']);started=true;
 const db=await connect();const scalar=async(sql,a)=>(await db.query(sql,a)).rows[0].v;
 const check=async(name,fn)=>{await fn();passed++;console.log('  ✓ '+name)};
 await db.query(read('fixtures/task-execution.sql'));
 await db.query(`create role service_role nologin;
 alter table plan_blocks add continued_from_task_id text,add learning_activity_id uuid,add scope_group_id uuid;
 alter table planning_cycles alter id set default gen_random_uuid();
 insert into reading_los values('a','r1'),('b','r1'),('c','r1'),('other','r2');`);
 await db.query(read('../supabase/migrations/20261028_atomic_task_execution.sql'));
 await db.query(read('../supabase/migrations/20261122_system_assessment_tasks.sql'));
 await db.query(read('fixtures/confirm-task-scope.sql'));
 await db.query(read('../supabase/migrations/20270201_log_planned_session.sql'));
 const owner='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002',incomplete='00000000-0000-4000-8000-000000000003',unverified='00000000-0000-4000-8000-000000000004';
 for(const id of [owner,other,incomplete,unverified]){await db.query('insert into auth.users values($1,$2)',[id,id===unverified?null:new Date()]);await db.query('insert into profiles(id,onboarding_status) values($1,$2)',[id,id===incomplete?'in_progress':'complete'])}
 const cycle=await scalar("insert into planning_cycles(id,user_id,status) values(gen_random_uuid(),$1,'active') returning id as v",[owner]);
 const oldCycle=await scalar("insert into planning_cycles(id,user_id,status) values(gen_random_uuid(),$1,'closed') returning id as v",[owner]);
 let n=0;const block=async(o={})=>{const id='t'+(++n);await db.query(`insert into plan_blocks(id,user_id,title,local_date,duration_minutes,placement,execution,lm_id,task_type,cycle_id,outcome_id)
  values($1,$2,$3,current_date,$4,'day_preferred','not_started',$5,$6,$7,$8)`,[id,o.user??owner,'Study '+id,o.minutes??45,'lm' in o?o.lm:'r1',o.type??'study',o.cycle??cycle,o.outcome??null]);return id};
 const asUser=async id=>{const c=await connect();await c.query('set role authenticated');await c.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);return c};
 const learner=await asUser(owner),second=await asUser(owner),outsider=await asUser(other);
 const call=async(c,task,key,o={})=>(await c.query('select log_planned_session($1,$2,$3,$4,$5,$6,$7,$8) as v',[o.user??owner,task,o.rev??1,o.exec??'partial','minutes' in o?o.minutes:25,o.outcomes??['a'],o.note??null,key])).rows[0].v;
 const counts=async t=>({events:await scalar('select count(*)::int as v from task_events where task_id=$1',[t]),conf:await scalar('select count(*)::int as v from block_scope_confirmations where block_id=$1',[t]),
  receipts:await scalar('select count(*)::int as v from planned_log_commands where task_id=$1',[t]),exec:await scalar('select execution as v from plan_blocks where id=$1',[t]),rev:await scalar('select revision as v from plan_blocks where id=$1',[t])});

 let t1;
 await check('45-minute block: 25 minutes and one outcome commit as one save',async()=>{
  t1=await block();const r=await call(learner,t1,'plan-one');
  assert.equal(r.ok,true);assert.equal(r.execution,'partial');assert.equal(r.minutes,25);assert.deepEqual(r.scope,{state:'confirmed',confirmed:1});assert.equal(r.replayed,false);
  const c=await counts(t1);assert.equal(c.exec,'partial');assert.equal(c.conf,1);assert.equal(c.receipts,1);assert.equal(r.revision,c.rev);
  assert.equal(await scalar("select count(*)::int as v from task_events where task_id=$1 and event_type='partial'",[t1]),1);
  assert.equal(await scalar('select sum(actual_duration_minutes)::int as v from task_events where task_id=$1',[t1]),25);
  assert.equal(await scalar('select count(*)::int as v from plan_blocks where id like $1',['t%']),1);
  assert.equal(await scalar('select count(*)::int as v from evidence_events'),0);
 });
 await check('same key and payload replays the original receipt without writing',async()=>{
  const before=await counts(t1);const r=await call(learner,t1,'plan-one');assert.equal(r.replayed,true);assert.equal(r.minutes,25);assert.deepEqual(await counts(t1),before);
 });
 await check('same key with a changed payload conflicts without writing',async()=>{
  const before=await counts(t1);for(const o of [{minutes:30},{outcomes:['a','b']},{exec:'completed'}])assert.equal((await call(learner,t1,'plan-one',o)).code,'IDEMPOTENCY_CONFLICT');assert.deepEqual(await counts(t1),before);
 });
 await check('concurrent double submit commits once',async()=>{
  const t=await block();const r=await Promise.all([call(learner,t,'race-key',{exec:'completed',minutes:45}),call(second,t,'race-key',{exec:'completed',minutes:45})]);
  assert.equal(r.filter(x=>x.replayed).length,1);const c=await counts(t);assert.equal(c.events,2);assert.equal(c.receipts,1);assert.equal(c.exec,'completed');
 });
 await check('a stale revision under a new key is refused and writes nothing',async()=>{
  const before=await counts(t1);const r=await call(learner,t1,'stale-key',{rev:1,minutes:20});assert.equal(r.code,'REVISION_MISMATCH');assert.deepEqual(await counts(t1),before);
 });
 await check('the continuation can be logged for the remaining 20 minutes',async()=>{
  const t=await block({minutes:20});await db.query('update plan_blocks set continued_from_task_id=$1 where id=$2',[t1,t]);
  const r=await call(learner,t,'finish-key',{exec:'completed',minutes:20,outcomes:['b']});assert.equal(r.ok,true);
  assert.equal(await scalar("select (select sum(actual_duration_minutes) from task_events where task_id in ($1,$2))::int as v",[t1,t]),45);
 });
 await check('a block that already continued, recorded learning or closed history is refused unchanged',async()=>{
  const before=await counts(t1);assert.equal((await call(learner,t1,'continued-key',{rev:3})).code,'CONTINUED');assert.deepEqual(await counts(t1),before);
  const old=await block({cycle:oldCycle});assert.equal((await call(learner,old,'old-key-1')).code,'HISTORY_CLOSED');assert.equal((await counts(old)).events,0);
  const rec=await block();await db.query("update plan_blocks set learning_activity_id=gen_random_uuid() where id=$1",[rec]);assert.equal((await call(learner,rec,'rec-key-1')).code,'RECORDED_LEARNING');
 });
 await check('an outcome outside the block rolls back the whole save',async()=>{
  const t=await block();await assert.rejects(()=>call(learner,t,'bad-outcome',{outcomes:['a','other']}));
  const c=await counts(t);assert.deepEqual(c,{events:0,conf:0,receipts:0,exec:'not_started',rev:1});
 });
 await check('a time-only log saves minutes with no coverage and says so',async()=>{
  const t=await block();const r=await call(learner,t,'time-only',{exec:'completed',outcomes:[],minutes:45});assert.deepEqual(r.scope,{state:'time_only',confirmed:0});
  const c=await counts(t);assert.equal(c.conf,0);assert.equal(c.exec,'completed');
 });
 await check('foreign blocks, bad input, other task types and unverified accounts are refused',async()=>{
  const t=await block();await assert.rejects(()=>call(outsider,t,'foreign-key',{user:other}),/not found/i);
  for(const o of [{exec:'skipped'},{minutes:0},{minutes:721}])await assert.rejects(()=>call(learner,t,'bad-input',o));
  const paper=await block({type:'diagnostic'});await assert.rejects(()=>call(learner,paper,'paper-key'));
  for(const id of [incomplete,unverified]){const c=await asUser(id);await assert.rejects(()=>call(c,t,'guard-key',{user:id}))}
  assert.equal((await counts(t)).events,0);
 });
 await check('a block with no reading logs time only; outcomes cannot be attached',async()=>{
  const t=await block({lm:null});await assert.rejects(()=>call(learner,t,'noreading-key'));assert.equal((await counts(t)).events,0);
  assert.equal((await call(learner,t,'noreading-time',{outcomes:[],exec:'completed'})).scope.state,'time_only');
 });
 await check('privileges: authenticated may call it, anonymous may not, receipts are not writable',async()=>{
  assert.equal(await scalar("select has_function_privilege('anon','log_planned_session(uuid,text,integer,text,integer,text[],text,text)','execute') as v"),false);
  assert.equal(await scalar("select has_function_privilege('authenticated','log_planned_session(uuid,text,integer,text,integer,text[],text,text)','execute') as v"),true);
  assert.equal(await scalar("select has_table_privilege('authenticated','planned_log_commands','insert') as v"),false);
  assert.equal((await outsider.query('select count(*)::int as n from planned_log_commands')).rows[0].n,0);
 });
 console.log(`\n${passed} planned-log checks passed`);
 }finally{for(const c of clients)await c.end().catch(()=>{});if(started)try{pg('pg_ctl',['-D',dir+'/data','-m','immediate','stop'])}catch{};fs.rmSync(dir,{recursive:true,force:true})}
}
main().catch(e=>{console.error(e);process.exit(1)});
