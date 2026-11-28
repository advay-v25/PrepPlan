/**
 * Scoped question-bank fingerprint: SHA-256 over sorted `path NUL sha256 \n` for question-bank code,
 * authoring fixtures/scripts, and private pack metadata (packId, version, edition, outcomeId, contentHash, rights)
 * without exposing private fact text. Separates bank changes from concurrent app-revamp edits.
 */
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const root = path.resolve(__dirname, '..')
const sha = buf => crypto.createHash('sha256').update(buf).digest('hex')
const walk = (d, o = []) => {
  const full = path.join(root, d)
  if (!fs.existsSync(full)) return o
  for (const e of fs.readdirSync(full, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue
    const p = `${d}/${e.name}`
    if (e.isDirectory()) walk(p, o)
    else o.push(p)
  }
  return o
}

const bankDirs = ['src/lib/diagnostic', 'src/lib/tests', 'scripts/lib/fsaBank', 'scripts/lib/ethicsBank', 'scripts/lib/referenceBank']
const bankFiles = [
  'scripts/item-batch.ts',
  'scripts/reference-bank-build.ts',
  'scripts/reference-bank-import.cjs',
  'scripts/reference-bank-review.cjs',
  'scripts/extract-bank-references.py',
  'scripts/bank-capacity.ts',
  'scripts/bank-matrix.ts',
  'scripts/bank-audit.ts',
  'scripts/load-fsa-bank.ts',
  'scripts/load-ethics-bank.ts',
  'scripts/lib/bankLoader.ts',
  'scripts/lib/bankNumeric.ts',
  ...walk('scripts/fixtures').filter(f => f.includes('phase1') || f.includes('phase2')),
  ...walk('scripts').filter(f => /^scripts\/(phase1-|phase2-|phase3-adaptive)/.test(f)),
  ...bankDirs.flatMap(d => walk(d)),
]

const uniqueFiles = [...new Set(bankFiles.filter(f => fs.existsSync(path.join(root, f))))].sort()
const entries = uniqueFiles.map(f => ({ path: f, sha256: sha(fs.readFileSync(path.join(root, f))) }))

// Private pack metadata only (no fact text)
const packFiles = walk('content/source-packs').filter(f => f.endsWith('.json')).sort()
for (const pf of packFiles) {
  const p = JSON.parse(fs.readFileSync(path.join(root, pf), 'utf8'))
  const meta = JSON.stringify({
    packId: p.packId,
    version: p.version,
    edition: p.edition,
    outcomeId: p.outcomeId,
    contentHash: p.contentHash ?? null,
    rights: p.rights,
  })
  entries.push({ path: `pack-meta:${pf}`, sha256: sha(meta) })
}

entries.sort((a, b) => a.path.localeCompare(b.path))
const fp = sha(entries.map(e => `${e.path}\0${e.sha256}\n`).join(''))
console.log(JSON.stringify({ short: fp.slice(0, 16), fingerprint: fp, codeAndFixtureFiles: uniqueFiles.length, packMetadataCount: packFiles.length }))
