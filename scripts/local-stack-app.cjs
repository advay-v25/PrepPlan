/**
 * Build or serve the app against the isolated local stack (scripts/local-stack.cjs), with NO credential from the project's env files.
 * Every key those files define is set to an empty string first (Next never overrides a variable that is already defined), so a live Resend, model,
 * Turnstile, cron or production database value cannot reach this server; only the stack's own values are set.
 *
 *   node scripts/local-stack-app.cjs build [--dir=…] [--dist=.next-stack]
 *   node scripts/local-stack-app.cjs start [--dir=…] [--dist=.next-stack] [--port=3150]   production build; fixture-bank questions are NEVER served by it
 *   --turnstile-fixture  (any command) builds/serves with a fixture CAPTCHA site key, for turnstile-retry (run with E2E_TURNSTILE_FIXTURE=1).
 *   --provider-stub  (any command) lets the app call a controlled LOOPBACK provider on 127.0.0.1:39177 (served by the spec), never a real one.
 *   --proxy=http://127.0.0.1:<port>  (dev/start) points the APP's Supabase URL at a loopback fault proxy that fronts this stack; tests still use the stack directly.
 *   node scripts/local-stack-app.cjs dev   [--dir=…] [--dist=.next-stack] [--port=3150]   dev server with ROADMAP_FIXTURE_BANK=1, the only mode that lets synthetic approved items into papers
 */
const fs = require('node:fs'), path = require('node:path'), { spawn } = require('node:child_process')
const { parse } = require('dotenv')
const arg = (n, d) => process.argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3) || d
const root = path.resolve(__dirname, '..'), dir = path.resolve(arg('dir', '/tmp/claude-501/stack/run')), dist = arg('dist', '.next-stack'), port = arg('port', '3150')
const [cmd] = process.argv.slice(2)
if (!['build', 'start', 'dev'].includes(cmd)) { console.error('usage: local-stack-app.cjs build|start|dev'); process.exit(2) }
const stack = parse(fs.readFileSync(path.join(dir, 'stack.env')))
if (stack.LOCAL_STACK !== '1' || !/^http:\/\/127\.0\.0\.1:\d+$/.test(stack.NEXT_PUBLIC_SUPABASE_URL)) throw Error('Not a local stack env file.')
const blank = {}
for (const f of fs.readdirSync(root).filter(f => /^\.env(\..+)?$/.test(f) && !f.endsWith('.example'))) for (const k of Object.keys(parse(fs.readFileSync(path.join(root, f))))) blank[k] = ''
const proxy = arg('proxy')
if (proxy && !/^http:\/\/127\.0\.0\.1:\d+$/.test(proxy)) throw Error('--proxy must be a loopback origin.')
const env = {
  ...process.env, ...blank,
  NEXT_PUBLIC_SUPABASE_URL: proxy || stack.NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: stack.NEXT_PUBLIC_SUPABASE_ANON_KEY, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: '',
  SUPABASE_SERVICE_ROLE_KEY: stack.SUPABASE_SERVICE_ROLE_KEY, SUPABASE_SECRET_KEY: stack.SUPABASE_SECRET_KEY,
  HEALTHCHECK_SECRET: stack.HEALTHCHECK_SECRET, APP_SECURITY_SECRET: stack.APP_SECURITY_SECRET,
  NEXT_PUBLIC_SITE_URL: `http://localhost:${port}`, NEXT_PUBLIC_SUPPORT_EMAIL: 'support@localhost.invalid',
  // --provider-stub: a CONTROLLED loopback model provider the spec itself serves on 39177. The key is a placeholder; nothing here can reach a real provider.
  NVIDIA_API_KEY: process.argv.includes('--provider-stub') ? 'loopback-stub' : '', NVIDIA_BASE_URL: process.argv.includes('--provider-stub') ? 'http://127.0.0.1:39177/v1' : '',
  NEXT_PUBLIC_GOOGLE_SIGN_IN: '',
  // --turnstile-fixture (build and start alike): a placeholder SITE key so the widget's own code runs against a stub script the spec serves. No secret, no real check.
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: process.argv.includes('--turnstile-fixture') ? 'local-fixture-site-key' : '', TURNSTILE_SECRET_KEY: '', RESEND_API_KEY: '', RESEND_FROM_EMAIL: '', CRON_SECRET: '',
  ROADMAP_FIXTURE_BANK: cmd === 'dev' ? '1' : '',
  SUPABASE_DB_PASSWORD: '', SUPABASE_DB_HOST: '', SUPABASE_DB_USER: '', SUPABASE_DB_PORT: '',
}
const args = cmd === 'build' ? ['build'] : [cmd, '-p', port]
const child = spawn(process.execPath, [path.join(__dirname, 'isolated-next.cjs'), dist, ...args], { cwd: root, env, stdio: 'inherit' })
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => {
    if (!child.killed) child.kill(sig)
  })
}
child.on('error', err => {
  console.error(err.message)
  process.exit(1)
})
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)))
