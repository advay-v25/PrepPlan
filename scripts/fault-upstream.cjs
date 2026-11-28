/**
 * PRIVATE test harness (never part of the app, never started by it): a loopback-only pass-through in front of the Supabase REST endpoint, used by ONE isolated
 * dev-server process whose NEXT_PUBLIC_SUPABASE_URL points here. It lets a browser test make a REAL upstream dependency slow or failing, so the application's own
 * code (request budget, stage deadline, cancellation, turn lease, retry, read-failure handling) is what produces the observable behaviour.
 *
 *   node scripts/fault-upstream.cjs --port=4144 --faults=/tmp/x/faults.json --log=/tmp/x/upstream.log
 *
 * Faults are read from the JSON file on EVERY request: { "rules": [{ "id": "…", "match": "/rest/v1/plan_blocks", "mode": "stall" | "status", "status": 500, "ms": 40000 }] }.
 * With no file (or no rules) it is a transparent proxy. It only forwards to the confirmed disposable staging project and listens on 127.0.0.1 only, so
 * it cannot expose or alter anything for any other process. Every applied fault, and every request the CLIENT cancelled mid-flight, is logged with a timestamp.
 */
const http = require('node:http')
const https = require('node:https')
const fs = require('node:fs')
const path = require('node:path')
const { parse } = require('dotenv')

const arg = k => (process.argv.find(a => a.startsWith(`--${k}=`)) || '').split('=').slice(1).join('=')
const port = Number(arg('port') || 4144), faultsFile = arg('faults'), logFile = arg('log')
// Local-stack mode: the upstream is the loopback gateway the runner itself recorded (scripts/local-stack.cjs), nothing else. Otherwise only the hosted disposable project.
const local = process.env.E2E_SUITE === 'local-stack' && Boolean(process.env.LOCAL_STACK_DIR)
let upstream
if (local) {
  upstream = new URL(JSON.parse(fs.readFileSync(path.join(process.env.LOCAL_STACK_DIR, 'stack.json'), 'utf8')).origin)
  if (upstream.protocol !== 'http:' || upstream.hostname !== '127.0.0.1') throw new Error('refusing to proxy anything except the recorded loopback stack')
} else {
  const env = parse(fs.readFileSync(path.resolve(__dirname, '..', process.env.E2E_ENV_FILE || '.env.staging.local')))
  upstream = new URL(env.NEXT_PUBLIC_SUPABASE_URL)
  if (upstream.origin !== 'https://mnlezctdqkdfgvmipmcj.supabase.co' || env.E2E_CONFIRMED_DISPOSABLE_PROJECT_REF !== 'mnlezctdqkdfgvmipmcj') throw new Error('refusing to proxy anything except the confirmed disposable project')
}
const agent = new https.Agent({ keepAlive: false })   // a fresh upstream connection per request: no stale-socket resets
const log = (o) => { const line = JSON.stringify({ t: new Date().toISOString(), ...o }); if (logFile) fs.appendFileSync(logFile, line + '\n'); else console.log(line) }
const rules = () => { try { return faultsFile ? JSON.parse(fs.readFileSync(faultsFile, 'utf8')).rules || [] : [] } catch { return [] } }
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS', 'access-control-expose-headers': '*' }

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/__prepplan_target') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    return res.end(JSON.stringify({ role: 'private-disposable-proxy', targetOrigin: upstream.origin }))
  }
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end() }
  const rule = rules().find(r => (req.url || '').includes(r.match) && (!r.method || r.method === req.method))
  let done = false
  res.on('close', () => { if (!done) log({ event: 'client_cancelled', method: req.method, url: (req.url || '').slice(0, 120), rule: rule?.id ?? null }) })
  const forward = () => {
    const headers = { ...req.headers, host: upstream.host }
    const up = (local ? http : https).request({ host: upstream.hostname, port: local ? Number(upstream.port) : 443, method: req.method, path: req.url, headers, agent: local ? undefined : agent }, ur => { res.writeHead(ur.statusCode || 502, { ...ur.headers, ...CORS }); ur.pipe(res); ur.on('end', () => { done = true }) })
    up.on('error', e => { log({ event: 'upstream_error', url: (req.url || '').slice(0, 100), error: String(e.message) }); if (!res.headersSent) res.writeHead(502, CORS); res.end(String(e.message)) })
    res.on('close', () => up.destroy())
    req.pipe(up)
  }
  if (!rule) return forward()
  if (rule.mode === 'status') { log({ event: 'fault_status', id: rule.id, status: rule.status, url: (req.url || '').slice(0, 120) }); done = true; res.writeHead(rule.status || 500, { 'content-type': 'application/json', ...CORS }); return res.end(JSON.stringify({ message: 'harness fault', code: 'HARNESS' })) }
  log({ event: 'fault_stall', id: rule.id, ms: rule.ms, url: (req.url || '').slice(0, 120) })
  const timer = setTimeout(() => { if (!res.destroyed) { log({ event: 'stall_released', id: rule.id }); forward() } }, rule.ms || 30000)
  res.on('close', () => clearTimeout(timer))
  req.resume()
})
server.keepAliveTimeout = 120000; server.headersTimeout = 125000   // longer than any client's idle pool timeout, so a reused socket is never closed under it
server.listen(port, '127.0.0.1', () => log({ event: 'listening', port, upstream: upstream.hostname, faultsFile: faultsFile || null }))
