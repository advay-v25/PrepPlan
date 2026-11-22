/** Admission rules at the DATABASE boundary, on a throwaway local cluster: baseline install -> the pending migration through the checksum runner -> invitation behaviour.
 *  node scripts/beta/admission-test.cjs */
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { Client } = require('pg')
const pg = require('./local-pg.cjs'), { installBaseline } = require('./install.cjs')
const { configuration, readMigrations, migrate } = require('../lib/migrations.cjs')
const root = path.resolve(__dirname, '../..'), PORT = 54332
async function main() {
  const dir = pg.tmp(); let n = 0
  const ok = (name, v, d = '') => { assert.ok(v, `${name} ${d}`); n++; console.log(`  ✓ ${name}`) }
  try {
    pg.start(dir, PORT); pg.run('createdb', ['-h', '127.0.0.1', '-p', String(PORT), '-U', 'postgres', 'adm'])
    const c = new Client({ host: '127.0.0.1', port: PORT, user: 'postgres', database: 'adm' }); await c.connect()
    await c.query(fs.readFileSync(path.join(root, 'supabase/baseline/local-supabase-stub.sql'), 'utf8')); await installBaseline(c)
    const cfg = configuration(['--env=local', '--apply', '--confirm-target=local:adm'], { MIGRATION_DATABASE_URL: `postgresql://postgres@127.0.0.1:${PORT}/adm`, MIGRATION_EXPECTED_DATABASE: 'adm' })
    const files = readMigrations(path.join(root, 'supabase', 'migrations'))
    files.push({ version: '99999999_probe_after_baseline', checksum: 'probe', sql: 'create table public.post_baseline_probe (id int)' })
    const r = await migrate(new Client(cfg.connection), files, cfg)
    ok('a migration written AFTER the baseline applies through the runner on the installed database', r.pending.length === 1 && r.pending[0] === '99999999_probe_after_baseline', r.pending.join())
    const signup = (email, confirmed = false) => c.query('insert into auth.users (email, email_confirmed_at) values ($1, $2) returning id', [email, confirmed ? new Date() : null]).then(x => x.rows[0].id)
    const rejects = p => p.then(() => false, e => /NOT_INVITED/.test(e.message))
    const inv = (e, role = 'candidate', days = 7) => c.query('select public.create_beta_invitation($1,$2,$3) r', [e, role, days]).then(x => x.rows[0].r)
    ok('open mode: anyone may sign up (the development default)', !!(await signup('open@example.invalid')))
    await c.query("update public.beta_settings set value='invite_only' where key='admission'")
    ok('invite-only: an uninvited email is refused by the database itself', await rejects(signup('stranger@example.invalid')))
    ok('an invitation is created for a candidate and a reviewer', (await inv('Student@Example.invalid')).ok && (await inv('rev@example.invalid', 'reviewer')).ok)
    ok('the same email cannot be invited twice while an invitation is open', (await inv('student@example.invalid')).code === 'ALREADY_INVITED')
    const s = await signup('student@example.invalid')
    ok('an invited email can create the account, but is NOT admitted until the email is verified', (await c.query('select public.is_beta_admitted($1) a', [s])).rows[0].a === false)
    await c.query('update auth.users set email_confirmed_at = now() where id = $1', [s])
    ok('verification binds the invitation to that identity and admits it', (await c.query('select public.is_beta_admitted($1) a', [s])).rows[0].a === true && (await c.query("select accepted_user_id from public.beta_invitations where email='student@example.invalid'")).rows[0].accepted_user_id === s)
    ok('a candidate gets no reviewer role', (await c.query("select count(*)::int n from public.user_roles where user_id=$1", [s])).rows[0].n === 0)
    const rv = await signup('rev@example.invalid')
    ok('a reviewer invitation grants NO role before verification', (await c.query("select count(*)::int n from public.user_roles where user_id=$1", [rv])).rows[0].n === 0)
    await c.query('update auth.users set email_confirmed_at = now() where id = $1', [rv])
    ok('after verification the reviewer role is granted through the role table', (await c.query("select role from public.user_roles where user_id=$1", [rv])).rows[0]?.role === 'diagnostic_reviewer')
    ok('an open-mode account created earlier is NOT admitted once the beta is invite-only', (await c.query("select public.is_beta_admitted((select id from auth.users where email='open@example.invalid')) a")).rows[0].a === false)
    await c.query("insert into public.beta_invitations (email, expires_at, status) values ('late@example.invalid', now() - interval '1 day', 'pending')")
    ok('an expired invitation is refused', await rejects(signup('late@example.invalid')))
    ok('an expired invitation can be replaced by the owner', (await inv('late@example.invalid')).ok === true && !!(await signup('late@example.invalid')))
    await c.query('delete from auth.users where id = $1', [s])
    const again = await signup('student@example.invalid', true)
    ok('a used invitation cannot be taken over by a new identity with the same email', (await c.query('select public.is_beta_admitted($1) a', [again])).rows[0].a === false)
    ok('students and anonymous callers cannot call the admission functions or read invitations', (await c.query("select has_function_privilege('authenticated','public.create_beta_invitation(text,text,int,text)','execute') or has_function_privilege('anon','public.is_beta_admitted(uuid)','execute') or has_table_privilege('authenticated','public.beta_invitations','select') a")).rows[0].a === false)
    await c.end(); console.log(`\n${n} checks passed (nothing persisted)`)
  } finally { pg.stop(dir); fs.rmSync(dir, { recursive: true, force: true }) }
}
main().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
