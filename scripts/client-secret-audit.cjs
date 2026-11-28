/** Release check. Prints variable names and paths only, even on failure. */
const { readFileSync, readdirSync, statSync } = require('node:fs')
const path = require('node:path')
require('dotenv').config({ path: '.env.local', quiet: true })

const root = path.resolve(process.argv[2] ?? '.next/static')
const known = [
  'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY', 'APP_SECURITY_SECRET',
  'CRON_SECRET', 'HEALTHCHECK_SECRET', 'NVIDIA_API_KEY', 'RESEND_API_KEY',
  'MIGRATION_DATABASE_URL', 'TURNSTILE_SECRET_KEY',
].map(name => [name, (process.env[name] ?? '').trim()]).filter(([, value]) => value.length >= 12)

const failures = new Set()
function privilegedKey(value) {
  if (/^sb_secret_/.test(value)) return true
  try { return JSON.parse(Buffer.from(value.split('.')[1], 'base64url').toString()).role === 'service_role' }
  catch { return false }
}
for (const [name, value] of Object.entries(process.env)) {
  if (!name.startsWith('NEXT_PUBLIC_') || !value) continue
  if (/SECRET|SERVICE_ROLE|PASSWORD|PRIVATE_KEY|API_KEY|TOKEN/.test(name)
    || privilegedKey(value)
    || known.some(([, secret]) => value.includes(secret))) failures.add('Unsafe public configuration ' + name)
}

let checked = 0
function inspect(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) { inspect(file); continue }
    if (!/\.(js|css|map|json|html)$/.test(file)) continue
    checked++
    const source = readFileSync(file, 'utf8')
    for (const [name, value] of known) {
      if (source.includes(value) || source.includes(JSON.stringify(value).slice(1, -1))) {
        failures.add(name + ' appears in ' + path.relative(root, file))
      }
    }
    if (/\bsb_secret_[\w-]{20,}\b|\bnvapi-[\w-]{24,}\b|\bre_[\w-]{26,}\b/.test(source) ||
      (source.match(/\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/g) ?? []).some(privilegedKey)) {
      failures.add('Privileged credential pattern in ' + path.relative(root, file))
    }
  }
}
if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
  console.error('Build output is missing. Build PrepPlan before checking browser assets.')
  process.exit(1)
}
inspect(root)
if (!checked) failures.add('No browser assets were checked')
for (const failure of failures) console.error(failure)
console.log(`Checked ${checked} browser assets. ${failures.size} findings.`)
if (failures.size) process.exitCode = 1
