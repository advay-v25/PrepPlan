/** Source fingerprint, same method as docs/evidence/phase6-final/source-snapshot.json: SHA-256 over sorted `path NUL file-sha256 \n`.
 *  Listed source/test/script/migration/config files only (no docs, env, evidence or generated output).
 *    node scripts/source-fingerprint.cjs [--compare=docs/evidence/phase6-final/source-snapshot.json] [--write=<file>] */
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto')
const root = path.resolve(__dirname, '..')
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')
const walk = (d, o = []) => { for (const e of fs.readdirSync(path.join(root, d), { withFileTypes: true })) { if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'test-results') continue; const p = `${d}/${e.name}`; e.isDirectory() ? walk(p, o) : o.push(p) } return o }
const listed = ['next.config.ts', 'package-lock.json', 'package.json', 'playwright.config.ts', 'playwright.lifecycle.config.ts', 'tsconfig.json', 'src/proxy.ts', 'src/styles.css', 'src/types.ts']
const files = [...new Set([...listed.filter(f => fs.existsSync(path.join(root, f))), ...['src', 'scripts', 'tests', 'supabase/migrations'].flatMap(d => walk(d))])].sort()
const entries = files.map(f => ({ path: f, sha256: sha(path.join(root, f)) }))
const fingerprint = crypto.createHash('sha256').update(entries.map(e => `${e.path}\0${e.sha256}\n`).join('')).digest('hex')
const out = { algorithm: 'sha256(sorted path NUL file-sha256 newline)', fingerprint, short: fingerprint.slice(0, 16), files: entries }
const cmp = process.argv.find(a => a.startsWith('--compare='))?.slice(10)
if (cmp) {
  const old = new Map(JSON.parse(fs.readFileSync(path.join(root, cmp), 'utf8')).files.map(e => [e.path, e.sha256])), now = new Map(entries.map(e => [e.path, e.sha256]))
  out.comparedTo = cmp
  out.added = [...now.keys()].filter(p => !old.has(p)); out.removed = [...old.keys()].filter(p => !now.has(p)); out.changed = [...now.keys()].filter(p => old.has(p) && old.get(p) !== now.get(p))
}
const w = process.argv.find(a => a.startsWith('--write='))?.slice(8)
if (w) fs.writeFileSync(path.join(root, w), JSON.stringify(out, null, 1))
console.log(JSON.stringify({ short: out.short, files: entries.length, ...(cmp ? { added: out.added.length, removed: out.removed.length, changed: out.changed.length } : {}) }))
