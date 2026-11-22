/** Own-account Auth → API repair acceptance and Coach regression. No shared learner reset or question writes. */
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { parse } = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const { createServerClient } = require('@supabase/ssr');

async function main() {
  const args = process.argv.slice(2), ref = args.find(a => a.startsWith('--confirm-target='))?.slice(17);
  const env = parse(fs.readFileSync(path.join(__dirname, '../.env.local')));
  const dev = parse(fs.readFileSync(path.join(__dirname, '../.env.staging.local')));
  assert.ok(ref && ref === dev.E2E_CONFIRMED_DISPOSABLE_PROJECT_REF && new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname === `${ref}.supabase.co`, 'Confirm the disposable development project.');
  const file = '/tmp/roadmap-repair-browser.json';
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const data = async q => { const r = await q; if (r.error) throw Error(r.error.message); return r.data; };
  async function cleanup(uid) {
    const user = await admin.auth.admin.getUserById(uid);
    assert.equal(user.data.user?.user_metadata?.roadmap_repair_fixture, true, 'Only an owned repair fixture can be removed.');
    const attempts = await data(admin.from('assessment_attempts').select('form_id').eq('user_id', uid));
    const formIds = attempts.map(a => a.form_id).filter(Boolean);
    const forms = formIds.length ? await data(admin.from('assessment_forms').select('id,blueprint_id').in('id', formIds)) : [];
    const deleted = await admin.auth.admin.deleteUser(uid); assert.equal(deleted.error, null);
    for (const t of ['plan_blocks', 'repair_threads', 'repair_check_threads', 'evidence_events', 'coach_messages', 'coach_proposals', 'assessment_attempts']) {
      const r = await admin.from(t).select('*', { count: 'exact', head: true }).eq('user_id', uid); assert.equal(r.error, null); assert.equal(r.count, 0, t);
    }
    for (const f of forms) {
      const used = await data(admin.from('assessment_attempts').select('id').eq('form_id', f.id)); assert.equal(used.length, 0);
      await data(admin.from('form_items').delete().eq('form_id', f.id));
      await data(admin.from('assessment_forms').delete().eq('id', f.id));
      await data(admin.from('assessment_blueprints').delete().eq('id', f.blueprint_id));
    }
    console.log('  ✓ own account, repair records and fixture papers removed');
  }
  if (args.includes('--cleanup-browser')) {
    const f = JSON.parse(fs.readFileSync(file)); await cleanup(f.uid); fs.unlinkSync(file); return;
  }
  const keep = args.includes('--browser-fixture');
  if (keep && fs.existsSync(file)) throw Error('Clean the existing browser fixture first.');
  const base = new URL(args.find(a => a.startsWith('--base-url='))?.slice(11));
  assert.ok(base.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(base.hostname) && base.pathname === '/' && !base.username && !base.password && !base.search && !base.hash, 'Use a loopback app URL.');
  const cookies = new Map();
  const auth = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { autoRefreshToken: false }, cookies: {
    getAll: () => [...cookies].map(([name, value]) => ({ name, value })), setAll: cs => cs.forEach(c => cookies.set(c.name, c.value)),
  } });
  const req = async (method, url, body, signed = true) => {
    const r = await fetch(new URL(url, base), { method, redirect: 'manual', signal: AbortSignal.timeout(30000), headers: {
      'Content-Type': 'application/json', ...(signed ? { Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; ') } : {}),
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const routes = [['POST', '/api/coach', { message: 'What next?', intent: 'next' }], ['GET', '/api/coach/history'], ['DELETE', '/api/coach/history'], ['POST', `/api/coach/proposals/${randomUUID()}`, { decision: 'accept' }]];
  let uid, passed = 0, retained = false;
  const check = async (name, fn) => { await fn(); passed++; console.log(`  ✓ ${name}`); };
  try {
    await check('all Coach routes reject signed-out callers', async () => { for (const [m, p, b] of routes) assert.equal((await req(m, p, b, false)).status, 401); });
    const email = `roadmap-repair-${randomUUID()}@example.com`;
    const created = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { full_name: 'Repair Loop QA', roadmap_repair_fixture: true } });
    assert.equal(created.error, null); uid = created.data.user.id;
    if (keep) fs.writeFileSync(file, JSON.stringify({ uid }), { mode: 0o600 });
    const link = await admin.auth.admin.generateLink({ type: 'magiclink', email }); assert.equal(link.error, null);
    assert.equal((await auth.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: 'magiclink' })).error, null);
    await check('all Coach routes reject incomplete setup without writing conversation', async () => {
      for (const [m, p, b] of routes) { const r = await req(m, p, b); assert.equal(r.status, 403); assert.equal(r.body.code, 'ONBOARDING_REQUIRED'); }
      assert.equal((await data(admin.from('coach_messages').select('id').eq('user_id', uid))).length, 0);
    });
    await data(admin.from('profiles').update({ onboarding_status: 'complete', timezone: 'Asia/Kolkata', max_session_minutes: 45 }).eq('id', uid));
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const mon = new Date(`${today}T12:00:00Z`); mon.setUTCDate(mon.getUTCDate() - (mon.getUTCDay() + 6) % 7);
    const sun = new Date(mon); sun.setUTCDate(sun.getUTCDate() + 6);
    const start = mon.toISOString().slice(0, 10), end = sun.toISOString().slice(0, 10);
    const cyc = await data(admin.from('planning_cycles').insert({ user_id: uid, status: 'active', starts_at: `${start}T00:00:00+05:30`, ends_at: `${end}T23:59:59+05:30`, starts_at_local: start, ends_at_local: end, timezone: 'Asia/Kolkata', anchor_day: 0 }).select('id').single());
    await data(admin.from('availability_windows').insert([0, 1, 2, 3, 4, 5, 6].map(weekday => ({ user_id: uid, weekday, start_time: '06:00', end_time: '23:59', source: 'onboarding', status: 'active' }))));
    const manifest = await data(admin.from('curriculum_manifests').select('id').eq('is_active', true).single());
    const concepts = await data(admin.from('curriculum_concepts').select('id').eq('manifest_id', manifest.id));
    // Only items with a recorded approval for their CURRENT version can enter a form (the guard is never bypassed): a fixture bank (scripts/fixture-bank.cjs create) supplies them.
    const reviewed = await data(admin.from('assessment_items').select('id,concept_id,lm_id,outcome_id,key_index,item_version').eq('review_status', 'reviewed').in('concept_id', concepts.map(c => c.id)).order('id'));
    const approvals = new Set((await data(admin.from('item_review_decisions').select('item_id,item_version').eq('decision', 'approve').in('item_id', reviewed.map(i => i.id)))).map(d => `${d.item_id}:${d.item_version}`));
    const items = reviewed.filter(i => approvals.has(`${i.id}:${i.item_version}`));
    if (!items.length) { console.log('UNAVAILABLE: no item with a recorded approval for its current version exists, so no valid fixture paper can be built. Create a fixture bank first (node scripts/fixture-bank.cjs create --readings=r028,r029 ...). This is missing inventory, not a pass.'); process.exitCode = 0; return }
    const groups = new Map(); for (const i of items) if (i.outcome_id && i.lm_id) groups.set(i.concept_id, [...(groups.get(i.concept_id) ?? []), i]);
    const chosen = [...groups.values()].filter(g => g.length >= 2).slice(0, 2); assert.ok(chosen.length > 0, 'Need an existing reviewed concept; no bank item will be fabricated.');
    const bp = await data(admin.from('assessment_blueprints').insert({ manifest_id: manifest.id, purpose: 'weekly_cumulative', requested_scope: { fixture: true }, constraints: { fixture: true } }).select('id').single());
    const form = await data(admin.from('assessment_forms').insert({ blueprint_id: bp.id, delivery_mode: 'fixed' }).select('id').single());
    await data(admin.from('form_items').insert(chosen.map((g, i) => ({ form_id: form.id, item_id: g[0].id, sequence_number: i + 1 }))));
    const attempt = await data(admin.from('assessment_attempts').insert({ user_id: uid, form_id: form.id, delivery_mode: 'fixed', status: 'in_progress', attempt_kind: 'weekly', cycle_id: cyc.id }).select('id').single());
    // A small pre-seeded paper isolates repair behaviour; it is not a real ordinary-paper generation test.
    await data(admin.from('assessment_responses').insert(chosen.map(g => ({ user_id: uid, attempt_id: attempt.id, item_id: g[0].id, selected_option_index: (g[0].key_index + 1) % 3, is_correct: false, self_reported_confidence: 4 }))));
    await check('a scored fixture opens one thread per concept, not repeated paper episodes', async () => {
      for (let i = 0; i < 2; i++) assert.equal((await req('POST', `/api/tests/attempt/${attempt.id}/submit`, {})).status, 200);
      const threads = await data(admin.from('repair_threads').select('id,occurrence_count').eq('user_id', uid)); assert.equal(threads.length, chosen.length); assert.ok(threads.every(t => t.occurrence_count === 1));
    });
    await check('Coach uses a provenance-linked follow-up and creates no repair task/proposal', async () => {
      const r = await req('POST', '/api/coach', { message: 'I keep getting this wrong.', intent: 'struggling' }); assert.equal(r.status, 200);
      assert.equal(r.body.proposals.length, 0); assert.ok(r.body.links.some(l => l.href === `/app/tests/${attempt.id}/result#proposal-h`));
      assert.equal((await data(admin.from('plan_blocks').select('id').eq('user_id', uid))).length, 0);
    });
    const old = await data(admin.from('coach_proposals').insert({ user_id: uid, intent: 'recheck_block', kind: 'recheck_block', origin: 'coach', status: 'pending', title: 'Old repair card', reasoning: 'Owned fixture', proposed_changes: { date: today } }).select('id').single());
    await check('old Coach cards become stale without claiming execution or writing a task', async () => {
      const r = await req('POST', `/api/coach/proposals/${old.id}`, { decision: 'accept' }); assert.equal(r.status, 409); assert.equal(r.body.code, 'STALE'); assert.ok(r.body.nextUrl.includes(attempt.id));
      assert.equal((await data(admin.from('plan_blocks').select('id').eq('user_id', uid))).length, 0);
    });
    const read = () => req('GET', `/api/diagnostic/repair?attemptId=${attempt.id}`);
    await check('opening follow-up is read-only and exposes the exact current threads', async () => { for (let i = 0; i < 2; i++) assert.equal((await read()).body.items.length, chosen.length); assert.equal((await data(admin.from('plan_blocks').select('id').eq('user_id', uid))).length, 0); });
    if (keep) {
      const browser = await admin.auth.admin.generateLink({ type: 'magiclink', email }); assert.equal(browser.error, null);
      fs.writeFileSync(file, JSON.stringify({ uid, attemptId: attempt.id, baseUrl: base.origin, url: `${base.origin}/auth/verify#type=magiclink&token_hash=${encodeURIComponent(browser.data.properties.hashed_token)}&next=${encodeURIComponent('/app/coach')}` }), { mode: 0o600 });
      retained = true; console.log('Browser fixture prepared; open the private link and select Continue.'); return;
    }
    let preview;
    await check('preview changes no Calendar task and preserves explicit thread provenance', async () => {
      const r = await req('POST', '/api/diagnostic/repair/preview', { attemptId: attempt.id }); assert.equal(r.status, 200); preview = r.body;
      assert.ok(preview.plan.tasks.length > 0, 'The current local day needs remaining capacity.'); assert.ok(preview.plan.tasks.every(t => t.duration_minutes <= 45));
      assert.equal((await data(admin.from('plan_blocks').select('id').eq('user_id', uid))).length, 0);
    });
    await check('clearing Coach history leaves the diagnostic proposal available for acceptance', async () => {
      assert.equal((await req('DELETE', '/api/coach/history')).status, 200);
      const p = await data(admin.from('coach_proposals').select('status').eq('id', preview.proposalId).single()); assert.equal(p.status, 'pending');
    });
    await check('concurrent accepts and retry return one exact task set', async () => {
      const body = { proposalId: preview.proposalId, idempotencyKey: 'http-' + randomUUID() };
      const rs = await Promise.all([req('POST', '/api/diagnostic/repair/accept', body), req('POST', '/api/diagnostic/repair/accept', body)]);
      assert.ok(rs.every(r => r.status === 200), 'Both accept responses should replay/succeed.'); assert.deepEqual(rs[0].body.taskIds, rs[1].body.taskIds);
      const blocks = await data(admin.from('plan_blocks').select('id,repair_thread_id,learning_objective,suggested_approach').eq('user_id', uid));
      assert.equal(blocks.length, preview.plan.tasks.length + Number(!!preview.plan.check)); assert.ok(blocks.filter(b => b.repair_thread_id).every(b => b.learning_objective));
    });
    await check('accepted repairs can be completed with unknown time without creating new evidence', async () => {
      const before = (await data(admin.from('evidence_events').select('id').eq('user_id', uid))).length;
      const blocks = await data(admin.from('plan_blocks').select('id,revision,task_type').eq('user_id', uid));
      for (const b of blocks.filter(b => b.task_type === 'repair')) { const r = await req('PATCH', `/api/tasks/${b.id}`, { action: 'execution', execution: 'completed', expectedRevision: b.revision }); assert.equal(r.status, 200); }
      assert.equal((await data(admin.from('evidence_events').select('id').eq('user_id', uid))).length, before);
      assert.ok((await data(admin.from('repair_threads').select('status').eq('user_id', uid))).every(t => t.status === 'awaiting_recheck'));
    });
    await check('a future Calendar check waits even after repair completion', async () => {
      const tomorrow = new Date(`${today}T12:00:00Z`); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      const id = `qa-future-check-${randomUUID()}`;
      const date = tomorrow.toISOString().slice(0, 10);
      await data(admin.from('plan_blocks').insert({ id, user_id: uid, cycle_id: cyc.id, title: 'Future check fixture', detail: 'Owned future-date guard fixture', task_type: 'recheck', execution: 'not_started', placement: 'day_preferred', local_date: date, day: date, duration_minutes: 15, duration: '15' }));
      const threads = await data(admin.from('repair_threads').select('id').eq('user_id', uid));
      await data(admin.from('repair_check_threads').insert(threads.map(t => ({ check_task_id: id, thread_id: t.id, user_id: uid }))));
      const p = await req('POST', '/api/tests/preflight', { kind: 'repair', checkTaskId: id }); assert.equal(p.status, 200); assert.equal(p.body.decision.state, 'waiting');
      const r = await req('POST', '/api/tests/start', { kind: 'repair', checkTaskId: id }); assert.equal(r.status, 409); assert.equal(r.body.code, 'no_scope'); assert.match(r.body.message, /spacing/);
      await data(admin.from('plan_blocks').update({ local_date: today, day: today }).eq('id', id).eq('user_id', uid));
      const moved = await req('POST', '/api/tests/start', { kind: 'repair', checkTaskId: id });
      assert.equal(moved.status, 409); assert.match(moved.body.message, /spacing/, 'Moving the check earlier cannot skip actual repair spacing.');
    });
    console.log(`\n${passed} own-account repair/Coach scenarios passed.`);
  } finally { if (uid && !retained) { await cleanup(uid); if (keep && fs.existsSync(file)) fs.unlinkSync(file); } cookies.clear(); }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
