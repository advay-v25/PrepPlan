/** Real loopback harness tests; all non-identity responses are injected locally, never forwarded. */
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), net = require('node:net')
const { spawn } = require('node:child_process'), assert = require('node:assert/strict')
async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prepplan-proxy-'))
  let child
  try {
    const envFile = path.join(dir, 'target.env'), faults = path.join(dir, 'faults.json')
    fs.writeFileSync(envFile, 'NEXT_PUBLIC_SUPABASE_URL=https://mnlezctdqkdfgvmipmcj.supabase.co\nE2E_CONFIRMED_DISPOSABLE_PROJECT_REF=mnlezctdqkdfgvmipmcj\n')
    fs.writeFileSync(faults, JSON.stringify({ rules: [{ match: '/__probe', mode: 'status', status: 503 }] }))
    const port = await new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const port = s.address().port; s.close(() => resolve(port)) }) })
    child = spawn(process.execPath, ['scripts/fault-upstream.cjs', `--port=${port}`, `--faults=${faults}`], { env: { ...process.env, E2E_ENV_FILE: envFile }, stdio: ['ignore', 'pipe', 'pipe'] })
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Private proxy did not start')), 5000)
      child.stdout.on('data', b => { if (String(b).includes('listening')) { clearTimeout(timer); resolve() } })
      child.once('exit', () => { clearTimeout(timer); reject(Error('Private proxy exited before readiness')) })
    })
    const proof = await (await fetch(`http://127.0.0.1:${port}/__prepplan_target`)).json()
    assert.deepEqual(proof, { role: 'private-disposable-proxy', targetOrigin: 'https://mnlezctdqkdfgvmipmcj.supabase.co' })
    assert.equal((await fetch(`http://127.0.0.1:${port}/__probe`)).status, 503)
    fs.writeFileSync(envFile, 'NEXT_PUBLIC_SUPABASE_URL=https://wrong.supabase.co\nE2E_CONFIRMED_DISPOSABLE_PROJECT_REF=wrong\n')
    const bad = spawn(process.execPath, ['scripts/fault-upstream.cjs', '--port=0'], { env: { ...process.env, E2E_ENV_FILE: envFile }, stdio: 'ignore' })
    assert.equal(await new Promise(resolve => bad.once('exit', resolve)), 1)
    console.log('PASS private proxy identity, loopback injected failure and wrong-target startup refusal; no upstream requests')
  } finally { if (child && child.exitCode === null) { child.kill(); await new Promise(resolve => child.once('exit', resolve)) }; fs.rmSync(dir, { recursive: true, force: true }) }
}
main().catch(e => { console.error(e.message); process.exitCode = 1 })
