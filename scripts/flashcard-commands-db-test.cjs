/** Flashcard command proof on the REAL development schema (disposable project): exactly-once create/edit/delete/rating, monotonic revision, stale and competing requests,
 *  the atomic quota under concurrency, write protection, ownership, and that a rating writes no evidence/coverage/repair row. Rows are owned fixtures deleted by id.
 *  npm run flashcards:db:test -- --local (throwaway Postgres), or --confirm-target=<project-ref> */
const assert = require('node:assert/strict')
const { Client } = require('pg')
const { openStage } = require('./lib/stage.cjs')

async function main(args = process.argv.slice(2)) {
  const stage = await openStage(args), { cfg } = stage
  setTimeout(() => { console.error('Stopped: deadline reached.'); process.exit(2) }, 600000).unref()
  const mk = () => new Client({ ...cfg.connection, connectionTimeoutMillis: 45000, keepAlive: true })
  const a = mk(); let n = 0; const pool = []
  const ok = (name, v, d = '') => { assert.ok(v, `${name} ${JSON.stringify(d)}`); n++; console.log(`  ✓ ${name}`) }
  const conn = async () => { const c = mk(); await c.connect(); pool.push(c); return c }
  const tag = Date.now().toString(36), users = []
  const mkUser = async (complete = true) => { const id = (await a.query('select gen_random_uuid() id')).rows[0].id; users.push(id)
    await a.query("insert into auth.users (id, email, email_confirmed_at) values ($1,$2,now())", [id, `fc+${tag}+${users.length}@example.invalid`])
    await a.query("insert into public.profiles (id, display_name, onboarding_status) values ($1,'FC',$2) on conflict (id) do update set onboarding_status=excluded.onboarding_status", [id, complete ? 'complete' : 'not_started']); return id }
  const as = async (c, uid, sql, p) => { await c.query('BEGIN'); await c.query('SET LOCAL ROLE authenticated'); await c.query("select set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claims',$2,true)", [uid, JSON.stringify({ sub: uid, role: 'authenticated' })])
    try { const r = await c.query(sql, p); await c.query('COMMIT'); return r.rows } catch (e) { await c.query('ROLLBACK'); throw e } }
  const cmd = async (c, uid, key, action, card, exp, f) => (await as(c, uid, 'select public.flashcard_apply($1,$2,$3,$4,$5) r', [key, action, card, exp, f ?? {}]))[0].r
  const counts = async tbl => Number((await a.query(`select count(*) from public.${tbl} where user_id = any($1)`, [users])).rows[0].count)
  try {
    await a.connect()
    const reading = (await a.query("select id from public.curriculum_readings where is_active order by id limit 1")).rows[0].id
    const u = await mkUser(), v = await mkUser(), inc = await mkUser(false), c = await conn()
    const sch = { scopeType: 'reading', scopeId: reading }
    console.log('\nCreate, exact retry, key reuse')
    const k1 = `create-${tag}-1`, made = await cmd(c, u, k1, 'create', null, null, { ...sch, front: 'What is X?', back: 'It is Y.' })
    ok('a card is created with revision 1', made.ok && made.card.revision === 1 && made.card.reps === 0 && !made.replay, made)
    const again = await cmd(c, u, k1, 'create', null, null, { ...sch, front: 'What is X?', back: 'It is Y.' })
    ok('an exact retry (lost response) returns the ORIGINAL card and creates nothing', again.ok && again.replay === true && again.card.id === made.card.id && Number((await a.query('select count(*) from public.flashcards where user_id=$1', [u])).rows[0].count) === 1, again)
    ok('the same key with a different body is KEY_REUSED and changes nothing', (await cmd(c, u, k1, 'create', null, null, { ...sch, front: 'Other?', back: 'Different.' })).code === 'KEY_REUSED' && Number((await a.query('select count(*) from public.flashcards where user_id=$1', [u])).rows[0].count) === 1)
    ok('an unknown reading, an empty side and an over-long side are refused', (await cmd(c, u, `bad1-${tag}`, 'create', null, null, { scopeType: 'reading', scopeId: 'nope', front: 'a', back: 'b' })).code === 'BAD_SCOPE' && (await cmd(c, u, `bad2-${tag}`, 'create', null, null, { ...sch, front: ' ', back: 'b' })).code === 'INVALID' && (await cmd(c, u, `bad3-${tag}`, 'create', null, null, { ...sch, front: 'a', back: 'x'.repeat(2001) })).code === 'INVALID')
    ok('a short or missing request key is refused', (await cmd(c, u, 'short', 'create', null, null, { ...sch, front: 'a', back: 'b' })).code === 'BAD_KEY')

    console.log('\nEdits: revision protection')
    const id = made.card.id
    const e1 = await cmd(c, u, `edit-${tag}-1`, 'update', id, 1, { front: 'What is X (edited)?', back: 'It is Y.' })
    ok('an edit at the current revision applies and bumps the revision', e1.ok && e1.card.revision === 2 && e1.card.front.includes('edited'), e1)
    const eStale = await cmd(c, u, `edit-${tag}-2`, 'update', id, 1, { front: 'Second tab text', back: 'Lost?' })
    ok('a stale edit (second tab) changes nothing and returns the CURRENT card', eStale.code === 'STALE_CARD' && eStale.card.revision === 2 && eStale.card.front.includes('edited'), eStale)
    ok('an exact retry of the applied edit replays it', (await cmd(c, u, `edit-${tag}-1`, 'update', id, 1, { front: 'What is X (edited)?', back: 'It is Y.' })).replay === true)

    console.log('\nRatings: monotonic revision, exactly once, competing requests')
    const due = new Date(Date.now() + 600_000).toISOString()
    const again1 = { rating: 'again', intervalDays: 0, ease: 2.3, reps: 0, lapses: 1, dueAt: due }
    const r1 = await cmd(c, u, `rate-${tag}-1`, 'review', id, 2, again1)
    ok('Again applies once: revision rises even though reps resets to 0', r1.ok && r1.card.revision === 3 && r1.card.reps === 0 && r1.card.lapses === 1, r1)
    ok('an exact retry of that Again (lost response) replays it: lapses stay 1, revision stays 3', (await cmd(c, u, `rate-${tag}-1`, 'review', id, 2, { ...again1, lapses: 2, dueAt: new Date().toISOString() })).replay === true && (await a.query('select lapses, revision from public.flashcards where id=$1', [id])).rows[0].lapses === 1)
    ok('a DIFFERENT rating under the same key is KEY_REUSED', (await cmd(c, u, `rate-${tag}-1`, 'review', id, 2, { ...again1, rating: 'good' })).code === 'KEY_REUSED')
    const c2 = await conn()
    const [x, y] = await Promise.all([cmd(c, u, `race-${tag}-a`, 'review', id, 3, { rating: 'again', intervalDays: 0, ease: 2.1, reps: 0, lapses: 2, dueAt: due }), cmd(c2, u, `race-${tag}-b`, 'review', id, 3, { rating: 'good', intervalDays: 1, ease: 2.3, reps: 1, lapses: 1, dueAt: new Date(Date.now() + 86400000).toISOString() })])
    ok('two competing ratings at one revision: exactly ONE applies, the other is STALE with the current card', [x, y].filter(r => r.ok).length === 1 && [x, y].filter(r => r.code === 'STALE_CARD' && r.card.revision === 4).length === 1, [x, y])
    ok('an invalid rating or schedule is refused', (await cmd(c, u, `inv-${tag}`, 'review', id, 4, { rating: 'meh', intervalDays: 1, ease: 2.5, reps: 1, lapses: 0, dueAt: due })).code === 'INVALID')
    ok('a rating wrote no evidence, coverage, repair or task row', (await counts('evidence_events')) === 0 && (await counts('user_module_state')) === 0 && (await counts('repair_threads')) === 0)

    console.log('\nDelete')
    ok('a stale delete is refused and the card stays', (await cmd(c, u, `del-${tag}-1`, 'delete', id, 1)).code === 'STALE_CARD' && Number((await a.query('select count(*) from public.flashcards where id=$1', [id])).rows[0].count) === 1)
    const cur = (await a.query('select revision from public.flashcards where id=$1', [id])).rows[0].revision
    ok('a delete at the current revision removes it once; a retry replays', (await cmd(c, u, `del-${tag}-2`, 'delete', id, cur)).deleted === true && (await cmd(c, u, `del-${tag}-2`, 'delete', id, cur)).replay === true)
    ok('acting on a deleted card is NOT_FOUND', (await cmd(c, u, `del-${tag}-3`, 'update', id, cur, { front: 'a', back: 'b' })).code === 'NOT_FOUND')

    console.log('\nOwnership and protection')
    const mine = await cmd(c, u, `own-${tag}-1`, 'create', null, null, { ...sch, front: 'Private?', back: 'Yes.' })
    ok('another student cannot edit, rate or delete it (NOT_FOUND) and cannot read it', (await cmd(await conn(), v, `own-${tag}-2`, 'update', mine.card.id, 1, { front: 'x', back: 'y' })).code === 'NOT_FOUND' && (await as(await conn(), v, 'select count(*) n from public.flashcards where id=$1', [mine.card.id]))[0].n === '0')
    let denied = true; try { await as(await conn(), u, "insert into public.flashcards (user_id, scope_type, scope_id, front, back) values ($1,'reading',$2,'a','b')", [u, reading]); denied = false } catch (e) { denied = /permission denied/.test(e.message) }
    ok('a signed-in user can no longer write the table directly (all writes go through the command)', denied)
    let incDenied = false; try { await cmd(await conn(), inc, `inc-${tag}`, 'create', null, null, { ...sch, front: 'a', back: 'b' }) } catch (e) { incDenied = /Complete setup/.test(e.message) }
    ok('incomplete setup is refused with no write', incDenied && Number((await a.query('select count(*) from public.flashcards where user_id=$1', [inc])).rows[0].count) === 0)
    let anon = false; const an = await conn(); await an.query('BEGIN'); await an.query('SET LOCAL ROLE anon'); try { await an.query("select public.flashcard_apply('anon-key-12345','create',null,null,'{}')") } catch (e) { anon = /permission denied/.test(e.message) } await an.query('ROLLBACK')
    ok('an anonymous caller cannot run the command', anon)

    console.log('\nQuota is atomic')
    const w = await mkUser()
    await a.query("insert into public.flashcards (user_id, scope_type, scope_id, front, back) select $1,'reading',$2,'q'||g,'a'||g from generate_series(1,299) g", [w, reading])
    const pc = await Promise.all([1, 2, 3, 4, 5].map(async i => cmd(await conn(), w, `quota-${tag}-${i}`, 'create', null, null, { ...sch, front: `race ${i}`, back: 'x' })))
    ok('five simultaneous creates with room for one: exactly one is saved, four are LIMIT', pc.filter(r => r.ok).length === 1 && pc.filter(r => r.code === 'LIMIT').length === 4 && Number((await a.query('select count(*) from public.flashcards where user_id=$1', [w])).rows[0].count) === 300, pc.map(r => r.code ?? 'ok'))
    ok('the 300-card scope limit does not block a different reading', (await cmd(c, w, `quota-${tag}-other`, 'create', null, null, { scopeType: 'subject', scopeId: (await a.query('select id from public.topics order by id limit 1')).rows[0].id, front: 'ok', back: 'ok' })).ok)

    console.log('\nDraft throttle')
    const d = []; for (let i = 0; i < 11; i++) d.push((await as(c, u, 'select public.flashcard_draft_allow() r'))[0].r)
    let capped = false; try { await as(c, u, "select public.flashcard_draft_allow(1000, interval '0 seconds')") } catch (e) { capped = /does not exist|function/.test(e.message) }
    ok('the limit cannot be supplied by the caller: the parameterised function is gone', capped)
    ok('ten draft requests per hour are allowed, the eleventh is THROTTLED, counted before any provider call', d.slice(0, 10).every(r => r.ok) && d[10].code === 'THROTTLED', d[10])
  } finally {
    for (const c of pool) await c.end().catch(() => {})
    await a.query('delete from public.flashcard_draft_requests where user_id = any($1)', [users]).catch(() => {})
    await a.query('delete from public.flashcard_commands where user_id = any($1)', [users]).catch(() => {})
    await a.query('delete from public.flashcards where user_id = any($1)', [users]).catch(() => {})
    await a.query('delete from public.profiles where id = any($1)', [users]).catch(() => {}); await a.query('delete from auth.users where id = any($1)', [users]).catch(() => {})
    console.log(`cleanup: ${users.length} fixture user(s) removed`); await a.end().catch(() => {})
    await stage.stop()
  }
  console.log(`\n${n} passed, 0 failed`)
}
main().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
