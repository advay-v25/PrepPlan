/** Fresh-database installation. ONE contract, used by every install and rehearsal:
 *    1. installBaseline: the PINNED baseline (schema snapshot -> ledger of every covered version with its checksum -> reference data), refusing a database that already has public tables;
 *    2. then every LATER migration through the checksum runner (the baseline is intentionally historical; it is never edited to catch up);
 *    3. only then is the database "installed": the runner must report 0 pending and no drift.
 *  `installFresh` does 1 + 2. Used by the local rehearsals and (with --env=production --apply) by the hosted beta install. */
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto')
const { Client } = require('pg')
const { readMigrations, migrate } = require('../lib/migrations.cjs')
const root = path.resolve(__dirname, '../..')
const rd = f => fs.readFileSync(path.join(root, 'supabase/baseline', f), 'utf8')

function verifyBaselineFiles() {
  const m = JSON.parse(rd('baseline-manifest.json'))
  const sha = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'supabase/baseline/schema-snapshot.sql'))).digest('hex')
  if (sha !== m.snapshotSha256) throw Error('schema-snapshot.sql does not match its manifest (edited by hand?). Regenerate it with make-baseline.')
  const files = readMigrations(path.join(root, 'supabase', 'migrations'))
  for (const c of m.covers) { const f = files.find(x => x.version === c.version); if (!f || f.checksum !== c.checksum) throw Error(`Migration ${c.version} changed since the baseline was taken; restore it and add a new migration.`) }
  return m
}
async function installBaseline(client, opts = {}) {
  const m = verifyBaselineFiles()
  const { rows } = await client.query("select count(*)::int n from information_schema.tables where table_schema='public'")
  if (rows[0].n > 0) throw Error('Refusing to install: the target already has public tables.')
  await client.query('BEGIN')
  try {
    await client.query(rd('schema-snapshot.sql'))
    for (const c of m.covers) await client.query('insert into public.schema_migrations (version, checksum) values ($1,$2)', [c.version, c.checksum])
    if (!opts.noReference) await client.query(rd('reference-data.sql'))
    await client.query('COMMIT')
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e }
  return m
}
/** Baseline + every later migration. `cfg` is a migration-runner configuration for the SAME database (already confirmed by the caller). */
async function installFresh(client, cfg, opts = {}) {
  const baseline = await installBaseline(client, opts)
  const files = readMigrations(path.join(root, 'supabase', 'migrations'))
  const up = await migrate(new Client(cfg.connection), files, cfg)
  const after = await migrate(new Client(cfg.connection), files, { ...cfg, apply: false })
  return { baseline, later: up.pending.map(f => f.version ?? f), pendingAfter: after.pending.length, files: files.length }
}
module.exports = { installBaseline, installFresh, verifyBaselineFiles }
