/** Real Auth cookies -> Next task API -> hosted RPC. Owns and removes one dummy account. */
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const assert = require('node:assert/strict');
const { parse } = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const { createServerClient } = require('@supabase/ssr');

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || !/^--confirm-target=[a-z0-9]+$/.test(args[0]) || !args[1].startsWith('--base-url=')) {
    throw Error('Supply --confirm-target=<disposable-project-ref> --base-url=http://127.0.0.1:<owned-app-port>.');
  }
  const base = new URL(args[1].slice('--base-url='.length));
  if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(base.hostname) || base.pathname !== '/' || base.search || base.hash || base.username || base.password) {
    throw Error('HTTP verification only supports a loopback app server.');
  }
  const root = path.join(__dirname, '..');
  const target = parse(fs.readFileSync(path.join(root, '.env.staging.local')));
  const env = parse(fs.readFileSync(path.join(root, '.env.local')));
  const ref = args[0].slice('--confirm-target='.length);
  if (target.E2E_CONFIRMED_DISPOSABLE_PROJECT_REF !== ref || new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname !== `${ref}.supabase.co` || env.NEXT_PUBLIC_SUPABASE_URL !== target.NEXT_PUBLIC_SUPABASE_URL) {
    throw Error('App and confirmed disposable-development target must match.');
  }
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const cookies = new Map();
  const auth = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false },
    cookies: {
      getAll: () => [...cookies].map(([name, value]) => ({ name, value })),
      setAll: values => { for (const c of values) c.value ? cookies.set(c.name, c.value) : cookies.delete(c.name); },
    },
  });
  let userId, passed = 0;
  let cycleId;
  const taskId = `qa-http-${randomUUID()}`;
  const check = async (name, fn) => { await fn(); passed++; console.log(`  ✓ ${name}`); };
  const request = async (method, suffix, body, signedIn = true) => {
    const response = await fetch(new URL(suffix, base), {
      method, redirect: 'manual', signal: AbortSignal.timeout(15000),
      headers: { 'Content-Type': 'application/json', ...(signedIn ? { Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; ') } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json().catch(() => null);
    return { status: response.status, data };
  };
  const taskPath = `/api/tasks/${taskId}`;
  try {
    await check('signed-out task requests return 401', async () => {
      assert.equal((await request('GET', taskPath, undefined, false)).status, 401);
    });
    const email = `roadmap-atomic-e2e-${randomUUID()}@example.com`;
    const created = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { full_name: 'Disposable task API QA', roadmap_test_fixture: true } });
    if (created.error || !created.data.user) throw Error('Could not create the dedicated test identity.');
    userId = created.data.user.id;
    // generateLink does not send email. Keep the one-time hash and all auth cookies in memory.
    const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
    if (link.error || !link.data.properties.hashed_token) throw Error('Could not create test sign-in link.');
    const verified = await auth.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: 'magiclink' });
    if (verified.error || verified.data.user?.id !== userId) throw Error('Could not establish the test session.');
    await check('real verified session is blocked until setup is complete', async () => {
      for (const method of ['GET', 'PATCH', 'DELETE']) {
        const r = await request(method, taskPath, method === 'PATCH' ? { action: 'execution', execution: 'completed', expectedRevision: 1 } : undefined);
        assert.equal(r.status, 403); assert.equal(r.data.code, 'ONBOARDING_REQUIRED');
      }
    });
    const setup = await admin.from('profiles').update({ onboarding_status: 'complete' }).eq('id', userId);
    if (setup.error) throw Error('Could not mark the dedicated fixture setup complete.');
    const inserted = await admin.from('plan_blocks').insert({
      id: taskId, user_id: userId, title: 'Disposable task API QA block', detail: 'Dedicated endpoint verification fixture.',
      day: '2026-10-28', local_date: '2026-10-28', duration: '45', duration_minutes: 45,
      execution: 'not_started', placement: 'day_preferred', task_type: 'study', origin: 'student', created_by: 'student',
    });
    if (inserted.error) throw Error('Could not create the dedicated task fixture.');
    await check('task and empty history load through the real app API', async () => {
      const r = await request('GET', taskPath);
      assert.equal(r.status, 200); assert.equal(r.data.task.revision, 1); assert.equal(r.data.history.length, 0);
    });
    const progress = { action: 'execution', execution: 'partial', expectedRevision: 1, actualDurationMinutes: 25 };
    await check('partial progress saves through Auth, Next and the owned RPC', async () => {
      const r = await request('PATCH', taskPath, progress);
      assert.equal(r.status, 200); assert.equal(r.data.task.execution, 'partial'); assert.equal(r.data.task.revision, 2);
    });
    await check('HTTP retry produces one event and one duration observation', async () => {
      assert.equal((await request('PATCH', taskPath, progress)).status, 200);
      const r = await request('GET', taskPath);
      assert.equal(r.data.history.length, 1); assert.equal(r.data.history[0].actual_duration_minutes, 25);
    });
    await check('stale conflicting edit returns 409 and current state', async () => {
      const r = await request('PATCH', taskPath, { ...progress, execution: 'completed' });
      assert.equal(r.status, 409); assert.equal(r.data.code, 'REVISION_MISMATCH'); assert.equal(r.data.current.execution, 'partial');
    });
    await check('invalid durations and malformed action bodies return 400', async () => {
      assert.equal((await request('PATCH', taskPath, { ...progress, expectedRevision: 2, actualDurationMinutes: -1 })).status, 400);
      assert.equal((await request('PATCH', taskPath, null)).status, 400);
    });
    await check('completion without actual time preserves unknown time in history', async () => {
      assert.equal((await request('PATCH', taskPath, { action: 'execution', execution: 'completed', expectedRevision: 2 })).status, 200);
      const r = await request('GET', taskPath);
      assert.equal(r.data.task.execution, 'completed'); assert.equal(r.data.task.revision, 3);
      assert.equal(r.data.history.length, 2);
      assert.equal(r.data.history.find(e => e.event_type === 'completed').actual_duration_minutes, null);
    });
    await check('task execution never manufactures diagnostic evidence', async () => {
      const result = await admin.from('evidence_events').select('id', { count: 'exact', head: true }).eq('user_id', userId);
      assert.equal(result.error, null); assert.equal(result.count, 0);
    });
    const cycle = await admin.from('planning_cycles').insert({
      user_id:userId,status:'active',starts_at:'2026-10-26T00:00:00Z',ends_at:'2026-11-01T23:59:00Z',
      starts_at_local:'2026-10-26',ends_at_local:'2026-11-01',timezone:'UTC',anchor_day:0,
    }).select('id').single();
    if(cycle.error) throw Error('Could not create the dedicated cycle fixture.');
    cycleId=cycle.data.id;
    const los=await admin.from('reading_los').select('id,reading_id').limit(1).single();
    if(los.error) throw Error('Could not find a curriculum outcome for the test.');
    const scopeTaskId=taskId+'-scope';
    const scopeTask=await admin.from('plan_blocks').insert({
      id:scopeTaskId,user_id:userId,cycle_id:cycleId,title:'Split scope API QA',detail:'Disposable shared scope fixture.',
      day:'2026-10-28',local_date:'2026-10-28',duration:'90',duration_minutes:90,execution:'not_started',placement:'day_preferred',
      task_type:'study',outcome_id:los.data.id,learning_objective:'Preserve original LOS',suggested_approach:'Read, recall, then confirm scope.',
    });
    if(scopeTask.error) throw Error('Could not create the shared scope fixture.');
    let splitId;
    await check('split API preserves total time and mapping, and leaves its new sitting unplaced', async()=>{
      const r=await request('PATCH',`/api/tasks/${scopeTaskId}`,{action:'split',expectedRevision:1});
      assert.equal(r.status,200);splitId=r.data.secondId;
      const second=await request('GET',`/api/tasks/${splitId}`);
      assert.equal(r.data.task.duration_minutes+second.data.task.duration_minutes,90);
      assert.equal(second.data.task.outcome_id,los.data.id);assert.equal(second.data.task.learning_objective,'Preserve original LOS');
      assert.equal(second.data.task.placement,'floating');assert.equal(second.data.task.local_date,null);
      const replay=await request('PATCH',`/api/tasks/${scopeTaskId}`,{action:'split',expectedRevision:1});
      assert.equal(replay.status,200);assert.equal(replay.data.secondId,splitId);
    });
    await check('finishing the first sitting leaves shared scope unresolved in the actual Tests preview',async()=>{
      const done=await request('PATCH',`/api/tasks/${scopeTaskId}`,{action:'execution',execution:'completed',expectedRevision:2,actualDurationMinutes:20});
      assert.equal(done.status,200);
      const p=await request('GET','/api/tests/scope');assert.equal(p.status,200);
      assert.equal(p.data.preview.scope.targets.some(t=>t.outcomeId===los.data.id),false);
      assert.equal(p.data.preview.scope.unresolved.find(u=>u.blockId===scopeTaskId).reason,'split');
    });
    await check('explicit confirmation joins the paper once; the unfinished sitting stays open',async()=>{
      const c=await request('POST','/api/tests/scope/confirm',{blockId:scopeTaskId,outcomeIds:[los.data.id],expectedRevision:3});
      assert.equal(c.status,200);assert.equal(c.data.confirmed,1);
      const p=await request('GET','/api/tests/scope');assert.equal(p.data.preview.scope.targets.filter(t=>t.outcomeId===los.data.id).length,1);
      const second=await request('GET',`/api/tasks/${splitId}`);assert.equal(second.data.task.execution,'not_started');
    });
    await check('finishing all sittings produces one full outcome rather than duplicated coverage',async()=>{
      const done=await request('PATCH',`/api/tasks/${splitId}`,{action:'execution',execution:'completed',expectedRevision:1,actualDurationMinutes:25});
      assert.equal(done.status,200);
      const p=await request('GET','/api/tests/scope');
      const targets=p.data.preview.scope.targets.filter(t=>t.outcomeId===los.data.id);
      assert.equal(targets.length,1);assert.equal(targets[0].weight,1);assert.equal(p.data.preview.scope.unresolved.length,0);
    });
    const readingTaskId = taskId + '-reading';
    const readingOutcomes = await admin.from('reading_los').select('id').eq('reading_id','r028').order('id');
    assert.equal(readingOutcomes.error,null); assert.ok(readingOutcomes.data.length >= 3);
    const covered = readingOutcomes.data.slice(0,3).map(o=>o.id);
    const readingTask = await admin.from('plan_blocks').insert({
      id:readingTaskId,user_id:userId,cycle_id:cycleId,lm_id:'r028',title:'Reading-level learning loop QA',detail:'Dedicated fixture.',
      day:'2026-10-28',local_date:'2026-10-28',duration:'45',duration_minutes:45,execution:'not_started',placement:'day_preferred',task_type:'study',
    }); assert.equal(readingTask.error,null);
    const contextUrl='/api/tests/scope/confirm?blockId='+encodeURIComponent(readingTaskId);
    await check('coverage picker requires sign-in, setup and recorded progress',async()=>{
      assert.equal((await request('GET',contextUrl,undefined,false)).status,401);
      assert.equal((await request('GET',contextUrl)).status,409);
      assert.equal((await request('GET','/api/tests/scope/confirm?blockId=unknown-owned-task')).status,404);
      const done=await request('PATCH',`/api/tasks/${readingTaskId}`,{action:'execution',execution:'completed',expectedRevision:1,actualDurationMinutes:35});
      assert.equal(done.status,200);
      const context=await request('GET',contextUrl);assert.equal(context.status,200);assert.equal(context.data.reading.id,'r028');
      assert.equal(context.data.revision,2);assert.deepEqual(context.data.confirmed,[]);
    });
    const readingState=async()=>{
      const r=await request('GET','/api/curriculum/readiness');assert.equal(r.status,200);
      return r.data.tracker.topics.flatMap(t=>t.modules).find(m=>m.id==='r028');
    };
    await check('finishing a reading sitting records activity, without inferring coverage or test evidence',async()=>{
      const m=await readingState();assert.equal(m.learning.recordedSittings,1);assert.equal(m.learning.confirmedOutcomes,0);
      assert.equal(m.learning.awaitingConfirmation,1);assert.equal(m.rows.every(r=>r.band==='untested'&&r.sample===0),true);
    });
    await check('Calendar confirmation updates exactly the same three outcomes in Curriculum and Tests',async()=>{
      const save=await request('POST','/api/tests/scope/confirm',{blockId:readingTaskId,outcomeIds:covered,expectedRevision:2});assert.equal(save.status,200);
      const m=await readingState();assert.equal(m.learning.confirmedOutcomes,3);assert.equal(m.learning.awaitingConfirmation,0);
      assert.equal(m.rows.every(r=>r.band==='untested'&&r.sample===0),true);
      assert.deepEqual(m.rows.filter(r=>r.progress==='in_progress').map(r=>r.outcomeId).sort(),[...covered].sort());
      const p=await request('GET','/api/tests/scope');assert.equal(p.status,200);
      assert.deepEqual(p.data.preview.scope.targets.filter(t=>t.readingId==='r028').map(t=>t.outcomeId).sort(),[...covered].sort());
      assert.equal(p.data.preview.scope.targets.filter(t=>t.readingId==='r028').every(t=>t.kind==='new'),true);
    });
    await check('confirmation retry does not duplicate observations or curriculum targets',async()=>{
      assert.equal((await request('POST','/api/tests/scope/confirm',{blockId:readingTaskId,outcomeIds:covered,expectedRevision:2})).status,200);
      const history=await request('GET',`/api/tasks/${readingTaskId}`);assert.equal(history.data.history.length,2);
    });
    await check('stale conflicting coverage edit is refused; explicit clearing removes it live',async()=>{
      const stale=await request('POST','/api/tests/scope/confirm',{blockId:readingTaskId,outcomeIds:[],expectedRevision:2});
      assert.equal(stale.status,409);assert.equal(stale.data.code,'REVISION_MISMATCH');
      assert.equal((await request('POST','/api/tests/scope/confirm',{blockId:readingTaskId,outcomeIds:[],expectedRevision:3})).status,200);
      const m=await readingState();assert.equal(m.learning.confirmedOutcomes,0);assert.equal(m.learning.recordedSittings,1);
      assert.equal(m.rows.every(r=>r.progress!=='in_progress'&&r.band==='untested'),true);
      const p=await request('GET','/api/tests/scope');assert.equal(p.data.preview.scope.targets.some(t=>t.readingId==='r028'),false);
      assert.equal(p.data.preview.scope.unresolved.some(u=>u.blockId===readingTaskId),true);
    });
    await check('coverage commands never add scores, confidence or actual study minutes',async()=>{
      const evidence=await admin.from('evidence_events').select('id',{count:'exact',head:true}).eq('user_id',userId);
      const marks=await admin.from('confidence_marks').select('scope_id',{count:'exact',head:true}).eq('user_id',userId);
      assert.equal(evidence.error,null);assert.equal(evidence.count,0);assert.equal(marks.error,null);assert.equal(marks.count,0);
      const history=await request('GET',`/api/tasks/${readingTaskId}`);
      assert.equal(history.data.history.reduce((n,e)=>n+(e.actual_duration_minutes??0),0),35);
    });
  } finally {
    if (userId) {
      const removedTasks = await admin.from('plan_blocks').delete().eq('user_id', userId);
      if (removedTasks.error) throw Error('Dedicated test task cleanup failed; inspect the disposable QA identity.');
      if(cycleId){const removedCycle=await admin.from('planning_cycles').delete().eq('id',cycleId).eq('user_id',userId);if(removedCycle.error)throw Error('Dedicated cycle cleanup failed.');}
      const removedUser = await admin.auth.admin.deleteUser(userId);
      if (removedUser.error) throw Error('Dedicated test identity cleanup failed.');
      const remaining = await admin.from('profiles').select('id').eq('id', userId).maybeSingle();
      const events = await admin.from('task_events').select('id', { count: 'exact', head: true }).eq('user_id', userId);
      const receipts = await admin.from('task_execution_commands').select('task_id', { count: 'exact', head: true }).eq('user_id', userId);
      assert.equal(remaining.error, null); assert.equal(remaining.data, null);
      assert.equal(events.error, null); assert.equal(events.count, 0);
      assert.equal(receipts.error, null); assert.equal(receipts.count, 0);
      console.log('  ✓ dedicated test identity, task, history and receipt removed');
    }
    cookies.clear();
  }
  console.log(`\n${passed} app/Auth/API scenarios passed; no test data retained.`);
}

main().catch(error => { console.error(error instanceof assert.AssertionError ? `Task API assertion failed: ${error.message}` : error.message); process.exitCode = 1; });
