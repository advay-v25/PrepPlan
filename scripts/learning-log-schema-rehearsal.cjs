/** Rehearse the new command on the confirmed development schema; ALWAYS roll back. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto'),{Client}=require('pg'),{parse}=require('dotenv');
const {configuration,transactionalSql}=require('./lib/migrations.cjs');
async function main(){
 const env=parse(fs.readFileSync(path.join(__dirname,'../.env.staging.local')));const config=configuration(['--env=staging','--dry-run'],env);
 if(env.E2E_CONFIRMED_DISPOSABLE_PROJECT_REF!==config.identity||!process.argv.includes('--confirm-target='+config.identity))throw Error('Confirm the authorised disposable development target.');
 const c=new Client(config.connection);const uid=randomUUID();let passed=0;
 const check=(name,ok)=>{assert.ok(ok,name);passed++;console.log('  ✓ '+name)};
 try{await c.connect();await c.query('begin');await c.query("set local lock_timeout='10s'");
 if(!process.argv.includes('--already-applied'))await c.query(transactionalSql(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261030_learning_sittings.sql'),'utf8')));
 await c.query("insert into auth.users(id,email,aud,role,email_confirmed_at,created_at,updated_at) values($1,$2,'authenticated','authenticated',now(),now(),now())",[uid,`learning-rehearsal-${uid}@example.com`]);
 await c.query("update profiles set timezone='UTC',onboarding_status='complete' where id=$1",[uid]);
 await c.query("insert into planning_cycles(user_id,status,starts_at,ends_at,starts_at_local,ends_at_local,timezone,anchor_day) values($1,'active',current_date::timestamptz,(current_date+6)::timestamptz,current_date,current_date+6,'UTC',0)",[uid]);
 await c.query('set local role authenticated');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[uid]);
 const call=async(key,minutes)=>(await c.query("select record_learning_sitting('independent_study','Schema rehearsal','r028',array['r028-a','r028-b','r028-c'],$1,null,$2) as v",[minutes,key])).rows[0].v;
 const result=await call('schema-rehearsal',45);check('real-schema sitting saves one block and three exact outcomes',result.ok&&result.blocks===1&&result.outcomes===3&&result.inCycle);
 check('retry reuses the saved sitting',(await call('schema-rehearsal',45)).replayed===true);
 check('changed retry cannot silently replace it',(await call('schema-rehearsal',60)).code==='IDEMPOTENCY_CONFLICT');
 const unknown=await call('schema-unknown-time',null);check('unknown duration is retained',unknown.minutes===null);
 await c.query('reset role');
 const q=(await c.query("select (select count(*)::int from plan_blocks where user_id=$1) as blocks,(select sum(actual_duration_minutes)::int from task_events where user_id=$1) as minutes,(select count(*)::int from evidence_events where user_id=$1) as evidence,(select count(*)::int from user_module_state where user_id=$1) as coverage",[uid])).rows[0];
 check('two logs produce two blocks and exactly 45 reported minutes',q.blocks===2&&q.minutes===45);
 check('no evidence or whole-reading coverage is manufactured',q.evidence===0&&q.coverage===0);
 await c.query('set local role authenticated');
 const removed=(await c.query('select cancel_learning_sitting($1,1) as v',[result.taskId])).rows[0].v;check('removal succeeds on the actual schema',removed.ok===true);
 check('removed log cannot be resurrected by a network retry',(await call('schema-rehearsal',45)).code==='LOG_REMOVED');
 await c.query('reset role');await c.query('delete from auth.users where id=$1',[uid]);await c.query('set constraints all immediate');
 const remaining=(await c.query('select count(*)::int as n from plan_blocks where user_id=$1',[uid])).rows[0].n;check('account deletion cascades through the new links',remaining===0);
 console.log(`\n${passed} real-schema checks passed; rolling back all objects and fixture data.`);
 }finally{await c.query('rollback').catch(()=>{});await c.end()}
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
