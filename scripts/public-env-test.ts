/** Nothing secret may reach the browser: only an allow-list of public names, and no client file may read a server-only variable. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const ALLOWED = new Set(['NEXT_PUBLIC_SITE_URL', 'NEXT_PUBLIC_SUPPORT_EMAIL', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'NEXT_PUBLIC_GOOGLE_SIGN_IN', 'NEXT_PUBLIC_POSTHOG_KEY', 'NEXT_PUBLIC_POSTHOG_HOST'])
const files: string[] = []
const walk = (d: string) => fs.readdirSync(d, { withFileTypes: true }).forEach(e => e.isDirectory() ? walk(path.join(d, e.name)) : /\.(ts|tsx)$/.test(e.name) && files.push(path.join(d, e.name)))
walk('src')
let n = 0; const ok = (name: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${name}`) }

ok('every NEXT_PUBLIC_ variable is on the public allow-list and none is named like a secret', () => {
  for (const f of files) for (const m of fs.readFileSync(f, 'utf8').matchAll(/NEXT_PUBLIC_[A-Z0-9_]+/g)) {
    assert.ok(ALLOWED.has(m[0]), `${f}: ${m[0]} is not an approved public variable`)
    assert.ok(!/SECRET|SERVICE|PASSWORD|PRIVATE|TOKEN/.test(m[0]), `${f}: ${m[0]} looks secret`)
  }
})
ok('no client component reads a server-only environment variable', () => {
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8')
    if (!/^\s*(['"])use client\1/.test(text)) continue
    for (const m of text.matchAll(/process\.env\.([A-Z0-9_]+)/g)) assert.ok(m[1] === 'NODE_ENV' || m[1].startsWith('NEXT_PUBLIC_'), `${f}: client code reads ${m[1]}`)
  }
})
ok('no client component imports the service-role client', () => {
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8')
    if (/^\s*(['"])use client\1/.test(text)) assert.ok(!/supabase\/admin|securityServer|requestBudget/.test(text), `${f} imports a server-only module`)
  }
})
ok('no secret-shaped literal is committed in source or workflows', () => {
  const all = [...files, ...fs.readdirSync('.github/workflows').map(f => path.join('.github/workflows', f))]
  for (const f of all) {
    const text = fs.readFileSync(f, 'utf8')
    assert.ok(!/sb_secret_[A-Za-z0-9_-]{10,}|nvapi-[A-Za-z0-9_-]{20,}|re_[A-Za-z0-9]{20,}|Bearer [0-9a-f]{32,}/.test(text), `${f} contains a secret-shaped value`)
  }
})
ok('the reminders workflow loads its credential from GitHub Actions secrets', () => {
  const workflow = fs.readFileSync('.github/workflows/reminders-cron.yml', 'utf8')
  assert.match(workflow, /^\s*CRON_SECRET:\s*\$\{\{\s*secrets\.CRON_SECRET\s*\}\}\s*$/m)
  assert.match(workflow, /Authorization: Bearer \$CRON_SECRET/)
})
console.log(`${n} passed, 0 failed`)
