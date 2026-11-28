/** Install the existing pinned baseline + checksum migrations, only into the empty authorised disposable project. */
const fs = require('node:fs'), assert = require('node:assert/strict')
const { parse } = require('dotenv'), { Client } = require('pg')
const { configuration } = require('./lib/migrations.cjs')
const { installFresh, verifyBaselineFiles } = require('./beta/install.cjs')
async function main(args) {
  const target = 'mnlezctdqkdfgvmipmcj', apply = args.includes('--apply')
  const env = parse(fs.readFileSync('.env.staging.local'))
  const cfg = configuration(['--env=staging', apply ? '--apply' : '--dry-run', ...args.filter(a => a.startsWith('--confirm-target='))], env)
  assert.equal(cfg.identity, target, 'Only the authorised disposable project may be installed')
  assert.equal(env.E2E_CONFIRMED_DISPOSABLE_PROJECT_REF, target, 'Disposable binding required')
  verifyBaselineFiles()
  const c = new Client(cfg.connection)
  try {
    await c.connect()
    const count = Number((await c.query("select count(*) n from information_schema.tables where table_schema='public'")).rows[0].n)
    console.log(JSON.stringify({ target, publicTables: count, apply }))
    if (!apply) { console.log(count === 0 ? 'Empty: eligible for pinned baseline installation.' : 'Not empty: use the migration dry-run; baseline installation will refuse.'); return }
    assert.equal(count, 0, 'Refusing to replace an existing public schema')
    const result = await installFresh(c, cfg)
    assert.equal(result.pendingAfter, 0)
    console.log(JSON.stringify({ baseline: result.baseline.covers.length, later: result.later.length, pending: result.pendingAfter }))
  } finally { await c.end() }
}
main(process.argv.slice(2)).catch(() => { console.error('Disposable installation stopped. Check target, connectivity, empty schema and migration checksums; connection details withheld.'); process.exitCode = 1 })
