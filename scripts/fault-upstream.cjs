/**
 * PRIVATE test harness (never part of the app, never started by it): a loopback-only pass-through in front of the Supabase REST endpoint, used by ONE isolated
 * dev-server process whose NEXT_PUBLIC_SUPABASE_URL points here. It lets a browser test make a REAL upstream dependency slow or failing, so the application's own
 * code (request budget, stage deadline, cancellation, turn lease, retry, read-failure handling) is what produces the observable behaviour.
 *
 *   node scripts/fault-upstream.cjs --port=4144 --faults=/tmp/x/faults.json --log=/tmp/x/upstream.log
 *
 * Faults are read from the JSON file on EVERY request: { "rules": [{ "id": "…", "match": "/rest/v1/plan_blocks", "mode": "stall" | "status", "status": 500, "ms": 40000 }] }.
 * With no file (or no rules) it is a transparent proxy. It only forwards to the host in the app's own environment (.env.local) and listens on 127.0.0.1 only, so
 * it cannot expose or alter anything for any other process. Every applied fault, and every request the CLIENT cancelled mid-flight, is logged with a timestamp.
 */
const http = require('node:http')
const https = require('node:https')
const fs = require('node:fs')
const path = require('node:path')
const { parse } = require('dotenv')

const arg = k => (process.argv.find(a => a.startsWith(`--${k}=`)) || '').split('=').slice(1).join('=')
const port = Number(arg('port') || 4144), faultsFile = arg('faults'), logFile = arg('log')
const env = parse(fs.readFileSync(path.resolve(__dirname, '..', '.env.local')))
const upstream = new URL(env.NEXT_PUBLIC_SUPABASE_URL)
if (!/\.supabase\.co$/.test(upstream.hostname)) throw new Error('refusing to proxy a non-Supabase upstream')
const agent = new https.Agent({ keepAlive: false })   // a fresh upstream connection per request: no stale-socket resets
const log = (o) => { const line = JSON.stringify({ t: new Date().toISOString(), ...o }); if (logFile) fs.appendFileSync(logFile, line + '\n'); else console.log(line) }
const rules = () => { try { return faultsFile ? JSON.parse(fs.readFileSync(faultsFile, 'utf8')).rules || [] : [] } catch { return [] } }
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS', 'access-control-expose-headers': '*' }

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end() }
  const rule = rules().find(r => (req.url || '').includes(r.match) && (!r.method || r.method === req.method))
  let done = false
  res.on('close', () => { if (!done) log({ event: 'client_cancelled', method: req.method, url: (req.url || '').slice(0, 120), rule: rule?.id ?? null }) })
  const forward = () => {
    const headers = { ...req.headers, host: upstream.host }
    const up = https.request({ host: upstream.hostname, port: 443, method: req.method, path: req.url, headers, agent }, ur => { res.writeHead(ur.statusCode || 502, { ...ur.headers, ...CORS }); ur.pipe(res); ur.on('end', () => { done = true }) })
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
