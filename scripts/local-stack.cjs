/**
 * Isolated local Supabase-shaped stack: throwaway Postgres + real GoTrue (Auth) + real PostgREST behind one loopback origin.
 * Nothing here can reach a hosted project: every port is 127.0.0.1, secrets are generated per run, and the env file it writes names only this stack.
 *
 *   node scripts/local-stack.cjs start [--dir=/path] [--bank=none|fixture]   -> prints the env file path
 *   node scripts/local-stack.cjs stop  [--dir=/path]
 *   node scripts/local-stack.cjs status [--dir=/path]
 *   node scripts/local-stack.cjs bank --out=<file> [--readings=r028,r029] [--per-outcome=8] [--rehearsal=auto]   -> TEST-ONLY approved fixture bank (scripts/fixture-bank.cjs)
 *   The bank lives in the throwaway database; `stop --purge` deletes the whole stack, which is the cleanup.
 *
 * Needs: postgrest (brew install postgrest) and a gotrue binary (GOTRUE_BIN, default /tmp/claude-501/stack/bin/gotrue, built from github.com/supabase/auth).
 * The app's migrations are installed with the same checksum-verified path the hosted rehearsal uses (scripts/beta/install.cjs).
 */
const fs = require('node:fs'), path = require('node:path'), net = require('node:net'), http = require('node:http'), crypto = require('node:crypto')
const { spawn, spawnSync } = require('node:child_process')
const { Client } = require('pg')
const pg = require('./beta/local-pg.cjs')

const arg = n => process.argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3)
const dir = path.resolve(arg('dir') || '/tmp/claude-501/stack/run')
const GOTRUE = process.env.GOTRUE_BIN || '/tmp/claude-501/stack/bin/gotrue'
const POSTGREST = process.env.POSTGREST_BIN || '/opt/homebrew/bin/postgrest'
const state = path.join(dir, 'stack.json')
const free = () => new Promise(r => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)) }) })
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url')
const jwt = (secret, payload) => { const h = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}`; return `${h}.${crypto.createHmac('sha256', secret).update(h).digest('base64url')}` }
const alive = pid => { try { process.kill(pid, 0); return true } catch { return false } }
const waitHttp = async (url, ms = 60000) => { const t = Date.now(); for (;;) { try { const r = await fetch(url); if (r.status < 500) return } catch {} if (Date.now() - t > ms) throw Error(`Timed out waiting for ${url}`); await new Promise(r => setTimeout(r, 300)) } }

async function start() {
  if (fs.existsSync(state) && alive(JSON.parse(fs.readFileSync(state)).gatewayPid)) throw Error(`A stack is already running in ${dir}. Stop it first.`)
  for (const [n, p] of [['gotrue', GOTRUE], ['postgrest', POSTGREST]]) if (!fs.existsSync(p)) throw Error(`${n} binary not found at ${p}`)
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); fs.chmodSync(dir, 0o700)   // holds the JWT secret, database password and service key: owner only
  const secret = crypto.randomBytes(32).toString('hex'), pw = crypto.randomBytes(12).toString('hex')
  const [dbPort, authPort, restPort, gatewayPort] = [await free(), await free(), await free(), await free()]
  const pgdata = path.join(dir, 'pgdata'); fs.rmSync(pgdata, { recursive: true, force: true })
  pg.start(pgdata, dbPort)
  const sup = new Client({ host: '127.0.0.1', port: dbPort, user: 'postgres', database: 'postgres', options: '-c timezone=UTC' }); await sup.connect()

  // Roles and schema ownership the way a Supabase project has them; GoTrue owns and migrates its own auth tables.
  await sup.query(`
    alter database postgres set timezone to 'UTC';   -- a hosted project is UTC; this machine's zone must not leak into date-based staleness checks
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create role authenticator login noinherit password '${pw}'; grant anon, authenticated, service_role to authenticator;
    create role supabase_auth_admin login createrole noinherit password '${pw}';
    create schema auth authorization supabase_auth_admin; grant usage on schema auth to anon, authenticated, service_role;
    alter role supabase_auth_admin set search_path = auth, public;
    create extension if not exists pgcrypto; create extension if not exists "uuid-ossp";`)
  const authUrl = `postgres://supabase_auth_admin:${pw}@127.0.0.1:${dbPort}/postgres`
  const gotrueEnv = {
    ...process.env, GOTRUE_DB_DRIVER: 'postgres', DATABASE_URL: authUrl, GOTRUE_DB_DATABASE_URL: authUrl, DB_NAMESPACE: 'auth',
    GOTRUE_API_HOST: '127.0.0.1', GOTRUE_API_PORT: String(authPort), API_EXTERNAL_URL: `http://127.0.0.1:${gatewayPort}/auth/v1`,
    GOTRUE_SITE_URL: `http://localhost:${gatewayPort}`, GOTRUE_URI_ALLOW_LIST: '*', GOTRUE_JWT_SECRET: secret, GOTRUE_JWT_EXP: '3600', GOTRUE_JWT_AUD: 'authenticated', GOTRUE_JWT_DEFAULT_GROUP_NAME: 'authenticated',
    GOTRUE_DISABLE_SIGNUP: 'false', GOTRUE_EXTERNAL_EMAIL_ENABLED: 'true', GOTRUE_MAILER_AUTOCONFIRM: 'false', GOTRUE_SMTP_HOST: '127.0.0.1', GOTRUE_SMTP_PORT: '1', GOTRUE_SMTP_ADMIN_EMAIL: 'stack@localhost.invalid',
    GOTRUE_LOG_LEVEL: 'warn', GOTRUE_RATE_LIMIT_EMAIL_SENT: '10000', GOTRUE_SECURITY_REFRESH_TOKEN_ROTATION_ENABLED: 'true', GOTRUE_MFA_ENABLED: 'false',
  }
  const mig = spawnSync(GOTRUE, ['migrate'], { env: gotrueEnv, encoding: 'utf8' })
  if (mig.status !== 0) throw Error(`gotrue migrate failed: ${(mig.stderr || mig.stdout).slice(-600)}`)

  // Platform helpers the app's SQL relies on (present on a hosted project), then the app schema exactly as installed for the hosted rehearsal.
  await sup.query(`
    create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(coalesce(current_setting('request.jwt.claim.sub', true), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')::uuid $$;
    create or replace function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')) $$;
    create or replace function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim', true), ''), nullif(current_setting('request.jwt.claims', true), ''))::jsonb $$;
    grant usage on schema public to anon, authenticated, service_role;
    grant select on all tables in schema auth to service_role; grant execute on all functions in schema auth to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to service_role; alter default privileges in schema public grant all on functions to service_role; alter default privileges in schema public grant all on sequences to service_role;`)
  const { installBaseline } = require('./beta/install.cjs'), { readMigrations, transactionalSql } = require('./lib/migrations.cjs')
  const manifest = await installBaseline(sup)
  for (const f of readMigrations(path.join(__dirname, '../supabase/migrations')).filter(f => !manifest.covers.some(c => c.version === f.version))) {
    await sup.query('begin'); try { await sup.query(transactionalSql(f.sql)); await sup.query('commit') } catch (e) { await sup.query('rollback'); throw Error(`${f.version}: ${e.message}`) }
  }
  // The app's own grants define what the API roles may do; only fill the platform default for objects the migrations created without one.
  await sup.query(`grant usage on all sequences in schema public to authenticated, service_role; notify pgrst, 'reload schema'`)
  await sup.end()

  const logs = n => fs.openSync(path.join(dir, `${n}.log`), 'w', 0o600)
  const pids = {}
  const auth = spawn(GOTRUE, [], { env: gotrueEnv, detached: true, stdio: ['ignore', logs('gotrue'), logs('gotrue')] }); auth.unref(); pids.gotrue = auth.pid
  const conf = path.join(dir, 'postgrest.conf')
  fs.writeFileSync(conf, `db-uri = "postgres://authenticator:${pw}@127.0.0.1:${dbPort}/postgres"\ndb-schemas = "public"\ndb-anon-role = "anon"\njwt-secret = "${secret}"\nserver-host = "127.0.0.1"\nserver-port = ${restPort}\ndb-pre-request = ""\nopenapi-mode = "disabled"\n`, { mode: 0o600 })
  const rest = spawn(POSTGREST, [conf], { detached: true, stdio: ['ignore', logs('postgrest'), logs('postgrest')] }); rest.unref(); pids.postgrest = rest.pid
  await waitHttp(`http://127.0.0.1:${authPort}/health`); await waitHttp(`http://127.0.0.1:${restPort}/`)

  // One origin like a hosted project: /auth/v1 -> GoTrue, /rest/v1 -> PostgREST. Storage is NOT run: only the bucket list answers, empty (this app has no upload feature, so a student owns no
  // objects); file listing/removal is therefore unproven on this stack. Anything else is refused.
  const gw = path.join(dir, 'gateway.cjs')
  fs.writeFileSync(gw, `const http=require('http');const t=(p)=>p.startsWith('/auth/v1/')||p==='/auth/v1'?[${authPort},p.slice(8)||'/']:p.startsWith('/rest/v1/')?[${restPort},p.slice(8)||'/']:null
http.createServer((q,s)=>{if(q.method==='GET'&&q.url.split('?')[0]==='/storage/v1/bucket'){s.writeHead(200,{'content-type':'application/json'});return s.end('[]')}const m=t(q.url);if(!m){s.writeHead(404);return s.end('{"error":"not routed"}')}
const u=http.request({host:'127.0.0.1',port:m[0],path:m[1],method:q.method,headers:{...q.headers,host:'127.0.0.1:'+m[0]}},r=>{s.writeHead(r.statusCode,r.headers);r.pipe(s)});u.on('error',e=>{s.writeHead(502);s.end(JSON.stringify({error:String(e.message)}))});q.pipe(u)}).listen(${gatewayPort},'127.0.0.1')`, { mode: 0o600 })
  const g = spawn(process.execPath, [gw], { detached: true, stdio: 'ignore' }); g.unref(); pids.gateway = g.pid
  await waitHttp(`http://127.0.0.1:${gatewayPort}/auth/v1/health`)

  const anon = jwt(secret, { role: 'anon', iss: 'local-stack', iat: 1700000000, exp: 2000000000 }), service = jwt(secret, { role: 'service_role', iss: 'local-stack', iat: 1700000000, exp: 2000000000 })
  const origin = `http://127.0.0.1:${gatewayPort}`
  const envFile = path.join(dir, 'stack.env')
  fs.writeFileSync(envFile, [`NEXT_PUBLIC_SUPABASE_URL=${origin}`, `NEXT_PUBLIC_SUPABASE_ANON_KEY=${anon}`, `SUPABASE_SERVICE_ROLE_KEY=${service}`, `SUPABASE_SECRET_KEY=${service}`,
    `SUPABASE_DB_HOST=127.0.0.1`, `SUPABASE_DB_PORT=${dbPort}`, `SUPABASE_DB_USER=postgres`, `SUPABASE_DB_PASSWORD=unused`, `LOCAL_STACK=1`, `LOCAL_STACK_DIR=${dir}`, `HEALTHCHECK_SECRET=${crypto.randomBytes(16).toString('hex')}`, `APP_SECURITY_SECRET=${crypto.randomBytes(32).toString('hex')}`].join('\n') + '\n', { mode: 0o600 })
  fs.writeFileSync(state, JSON.stringify({ dbPort, authPort, restPort, gatewayPort, origin, pgdata, gatewayPid: pids.gateway, pids, envFile }), { mode: 0o600 })
  console.log(JSON.stringify({ origin, envFile, dbPort }))
}

async function bank() {
  if (!fs.existsSync(state)) throw Error('Start the stack first.')
  const s = JSON.parse(fs.readFileSync(state)), { create, destroy } = require('./fixture-bank.cjs')
  const sub = process.argv[3] === 'destroy' ? 'destroy' : 'create'
  const argv = process.argv.slice(process.argv[3] === 'create' || process.argv[3] === 'destroy' ? 4 : 3).filter(a => !a.startsWith('--dir='))
  await (sub === 'destroy' ? destroy : create)(argv, async () => { const c = new Client({ host: '127.0.0.1', port: s.dbPort, user: 'postgres', database: 'postgres', options: '-c timezone=UTC' }); await c.connect(); return c })
}

function stop() {
  if (!fs.existsSync(state)) return console.log('no stack recorded')
  const s = JSON.parse(fs.readFileSync(state))
  for (const p of Object.values(s.pids)) { try { process.kill(p, 'SIGTERM') } catch {} }
  pg.stop(s.pgdata); fs.rmSync(state, { force: true })
  if (process.argv.includes('--purge')) fs.rmSync(dir, { recursive: true, force: true })
  console.log(process.argv.includes('--purge') ? 'stopped and purged' : 'stopped')
}

const cmd = process.argv[2]
if (cmd === 'start') start().catch(e => { console.error(e.message); process.exit(1) })
else if (cmd === 'stop') stop()
else if (cmd === 'bank') bank().catch(e => { console.error(e.message); process.exit(1) })
else if (cmd === 'status') console.log(fs.existsSync(state) ? fs.readFileSync(state, 'utf8') : 'none')
else { console.error('usage: local-stack.cjs start|stop|status [--dir=...]'); process.exit(2) }
