const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { parseArgs, hostedConnection } = require('./install-rehearsal.cjs')

// Default and --local-only modes omit hosted comparison.
assert.deepEqual(parseArgs([]), { help: false, upgrade: false, localOnly: false, keep: false, compareHosted: false, confirmTarget: null })
assert.deepEqual(parseArgs(['--upgrade']), { help: false, upgrade: true, localOnly: false, keep: false, compareHosted: false, confirmTarget: null })
assert.deepEqual(parseArgs(['--upgrade', '--local-only']), { help: false, upgrade: true, localOnly: true, keep: false, compareHosted: false, confirmTarget: null })

// Invalid flag combinations and missing hosted targets fail before any hosted file read.
assert.throws(() => parseArgs(['--compare-hosted']), /--confirm-target/)
assert.throws(() => parseArgs(['--local-only', '--compare-hosted', '--confirm-target=abc']), /cannot be combined/)
assert.throws(() => parseArgs(['--confirm-target=abc']), /requires --compare-hosted/)
assert.throws(() => parseArgs(['--bogus']), /Unknown rehearsal argument/)
assert.throws(() => parseArgs(['--upgrade', '--upgrade']), /Duplicate rehearsal argument/)

// Explicit hosted target mismatch fails before connecting, using a local stub env file.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rehearsal-stub-'))
try {
  const envPath = path.join(tmp, 'stub.env')
  fs.writeFileSync(envPath, [
    'NEXT_PUBLIC_SUPABASE_URL=https://stubproj123.supabase.co',
    'MIGRATION_EXPECTED_PROJECT_REF=stubproj123',
    'SUPABASE_DB_PASSWORD=stub-password',
  ].join('\n'))
  assert.throws(() => hostedConnection('wrongproj', envPath), /Hosted target mismatch/)
  const conn = hostedConnection('stubproj123', envPath)
  assert.equal(conn.host, 'db.stubproj123.supabase.co')
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}
console.log('install-rehearsal-test: PASS')
