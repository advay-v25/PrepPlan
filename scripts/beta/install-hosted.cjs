/** Installs the pinned baseline AND every later migration into a DISTINCT, EMPTY hosted beta project (reads .env.production.local only).
 *    node scripts/beta/install-hosted.cjs --confirm-target=<beta-project-ref> [--apply]     (default: read-only preflight)
 *  Refuses: the same project as the development/staging file, a project with any public table, an unconfirmed target. Secrets are never printed. */
const fs = require('node:fs'), path = require('node:path')
const { Client } = require('pg'); const { parse } = require('dotenv')
const { configuration } = require('../lib/migrations.cjs'), { installFresh, verifyBaselineFiles } = require('./install.cjs')
const root = path.resolve(__dirname, '../..')
async function main() {
  const file = path.join(root, '.env.production.local')
  if (!fs.existsSync(file)) throw Error('Missing .env.production.local (see .env.example: beta project URL, MIGRATION_EXPECTED_PROJECT_REF, SUPABASE_DB_PASSWORD).')
  const apply = process.argv.includes('--apply'), ref = (process.argv.find(a => a.startsWith('--confirm-target=')) ?? '').slice(17)
  const cfg = configuration(['--env=production', apply ? '--apply' : '--dry-run', `--confirm-target=${ref || 'none'}`].filter((a, i) => apply || i < 2), parse(fs.readFileSync(file)))
  if (ref !== cfg.identity) throw Error(`Pass --confirm-target=${cfg.identity}.`)
  const stg = path.join(root, '.env.staging.local')
  if (fs.existsSync(stg) && configuration(['--env=staging', '--dry-run'], parse(fs.readFileSync(stg))).identity === cfg.identity) throw Error('The beta target is the same project as the development/staging file. A separate beta project is required.')
  const m = verifyBaselineFiles()
  const c = new Client(cfg.connection); await c.connect()
  try {
    const { rows } = await c.query("select count(*)::int n from information_schema.tables where table_schema='public'")
    console.log(`target ${cfg.identity}: public tables ${rows[0].n}; baseline covers ${m.covers.length} migrations`)
    if (!apply) { console.log(rows[0].n === 0 ? 'Preflight OK: empty database. Re-run with --apply to install.' : 'Preflight: not empty; installation would be refused.'); return }
    // The baseline is a pinned historical snapshot: installation = baseline + every later migration, then the runner must agree (the same steps as `npm run beta:install:rehearse`).
    const r = await installFresh(c, cfg)
    console.log(`Installed: baseline (${r.baseline.covers.length} migrations) + ${r.later.length} later migrations; the runner now reports ${r.pendingAfter} pending.`)
    if (r.pendingAfter) throw Error('The runner still reports pending migrations after installation; do not use this database.')
    console.log('Confirm independently: npm run migrate -- --env=production --dry-run  (expect 0 pending)')
  } finally { await c.end() }
}
main().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
