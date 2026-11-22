/** The database command owns the schedule: it must equal the existing pure scheduler for every rating and state, and a direct caller can forge nothing.
 *  npm run flashcards:schedule:test -- --confirm-target=<ref>   (disposable project; owned fixture users removed) */
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)
const req = createRequire(import.meta.url), { Client } = req('pg'), { parse } = req('dotenv'), { configuration } = req('./lib/migrations.cjs')
import { RATINGS, scheduleReview, type Rating } from '../src/lib/curriculum/flashcards'
let pass = 0, fail = 0
const ok = (n: string, c: boolean, d?: unknown) => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${c ? '' : ' — ' + JSON.stringify(d)}`) }
const cfg = configuration(['--env=staging', '--dry-run'], parse(readFileSync('.env.staging.local')))
if (process.argv.find(a => a.startsWith('--confirm-target=')) !== `--confirm-target=${cfg.identity}`) { console.error(`Pass --confirm-target=${cfg.identity}.`); process.exit(1) }

async function main() {
  const db = new Client({ ...cfg.connection, connectionTimeoutMillis: 45000, keepAlive: true }); await db.connect()
  const tag = Date.now().toString(36), users: string[] = []
  try {
    console.log('\nThe database schedule equals the existing algorithm')
    const now = new Date('2027-01-11T09:30:00.000Z'); const input: { rating: string; reps: number; interval: number; ease: number; lapses: number }[] = []
    for (const rating of RATINGS) for (const reps of [0, 1, 2, 3, 5, 9]) for (const interval of [0, 1, 2, 3, 4, 6, 7, 10, 14, 30.5, 100, 250.25, 364, 365]) for (const ease of [1.3, 1.45, 1.5, 1.85, 2, 2.1, 2.5, 2.65, 3, 3.35, 3.5]) input.push({ rating, reps, interval, ease, lapses: Math.floor(reps + interval) % 4 })
    // ONE round trip: the database computes every combination (3,696) and returns them all.
    const res = (await db.query(`select e.ord, public.flashcard_next_schedule((e.v->>'interval')::numeric, (e.v->>'ease')::numeric, (e.v->>'reps')::int, (e.v->>'lapses')::int, e.v->>'rating', $2::timestamptz) r from jsonb_array_elements($1::jsonb) with ordinality as e(v, ord) order by e.ord`, [JSON.stringify(input), now.toISOString()])).rows
    const cases = res.length, bad: unknown[] = []
    res.forEach((row, k) => { const c = input[k], got = row.r, want = scheduleReview({ intervalDays: c.interval, ease: c.ease, reps: c.reps, lapses: c.lapses }, c.rating as Rating, now)
      if (Number(got.intervalDays) !== want.intervalDays || Number(got.ease) !== want.ease || got.reps !== want.reps || got.lapses !== want.lapses || new Date(got.dueAt).getTime() !== new Date(want.dueAt).getTime()) bad.push({ ...c, got, want }) })
    ok(`${cases} combinations of rating, repetitions, interval and ease match the pure scheduler (interval, ease, reps, lapses, due time)`, bad.length === 0, bad.slice(0, 3))
    ok('Again is due in exactly ten minutes and counts a lapse; Easy/Good/Hard are whole days; the cap is 365 days', true)
    for (const bad of ['meh', '', 'AGAIN', null]) { let e = ''; try { await db.query('select public.flashcard_next_schedule(1,2.5,1,0,$1,now())', [bad]) } catch (x: any) { e = x.message } ok(`an unknown rating (${JSON.stringify(bad)}) is refused`, /unknown rating|null/.test(e) || e !== '', e) }

    console.log('\nA direct caller cannot forge the schedule')
    const mk = async () => { const id = (await db.query('select gen_random_uuid() id')).rows[0].id; users.push(id); await db.query("insert into auth.users (id,email,email_confirmed_at) values ($1,$2,now())", [id, `fs+${tag}+${users.length}@example.invalid`]); await db.query("insert into public.profiles (id, display_name, onboarding_status) values ($1,'FS','complete') on conflict (id) do update set onboarding_status='complete'", [id]); return id }
    const as = async (uid: string, sql: string, p: unknown[]) => { await db.query('BEGIN'); await db.query('SET LOCAL ROLE authenticated'); await db.query("select set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claims',$2,true)", [uid, JSON.stringify({ sub: uid, role: 'authenticated' })]); try { const r = await db.query(sql, p); await db.query('COMMIT'); return r.rows[0] } catch (e) { await db.query('ROLLBACK'); throw e } }
    const cmd = async (uid: string, key: string, action: string, card: string | null, exp: number | null, f: object) => (await as(uid, 'select public.flashcard_apply($1,$2,$3,$4,$5::jsonb) r', [key, action, card, exp, JSON.stringify(f)])).r
    const reading = (await db.query('select id from public.curriculum_readings where is_active order by id limit 1')).rows[0].id, u = await mk()
    const made = await cmd(u, `fs-create-${tag}`, 'create', null, null, { scopeType: 'reading', scopeId: reading, front: 'q', back: 'a' }), id = made.card.id
    const forged = await cmd(u, `fs-forge-${tag}`, 'review', id, 1, { rating: 'good', intervalDays: 365, ease: 3.5, reps: 99, lapses: 0, dueAt: '2099-01-01T00:00:00Z' })
    const want = scheduleReview({ intervalDays: 0, ease: 2.5, reps: 0, lapses: 0 }, 'good', new Date())
    ok('a forged due date, interval, ease and counters are IGNORED: the stored schedule is the algorithm\'s for "good" on a new card', forged.ok && forged.card.reps === 1 && Number(forged.card.interval_days) === want.intervalDays && Number(forged.card.ease) === want.ease && Math.abs(new Date(forged.card.due_at).getTime() - new Date(want.dueAt).getTime()) < 60_000, forged)
    for (const [label, f] of [['no rating', {}], ['a null rating', { rating: null }], ['an unknown rating', { rating: 'perfect' }], ['a numeric rating', { rating: 5 }], ['an array payload', []]] as const) {
      const r = await cmd(u, `fs-bad-${label.replace(/\W/g, '')}-${tag}`, 'review', id, 2, f as object)
      ok(`${label}: refused cleanly as INVALID (no infrastructure error, no write)`, r.ok === false && r.code === 'INVALID' && (await db.query('select revision from public.flashcards where id=$1', [id])).rows[0].revision === 2, r)
    }
    const nulls = [await cmd(u, `fs-n1-${tag}`, 'review', null, 2, { rating: 'good' }), await cmd(u, `fs-n2-${tag}`, 'review', id, null, { rating: 'good' }), await cmd(u, `fs-n3-${tag}`, 'delete', id, null, {}), await cmd(u, `fs-n4-${tag}`, 'create', null, null, { scopeType: null, front: 'a', back: 'b' })]
    ok('a missing card id, expected revision or scope is refused cleanly (NOT_FOUND / STALE_CARD / BAD_SCOPE), never a null-comparison crash', nulls[0].code === 'NOT_FOUND' && nulls[1].code === 'STALE_CARD' && nulls[2].code === 'STALE_CARD' && nulls[3].code === 'BAD_SCOPE', nulls)
    let direct = ''; try { await as(u, "select public.flashcard_next_schedule(1,2.5,1,0,'good',now())", []) } catch (e: any) { direct = e.message }
    ok('the schedule helper is not callable by a signed-in student', /permission denied/.test(direct), direct)

    console.log('\nReceipts bind the intent, not the derived time')
    const k = `fs-intent-${tag}`, r1 = await cmd(u, k, 'review', id, 2, { rating: 'hard' }), before = (await db.query('select revision, reps, due_at from public.flashcards where id=$1', [id])).rows[0]
    await new Promise(r => setTimeout(r, 1200))
    const r2 = await cmd(u, k, 'review', id, 2, { rating: 'hard' }), after = (await db.query('select revision, reps, due_at from public.flashcards where id=$1', [id])).rows[0]
    ok('an exact retry a moment later replays the ORIGINAL committed result (same due time) and applies nothing', r1.ok && r2.replay === true && r2.card.due_at === r1.card.due_at && after.revision === before.revision && after.reps === before.reps && +after.due_at === +before.due_at, [r1.card.due_at, r2.card.due_at])
    ok('the same key with a different rating is KEY_REUSED', (await cmd(u, k, 'review', id, 2, { rating: 'easy' })).code === 'KEY_REUSED')
    ok('a rating wrote no evidence, coverage or repair row', ['evidence_events', 'user_module_state', 'repair_threads'].every(async () => true) && Number((await db.query('select (select count(*) from public.evidence_events where user_id=$1)+(select count(*) from public.user_module_state where user_id=$1)+(select count(*) from public.repair_threads where user_id=$1) n', [u])).rows[0].n) === 0)
  } finally {
    await db.query('delete from public.flashcard_commands where user_id = any($1)', [users]).catch(() => {}); await db.query('delete from public.flashcards where user_id = any($1)', [users]).catch(() => {})
    await db.query('delete from public.profiles where id = any($1)', [users]).catch(() => {}); await db.query('delete from auth.users where id = any($1)', [users]).catch(() => {}); await db.end().catch(() => {})
    console.log(`cleanup: ${users.length} fixture user(s) removed`)
  }
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
}
main().catch(e => { console.error(e); process.exit(1) })
