/**
 * One way for the paper / score / challenge / rehearsal contract tests to get a database.
 *   default:  the user-confirmed disposable staging project (needs .env.staging.local and --confirm-target=<ref>), as before.
 *   --local:  a throwaway loopback Postgres with the full schema installed through the checksum runner and the stub auth/roles. No hosted
 *             credential is read, nothing hosted is touched, and the cluster is deleted on stop().
 * `create(file, argv)` makes the TEST-ONLY approved fixture bank; `destroy(file)` removes it (a no-op locally: the cluster is discarded).
 */
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), net = require('node:net')
const { execFileSync } = require('node:child_process')
const { Client } = require('pg')
const { parse } = require('dotenv')
const { configuration } = require('./migrations.cjs')
const root = path.resolve(__dirname, '../..')

async function freePort() {
  return new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)) }) })
}

async function openStage(args) {
  if (!args.includes('--local')) {
    const env = parse(fs.readFileSync(path.join(root, '.env.staging.local')))
    const cfg = configuration(['--env=staging', '--dry-run'], env)
    if (!env.E2E_CONFIRMED_DISPOSABLE_PROJECT_REF || env.E2E_CONFIRMED_DISPOSABLE_PROJECT_REF !== cfg.identity) throw Error('Not the user-confirmed disposable project; refusing.')
    if (!args.includes(`--confirm-target=${cfg.identity}`)) throw Error(`Pass --confirm-target=${cfg.identity}, or --local for an isolated Postgres.`)
    const target = `--confirm-target=${cfg.identity}`
    return {
      local: false, cfg,
      create: async (file, argv) => { execFileSync('node', [path.join(__dirname, '../fixture-bank.cjs'), 'create', target, `--out=${file}`, ...argv], { stdio: 'inherit' }) },
      destroy: async file => { execFileSync('node', [path.join(__dirname, '../fixture-bank.cjs'), 'destroy', target, `--file=${file}`], { stdio: 'inherit' }) },
      stop: async () => {},
    }
  }
  const pg = require('../beta/local-pg.cjs'), { installFresh } = require('../beta/install.cjs'), { create: createBank } = require('../fixture-bank.cjs')
  const dir = pg.tmp(), cluster = path.join(dir, 'pg'), port = await freePort(), database = 'contract_local'
  pg.start(cluster, port)
  try {
    pg.run('createdb', ['-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', database])
    const db = new Client({ host: '127.0.0.1', port, user: 'postgres', database })
    await db.connect()
    await db.query(fs.readFileSync(path.join(root, 'supabase/baseline/local-supabase-stub.sql'), 'utf8'))
    const cfg = configuration(['--env=local', '--apply', `--confirm-target=local:${database}`], {
      MIGRATION_DATABASE_URL: `postgresql://postgres@127.0.0.1:${port}/${database}`, MIGRATION_EXPECTED_DATABASE: database,
    })
    const install = await installFresh(db, cfg)
    await db.end()
    if (install.pendingAfter !== 0) throw Error('Local install left migrations pending.')
    return {
      local: true, cfg,
      create: async (file, argv) => createBank([`--out=${file}`, ...argv], async () => { const c = new Client(cfg.connection); await c.connect(); return c }),
      destroy: async () => {},
      stop: async () => { pg.stop(cluster); fs.rmSync(dir, { recursive: true, force: true }) },
    }
  } catch (e) { try { pg.stop(cluster) } catch {} ; fs.rmSync(dir, { recursive: true, force: true }); throw e }
}
module.exports = { openStage }
