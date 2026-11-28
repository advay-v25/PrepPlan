/** Fresh-install rehearsal on a throwaway LOCAL Postgres, through the SAME contract the hosted installer uses (install.cjs `installFresh`):
 *  stub platform objects -> pinned baseline -> every LATER migration through the checksum runner -> runner reports 0 pending -> named current objects
 *  and ledger checksums are checked. Local-only by default (no hosted credentials read or connection attempted).
 *    node scripts/beta/install-rehearsal.cjs [--upgrade] [--local-only] [--keep] [--compare-hosted --confirm-target=<ref>] [--help]
 *  --upgrade additionally REQUIRES the pinned baseline to be genuinely older than the checkout (at least one later migration), so this is an upgrade proof and not a no-op.
 *  --local-only is retained for existing callers (default behaviour).
 *  --compare-hosted --confirm-target=<ref> opts into a read-only object-by-object comparison against the confirmed staging project.
 *  Prints facts only; the cluster is stopped and removed unless --keep. */
const fs = require('node:fs'), path = require('node:path')
const { Client } = require('pg')
const { configuration } = require('../lib/migrations.cjs')
const { installFresh } = require('./install.cjs')
const { inventory, compare } = require('./inventory.cjs')
const pg = require('./local-pg.cjs')
const root = path.resolve(__dirname, '../..'), PORT = 54329, DB = 'roadmap_rehearsal'

const USAGE = 'Usage: node scripts/beta/install-rehearsal.cjs [--upgrade] [--local-only] [--keep] [--compare-hosted --confirm-target=<ref>] [--help]'

function parseArgs(argv) {
  const allowed = /^(--upgrade|--local-only|--keep|--compare-hosted|--help|-h|--confirm-target=[a-zA-Z0-9_-]+)$/
  if (argv.some(a => !allowed.test(a))) throw new Error(`Unknown rehearsal argument. ${USAGE}`)
  if (new Set(argv).size !== argv.length) throw new Error(`Duplicate rehearsal argument. ${USAGE}`)
  const help = argv.includes('--help') || argv.includes('-h')
  const upgrade = argv.includes('--upgrade')
  const localOnly = argv.includes('--local-only')
  const keep = argv.includes('--keep')
  const compareHosted = argv.includes('--compare-hosted')
  const confirms = argv.filter(a => a.startsWith('--confirm-target='))
  if (confirms.length > 1) throw new Error('Specify at most one --confirm-target.')
  if (localOnly && compareHosted) throw new Error('--local-only cannot be combined with --compare-hosted.')
  if (confirms.length && !compareHosted) throw new Error('--confirm-target requires --compare-hosted.')
  if (compareHosted && !confirms.length) throw new Error('--compare-hosted requires --confirm-target=<ref> before loading hosted credentials.')
  return { help, upgrade, localOnly, keep, compareHosted, confirmTarget: confirms[0]?.slice('--confirm-target='.length) ?? null }
}

/** Objects added after the pinned baseline that a clean install must carry in their CURRENT form (not merely exist). */
const CURRENT = [
  ['table mock_reports', "select to_regclass('public.mock_reports') is not null v"],
  ['table concept_signoffs', "select to_regclass('public.concept_signoffs') is not null v"],
  ['recovery command accept_class_recovery', "select exists (select 1 from pg_proc where proname='accept_class_recovery' and pronamespace='public'::regnamespace) v"],
  ['recovery command accept_mock_recovery', "select exists (select 1 from pg_proc where proname='accept_mock_recovery' and pronamespace='public'::regnamespace) v"],
  ['decide_concept_signoff binds the retry key (KEY_CONFLICT, BAD_KEY)', "select pg_get_functiondef('public.decide_concept_signoff(uuid,text,text,text,text)'::regprocedure) ~ 'KEY_CONFLICT' and pg_get_functiondef('public.decide_concept_signoff(uuid,text,text,text,text)'::regprocedure) ~ 'BAD_KEY' v"],
  ['manual task command apply_task_create exists and only the service role may call it', "select exists (select 1 from pg_proc where proname='apply_task_create' and pronamespace='public'::regnamespace) and not has_function_privilege('authenticated','public.apply_task_create(uuid,text,text,text,text,text,date,timestamptz,int)','execute') and has_function_privilege('service_role','public.apply_task_create(uuid,text,text,text,text,text,date,timestamptz,int)','execute') v"],
  ['class identity: occurrence_key column and its per-student unique index', "select exists (select 1 from information_schema.columns where table_schema='public' and table_name='class_sessions' and column_name='occurrence_key') and to_regclass('public.class_sessions_occurrence_idx') is not null v"],
  ['apply_class_log carries the occurrence identity, the started gate and the shared feasibility helper', "select pg_get_functiondef('public.apply_class_log(uuid,text,date,text,text,jsonb,jsonb,text,uuid,date,boolean)'::regprocedure) ~ 'OCCURRENCE_ALREADY_LOGGED' and pg_get_functiondef('public.apply_class_log(uuid,text,date,text,text,jsonb,jsonb,text,uuid,date,boolean)'::regprocedure) ~ 'OCCURRENCE_NOT_STARTED' and pg_get_functiondef('public.class_apply_tasks(uuid,uuid,date,text,uuid,jsonb,jsonb,date,text)'::regprocedure) ~ 'class_day_packs' v"],
  ['in-progress logging: version/completion columns, receipts tables and the update command with its grants', "select exists (select 1 from information_schema.columns where table_schema='public' and table_name='class_sessions' and column_name='completed_at') and to_regclass('public.class_log_updates') is not null and to_regclass('public.task_create_receipts') is not null and has_function_privilege('authenticated','public.apply_class_log_update(uuid,uuid,text,integer,boolean,jsonb,jsonb)','execute') and not has_function_privilege('anon','public.apply_class_log_update(uuid,uuid,text,integer,boolean,jsonb,jsonb)','execute') and not has_function_privilege('authenticated','public.class_apply_tasks(uuid,uuid,date,text,uuid,jsonb,jsonb,date,text)','execute') and not has_table_privilege('authenticated','public.class_log_updates','select') and not has_table_privilege('authenticated','public.task_create_receipts','select') v"],
  ['guard_concept_signoff is not callable by signed-in users', "select not has_function_privilege('authenticated','public.guard_concept_signoff()','execute') v"],
  ['place_repair_check reads the due date in an explicit zone', "select pg_get_functiondef('public.place_repair_check(uuid[],text)'::regprocedure) ~ 'next_recheck_due_at at time zone ''UTC''' v"],
  ['first-week acceptance refuses a second copy and a passed timed task', "select pg_get_functiondef('public.accept_onboarding_preview(uuid,integer)'::regprocedure) ~ 'ALREADY_ACCEPTED' and pg_get_functiondef('public.accept_onboarding_preview(uuid,integer)'::regprocedure) ~ 'extra_window_conflict' v"],
  ['accept_repair_proposal writes the due date in an explicit zone', "select pg_get_functiondef('public.accept_repair_proposal(uuid,text)'::regprocedure) ~ 'timestamp at time zone ''UTC''' v"],
]
/** A fresh install carries reference data only: no accounts, no questions, no batches, no sign-offs, no provider secrets, no synthetic residue. */
const EMPTY = ['auth.users', 'public.profiles', 'public.assessment_items', 'public.item_batches', 'public.concept_signoffs', 'public.curriculum_concepts', 'public.assessment_attempts', 'public.mock_reports']
const SECRET = /nvapi-|sk-[A-Za-z0-9]{20}|eyJ[A-Za-z0-9_-]{20,}\.|SUPABASE_DB_PASSWORD|NVIDIA_API_KEY|@gmail\.|@example\.(com|invalid)|fxb-|fxcap|lifecycle-b-/

function hostedConnection(confirmTarget, envFilePath = path.join(root, '.env.staging.local')) {
  const envf = require('dotenv').parse(fs.readFileSync(envFilePath))
  const cfg = configuration(['--env=staging', '--dry-run'], envf)
  if (cfg.identity !== confirmTarget) {
    throw new Error(`Hosted target mismatch: expected ${confirmTarget}, got ${cfg.identity}.`)
  }
  return cfg.connection
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.help) { console.log(USAGE); return }
  const dir = pg.tmp(); let ok = false; const bad = []
  try {
    pg.start(dir, PORT)
    pg.run('createdb', ['-h', '127.0.0.1', '-p', String(PORT), '-U', 'postgres', DB])
    const admin = new Client({ host: '127.0.0.1', port: PORT, user: 'postgres', database: DB }); await admin.connect()
    await admin.query(fs.readFileSync(path.join(root, 'supabase/baseline/local-supabase-stub.sql'), 'utf8'))
    console.log('stub platform objects installed')
    const cfg = configuration(['--env=local', '--apply', `--confirm-target=local:${DB}`], { MIGRATION_DATABASE_URL: `postgresql://postgres@127.0.0.1:${PORT}/${DB}`, MIGRATION_EXPECTED_DATABASE: DB })
    const r = await installFresh(admin, cfg)
    console.log(`baseline installed: ${r.baseline.covers.length} versions with their checksums; later migrations applied through the runner: ${r.later.length} (${r.later[0]} … ${r.later.at(-1)})`)
    console.log(`runner dry-run after install: ${r.pendingAfter} pending (checkout has ${r.files} migrations)`)
    if (r.pendingAfter) bad.push('pending after install')
    if (opts.upgrade && !r.later.length) bad.push('--upgrade needs a baseline older than the checkout')
    const { rows: ledger } = await admin.query('select version, checksum from public.schema_migrations order by version')
    const files = require('../lib/migrations.cjs').readMigrations(path.join(root, 'supabase', 'migrations'))
    const drift = ledger.filter(l => files.find(f => f.version === l.version)?.checksum !== l.checksum), missing = files.filter(f => !ledger.some(l => l.version === f.version))
    console.log(`ledger rows: ${ledger.length}; checksum mismatches: ${drift.length}; migrations without a ledger row: ${missing.length}`)
    if (drift.length || missing.length || ledger.length !== files.length) bad.push('ledger')
    const count = async q => Number((await admin.query(q)).rows[0].n)
    console.log(JSON.stringify({ topics: await count('select count(*) n from public.topics'), readings: await count('select count(*) n from public.curriculum_readings'), outcomes: await count('select count(*) n from public.reading_los'), activeManifests: await count('select count(*) n from public.curriculum_manifests where is_active') }))
    for (const t of EMPTY) { const n = await count(`select count(*) n from ${t}`); console.log(`  ${n === 0 ? '✓' : '✗'} ${t}: ${n} rows (expected 0)`); if (n) bad.push(t) }
    for (const f of ['schema-snapshot.sql', 'reference-data.sql']) { const hit = SECRET.exec(fs.readFileSync(path.join(root, 'supabase/baseline', f), 'utf8')); console.log(`  ${hit ? '✗' : '✓'} baseline ${f}: no secrets, real accounts or synthetic-bank residue${hit ? ' — found ' + hit[0] : ''}`); if (hit) bad.push(f) }
    for (const [name, sql] of CURRENT) { const v = (await admin.query(sql)).rows[0].v; console.log(`  ${v ? '✓' : '✗'} ${name}`); if (!v) bad.push(name) }
    if (!opts.compareHosted) {
      console.log('Local-only rehearsal: hosted source comparison omitted (pass --compare-hosted --confirm-target=<ref> to opt in).')
    } else {
      const dev = new Client(hostedConnection(opts.confirmTarget)); await dev.connect()
      const cmp = compare(await inventory(admin), await inventory(dev)); await dev.end()
      for (const [k, v] of Object.entries(cmp)) { console.log(`  ${v.same ? '✓' : '✗'} ${k}: installed ${v.a}, source ${v.b}${v.same ? '' : ' — only installed: ' + JSON.stringify(v.onlyA) + ' only source: ' + JSON.stringify(v.onlyB)}`); if (!v.same) bad.push(k) }
    }
    await admin.end(); ok = bad.length === 0
    if (!ok) console.log('FAILED:', bad.join(', '))
  } finally { if (!opts.keep) { pg.stop(dir); fs.rmSync(dir, { recursive: true, force: true }) } else console.log('kept', dir) }
  if (!ok) process.exit(1)
}

module.exports = { parseArgs, hostedConnection, USAGE }
if (require.main === module) main().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
