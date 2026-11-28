/** Explicit staging environment for acceptance commands; Next must not fill blanks from the live .env.local. */
const fs = require('node:fs'), assert = require('node:assert/strict')
const { parse } = require('dotenv'), { spawn } = require('node:child_process')
function environment(file, mode, ambient = process.env) {
  const target = 'mnlezctdqkdfgvmipmcj'
  assert.equal(file.E2E_CONFIRMED_DISPOSABLE_PROJECT_REF, target, 'Select the authorised disposable project')
  assert.equal(file.NEXT_PUBLIC_SUPABASE_URL, `https://${target}.supabase.co`, 'Wrong disposable REST/Auth URL')
  assert.ok(file.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || file.NEXT_PUBLIC_SUPABASE_ANON_KEY, 'Disposable public Auth key missing')
  assert.ok(file.SUPABASE_SECRET_KEY || file.SUPABASE_SERVICE_ROLE_KEY, 'Disposable server key missing')
  assert.ok(file.HEALTHCHECK_SECRET, 'Disposable health secret missing')
  assert.ok(['disabled', 'controlled'].includes(mode), 'Provider mode must be disabled or controlled')
  const empty = Object.fromEntries(Object.keys(parse(fs.readFileSync('.env.example'))).map(k => [k, '']))
  const env = { ...ambient, ...empty, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: '', SUPABASE_SECRET_KEY: '', ...file,
    E2E_ENV_FILE: '.env.staging.local', RESEND_API_KEY: '', CRON_SECRET: '',
    NVIDIA_BASE_URL: 'http://127.0.0.1:39177/v1', NVIDIA_API_KEY: mode === 'controlled' ? 'controlled-local-test-key' : '',
    NEXT_PUBLIC_POSTHOG_KEY: '', NEXT_PUBLIC_SENTRY_DSN: '',
  }
  // These aliases take precedence in clients; a missing staging alias must never inherit a live value.
  env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = file.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || ''
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY = file.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
  env.SUPABASE_SECRET_KEY = file.SUPABASE_SECRET_KEY || ''
  env.SUPABASE_SERVICE_ROLE_KEY = file.SUPABASE_SERVICE_ROLE_KEY || ''
  for (const key of ['SUPABASE_DB_HOST', 'SUPABASE_DB_USER', 'SUPABASE_DB_PORT', 'MIGRATION_DATABASE_URL']) env[key] = file[key] || ''
  env.E2E_TARGET = target; env.E2E_ALLOW_TARGET = ''
  env.E2E_BASE_URL = file.E2E_BASE_URL || 'http://localhost:3141'
  env.NEXT_PUBLIC_SITE_URL = file.NEXT_PUBLIC_SITE_URL || 'http://localhost:3141'
  return env
}
function main(args) {
  if (args[0] === '--self-test') {
    const file = { E2E_CONFIRMED_DISPOSABLE_PROJECT_REF: 'mnlezctdqkdfgvmipmcj', NEXT_PUBLIC_SUPABASE_URL: 'https://mnlezctdqkdfgvmipmcj.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-public', SUPABASE_SERVICE_ROLE_KEY: 'test-server', HEALTHCHECK_SECRET: 'test-monitor' }
    const ambient = { NVIDIA_API_KEY: 'must-not-inherit', RESEND_API_KEY: 'must-not-inherit', SUPABASE_SECRET_KEY: 'must-not-inherit' }
    const env = environment(file, 'disabled', ambient)
    assert.equal(env.NVIDIA_API_KEY, ''); assert.equal(env.RESEND_API_KEY, ''); assert.equal(env.SUPABASE_SECRET_KEY, '')
    assert.equal(environment(file, 'controlled', ambient).NVIDIA_BASE_URL, 'http://127.0.0.1:39177/v1')
    assert.throws(() => environment({ ...file, NEXT_PUBLIC_SUPABASE_URL: 'https://wrong.supabase.co' }, 'disabled'), /Wrong disposable/)
    assert.throws(() => environment({ ...file, SUPABASE_SERVICE_ROLE_KEY: '' }, 'disabled'), /server key missing/)
    console.log('PASS disposable environment target, alias isolation, disabled services and controlled-only provider checks'); return
  }
  const mode = args[0]?.startsWith('--provider=') ? args.shift().slice(11) : 'disabled'
  assert.ok(args.length, 'usage: node scripts/disposable-run.cjs [--provider=disabled|controlled] <command> [args...]')
  const env = environment(parse(fs.readFileSync('.env.staging.local')), mode)
  const child = spawn(args[0], args.slice(1), { env, stdio: 'inherit' })
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
  child.on('error', () => { console.error('Unable to start the selected command'); process.exitCode = 1 })
  child.on('exit', code => { process.exitCode = code ?? 1 })
}
module.exports = { environment }
if (require.main === module) { try { main(process.argv.slice(2)) } catch (e) { console.error(e.message); process.exitCode = 1 } }
