/** Real SQL, concurrent commands and rollback faults in a disposable LOCAL cluster. */
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {execFileSync}=require('node:child_process');const assert=require('node:assert/strict');const {Client}=require('pg');
async function main(){
 const bin=execFileSync('pg_config',['--bindir'],{encoding:'utf8'}).trim();const dir=fs.mkdtempSync(path.join(os.tmpdir(),'roadmap-log-'));
 const port=await new Promise(r=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p))})});
 const pg=(n,args)=>execFileSync(path.join(bin,n),args,{stdio:'pipe'});const clients=[];let started=false,passed=0;
 const connect=async()=>{const c=new Client({host:'127.0.0.1',port,user:'test',database:'postgres'});await c.connect();clients.push(c);return c};
 try{
 pg('initdb',['-D',dir+'/data','-U','test','--auth-local=trust','--auth-host=trust','--no-locale']);pg('pg_ctl',['-D',dir+'/data','-l',dir+'/log','-o',`-p ${port} -h 127.0.0.1 -k ${dir}`,'-w','start']);started=true;
 const db=await connect();const scalar=async(sql,args)=>(await db.query(sql,args)).rows[0].v;
 const check=async(name,fn)=>{await fn();passed++;console.log('  ✓ '+name)};
 await db.query(fs.readFileSync(path.join(__dirname,'fixtures/task-execution.sql'),'utf8'));
 await db.query(`alter table profiles add timezone text default 'Asia/Kolkata';
 alter table plan_blocks alter duration_minutes drop not null;
 alter table plan_blocks add day text,add rationale text,add priority text,add cancellation_reason text,add scope_group_id uuid,add continued_from_task_id text;
 alter table plan_blocks drop constraint plan_blocks_user_id_fkey;
 alter table plan_blocks add foreign key(user_id) references profiles(id) on delete cascade;
 alter table planning_cycles add starts_at_local date,add ends_at_local date;
 create table learning_modules(id text primary key);
 create table curriculum_readings(id text primary key,title text,is_active boolean,structure_pending boolean);
 create table learning_activities(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users on delete cascade,
 activity_type text,description text,lm_id text references learning_modules,duration_minutes integer,related_task_id text references plan_blocks on delete set null);
 create function log_learning_with_coverage(text,text,text,text,integer,text) returns uuid language sql as $$select gen_random_uuid()$$;
 grant execute on function log_learning_with_coverage(text,text,text,text,integer,text) to authenticated;
 insert into learning_modules values('r1'),('r2');insert into curriculum_readings values('r1','Reading one',true,false),('r2','Pending',true,true);
 insert into reading_los values('a','r1'),('b','r1'),('c','r1'),('other','r2');`);
 const editing=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20260908_c2_calendar_editing.sql'),'utf8');await db.query(editing.split('-- 2. Recurrence')[0]);
 await db.query(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261028_atomic_task_execution.sql'),'utf8'));
 await db.query(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261030_learning_sittings.sql'),'utf8'));
 const owner='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002',incomplete='00000000-0000-4000-8000-000000000003',unverified='00000000-0000-4000-8000-000000000004';
 for(const id of [owner,other,incomplete,unverified]){await db.query('insert into auth.users values($1,$2)',[id,id===unverified?null:new Date()]);await db.query('insert into profiles(id,onboarding_status) values($1,$2)',[id,id===incomplete?'in_progress':'complete'])}
 await db.query("insert into planning_cycles(id,user_id,status,starts_at_local,ends_at_local) values(gen_random_uuid(),$1,'active',current_date-1,current_date+5)",[owner]);
 const asUser=async id=>{const c=await connect();await c.query('set role authenticated');await c.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);return c};
 const learner=await asUser(owner),second=await asUser(owner),outsider=await asUser(other);
 const call=async(c,key,minutes=45,outcomes=['a','b','c'],date=null,reading='r1')=>(await c.query('select record_learning_sitting($1,$2,$3,$4,$5,$6,$7) as v',['independent_study','One sitting',reading,outcomes,minutes,date,key])).rows[0].v;
 let first;
 await check('one sitting with three outcomes stores one exact time observation',async()=>{
 first=await call(learner,'one-sitting');assert.equal(first.blocks,1);assert.equal(first.outcomes,3);assert.equal(first.minutes,45);
 assert.equal(await scalar('select count(*)::int as v from plan_blocks'),1);assert.equal(await scalar('select count(*)::int as v from block_scope_confirmations'),3);
 assert.equal(await scalar('select sum(actual_duration_minutes)::int as v from task_events'),45);assert.equal(await scalar('select duration_minutes as v from plan_blocks'),null);
 assert.equal(await scalar('select count(*)::int as v from evidence_events'),0);
 });
 await check('same normalized retry replays, changed input conflicts without writing',async()=>{
 assert.equal((await call(learner,'one-sitting',45,['c','b','a','a'])).replayed,true);
 assert.equal((await call(learner,'one-sitting',60)).code,'IDEMPOTENCY_CONFLICT');
 assert.equal(await scalar('select count(*)::int as v from task_events'),1);
 });
 await check('concurrent double-submit creates exactly one sitting and receipt',async()=>{
 const r=await Promise.all([call(learner,'concurrent-log'),call(second,'concurrent-log')]);assert.equal(r[0].taskId,r[1].taskId);assert.equal(r.filter(x=>x.replayed).length,1);
 });
 await check('unknown time remains null and one-minute time is not inflated',async()=>{
 const unknown=await call(learner,'unknown-time',null);assert.equal(unknown.minutes,null);
 assert.equal(await scalar('select actual_duration_minutes as v from task_events where task_id=$1',[unknown.taskId]),null);
 const short=await call(learner,'short-time',1,['a']);assert.equal(short.minutes,1);
 assert.equal(await scalar('select actual_duration_minutes as v from task_events where task_id=$1',[short.taskId]),1);
 const long=await call(learner,'long-time',720,['a']);assert.equal(long.minutes,720);
 });
 await check('bad duration, foreign outcomes, pending readings and future dates are rejected',async()=>{
 for(const m of [0,721,-1])await assert.rejects(()=>call(learner,'invalid-duration',m));
 await assert.rejects(()=>call(learner,'wrong-reading',45,['a','other']));await assert.rejects(()=>call(learner,'pending-reading',45,['other'],null,'r2'));
 const tomorrow=await scalar("select ((now() at time zone 'Asia/Kolkata')::date+1)::text as v");await assert.rejects(()=>call(learner,'future-date',45,['a'],tomorrow));
 });
 await check('dated history outside the open cycle is not attached to the current paper',async()=>{
 const old=await scalar("select ((now() at time zone 'Asia/Kolkata')::date-5)::text as v");const r=await call(learner,'historic-log',null,['a'],old);assert.equal(r.inCycle,false);
 });
 await check('verification and setup are enforced inside the RPC',async()=>{
 for(const id of [incomplete,unverified]){const c=await asUser(id);await assert.rejects(()=>call(c,'guard-test'))}
 });
 await check('owner receipts and cancellation do not expose another student',async()=>{
 assert.equal((await outsider.query('select count(*)::int as n from learning_log_commands')).rows[0].n,0);
 await assert.rejects(()=>outsider.query('select cancel_learning_sitting($1,1)',[first.taskId]));
 });
 await check('old whole-reading writer and direct learning-activity writes are no longer allowed',async()=>{
 assert.equal(await scalar("select has_function_privilege('authenticated','log_learning_with_coverage(text,text,text,text,integer,text)','execute') as v"),false);
 assert.equal(await scalar("select has_table_privilege('authenticated','learning_activities','insert') as v"),false);
 });
 await check('logs cannot be moved, reopened or given another time observation',async()=>{
 await assert.rejects(()=>db.query('update plan_blocks set local_date=local_date+1 where id=$1',[first.taskId]));
 await assert.rejects(()=>learner.query("select set_task_execution($1,$2,1,'completed',20,null)",[owner,first.taskId]));
 assert.equal(await scalar('select revision as v from plan_blocks where id=$1',[first.taskId]),1);
 await assert.rejects(()=>db.query('delete from plan_blocks where id=$1',[first.taskId]));
 });
 await check('scope edits remain possible without repeating time',async()=>{
 await db.query('delete from block_scope_confirmations where block_id=$1 and outcome_id=$2',[first.taskId,'c']);
 await db.query('update plan_blocks set revision=revision+1 where id=$1',[first.taskId]);
 assert.equal(await scalar('select sum(actual_duration_minutes)::int as v from task_events where task_id=$1',[first.taskId]),45);
 });
 await check('stale removal is refused; correct removal is atomic and retry-safe',async()=>{
 const stale=(await learner.query('select cancel_learning_sitting($1,1) as v',[first.taskId])).rows[0].v;assert.equal(stale.code,'REVISION_MISMATCH');
 assert.equal((await learner.query('select cancel_learning_sitting($1,2) as v',[first.taskId])).rows[0].v.ok,true);
 assert.equal((await learner.query('select cancel_learning_sitting($1,2) as v',[first.taskId])).rows[0].v.replayed,true);
 assert.equal((await call(learner,'one-sitting')).code,'LOG_REMOVED');
 assert.equal(await scalar("select count(*)::int as v from task_events where task_id=$1 and event_type='cancelled'",[first.taskId]),1);
 });
 await db.query(`create function fail_learning_receipt() returns trigger language plpgsql as $$begin if new.idempotency_key='force-failure' then raise exception 'fixture fault';end if;return new;end;$$;
 create trigger fixture_receipt_fault before insert on learning_log_commands for each row execute function fail_learning_receipt();`);
 await check('receipt failure rolls back activity, block, confirmations and reported time together',async()=>{
 const count=async()=>(await db.query('select (select count(*) from plan_blocks) as blocks,(select count(*) from learning_activities) as activities,(select count(*) from task_events) as events,(select count(*) from block_scope_confirmations) as scope')).rows[0];
 const before=await count();await assert.rejects(()=>call(learner,'force-failure'));assert.deepEqual(await count(),before);
 });
 await check('account deletion can cascade through logged history and receipts',async()=>{
 await db.query('delete from auth.users where id=$1',[owner]);assert.equal(await scalar('select count(*)::int as v from plan_blocks'),0);assert.equal(await scalar('select count(*)::int as v from learning_activities'),0);assert.equal(await scalar('select count(*)::int as v from learning_log_commands'),0);
 });
 console.log(`\n${passed} learning-log SQL scenarios passed; local cluster removed.`);
 }finally{for(const c of clients)await c.end().catch(()=>{});if(started)pg('pg_ctl',['-D',dir+'/data','-m','immediate','-w','stop']);fs.rmSync(dir,{recursive:true,force:true})}
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
