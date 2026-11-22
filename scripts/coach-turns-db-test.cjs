/** Coach turns on the REAL schema: replay, resume, atomic allowance, one answer/one proposal set per turn, cleared-mid-turn. Throwaway student, removed by recorded id.
 *  npm run coach:turns:db:test -- --confirm-target=<project-ref> */
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { Client } = require('pg'); const { parse } = require('dotenv')
const { configuration } = require('./lib/migrations.cjs')

async function main(args = process.argv.slice(2)) {
  const root = path.resolve(__dirname, '..'), env = parse(fs.readFileSync(path.join(root, '.env.staging.local')))
  const cfg = configuration(['--env=staging', '--dry-run'], env)
  if (!env.E2E_CONFIRMED_DISPOSABLE_PROJECT_REF || env.E2E_CONFIRMED_DISPOSABLE_PROJECT_REF !== cfg.identity) throw Error('Not the user-confirmed disposable project; refusing.')
  if (!args.includes(`--confirm-target=${cfg.identity}`)) throw Error(`Pass --confirm-target=${cfg.identity}.`)
  setTimeout(() => { console.error('Stopped: deadline reached (fixtures may remain; re-run to clean).'); process.exit(2) }, 120000).unref()
  const mk = () => new Client({ ...cfg.connection, connectionTimeoutMillis: 45000, keepAlive: true, query_timeout: 60000 })
  const a = mk(); await a.connect(); const pool = []; let n = 0
  const ok = (name, v, d = '') => { assert.ok(v, `${name} ${d}`); n++; console.log(`  ✓ ${name}`) }
  const one = async (c, s, p) => Object.values((await c.query(s, p)).rows[0] ?? { v: null })[0]
  const tag = Date.now().toString(36), users = []
  const user = async () => { const id = await one(a, 'select gen_random_uuid()'); users.push(id)
    await a.query('insert into auth.users (id,email,email_confirmed_at) values ($1,$2,now())', [id, `ct-${tag}-${users.length}@example.invalid`]); await a.query('insert into public.profiles (id) values ($1) on conflict (id) do nothing', [id]); return id }
  const conn = async () => { const c = mk(); await c.connect(); pool.push(c); return c }
  const tokens = {}
  const begin = (c, u, k, lim = 40, body = 'hello there friend', hash = 'hashhash-' + body.length, lease = 45) => c.query('select public.coach_turn_begin($1,$2,$3,$4,$5,$6,$7) r', [u, k, body, 'free', lim, hash, lease]).then(r => { const x = r.rows[0].r; if (x.token) tokens[k] = x.token; return x })
  const finish = (c, u, k, props = [], tok = tokens[k]) => c.query('select public.coach_turn_finish($1,$2,$3,$4,$5,$6,$7,$8,$9) r', [u, k, tok ?? '00000000-0000-0000-0000-000000000000', 'the answer', 'free', JSON.stringify([{ label: 'L', href: '/app/calendar' }]), null, JSON.stringify(props), JSON.stringify({ interpreter: 'x', fallback: false, source: 'deterministic' })]).then(r => r.rows[0].r)
  const prop = { kind: 'defer_today', title: 'T', reasoning: 'R', changes: { version: 2, moves: [], staysDue: [], waiting: 0 } }
  try {
    const u = await user()
    let r = await begin(a, u, `k1-${tag}-aaaa`)
    ok('a new turn records the student message', r.state === 'new')
    r = await begin(a, u, `k1-${tag}-aaaa`)
    ok('the same key while its worker holds the lease is busy: no second student message, no second worker', r.state === 'busy' && Number(await one(a, "select count(*) from public.coach_messages where user_id=$1 and role='student'", [u])) === 1)
    const f1 = await finish(a, u, `k1-${tag}-aaaa`, [prop])
    const f2 = await finish(a, u, `k1-${tag}-aaaa`, [prop])
    ok('the answer stores its interpreter metadata', (await one(a, "select turn_meta->>'interpreter' from public.coach_messages where id=$1", [f1.coachId])) === 'x')
    ok('finish twice returns the first answer', f2.replayed === true && f1.coachId === f2.coachId)
    ok('one answer and one pending proposal for the turn', Number(await one(a, "select count(*) from public.coach_messages where user_id=$1 and role='coach'", [u])) === 1 && Number(await one(a, "select count(*) from public.coach_proposals where user_id=$1 and origin='coach' and status='pending'", [u])) === 1)
    ok('the message lists its proposal', Number(await one(a, 'select cardinality(proposal_ids) from public.coach_messages where id=$1', [f1.coachId])) === 1)
    r = await begin(a, u, `k1-${tag}-aaaa`)
    ok('a lost response replays: same answer id, no new work', r.state === 'replay' && r.coachId === f1.coachId)

    // Concurrent same-key sends: one student message.
    const u2 = await user(); const cs = await Promise.all([...Array(5)].map(conn))
    const rs = await Promise.all(cs.map(c => begin(c, u2, `k2-${tag}-bbbb`)))
    ok('five concurrent sends of one turn write one student message', rs.filter(x => x.state === 'new').length === 1 && rs.filter(x => x.state === 'busy').length === 4 && Number(await one(a, "select count(*) from public.coach_messages where user_id=$1 and role='student'", [u2])) === 1)

    // The allowance is atomic and counts a retried turn once.
    const u3 = await user(); const cs3 = await Promise.all([...Array(8)].map(conn))
    const r3 = await Promise.all(cs3.map((c, i) => begin(c, u3, `k3-${tag}-${i}xxxx`, 3)))
    ok('concurrent turns cannot pass the allowance', r3.filter(x => x.state === 'new').length === 3 && r3.filter(x => x.state === 'limited').length === 5)
    const again = await begin(a, u3, `k3-${tag}-${r3.findIndex(x => x.state === 'new')}xxxx`, 3)
    ok('retrying an admitted turn at the limit is not counted again (busy, not limited)', again.state === 'busy')
    ok('another student is unaffected', (await begin(a, u, `k4-${tag}-other`, 3)).state === 'new')

    // History cleared mid-turn: the late answer adds nothing.
    const u5 = await user(); await begin(a, u5, `k5-${tag}-cccc`)
    await a.query('delete from public.coach_messages where user_id=$1', [u5])
    const late = await finish(a, u5, `k5-${tag}-cccc`, [prop])
    ok('an answer after Clear adds nothing', late.error === 'NO_TURN' && Number(await one(a, 'select count(*) from public.coach_messages where user_id=$1', [u5])) === 0 && Number(await one(a, 'select count(*) from public.coach_proposals where user_id=$1', [u5])) === 0)
    ok('keys are per student', (await begin(a, u5, `k1-${tag}-aaaa`)).state === 'new')
    ok('a short key is refused', await begin(a, u, 'x').then(() => false, () => true))
  } finally {
    for (const c of pool) await c.end().catch(() => {})
    await a.query('delete from public.coach_proposals where user_id = any($1)', [users]); await a.query('delete from public.coach_messages where user_id = any($1)', [users])
    await a.query('delete from public.profiles where id = any($1)', [users]); await a.query('delete from auth.users where id = any($1)', [users]); await a.end()
  }
  console.log(`${n} passed, 0 failed`)
}
main().catch(e => { console.error(e.message ?? e); process.exit(1) })
