const assert = require('node:assert/strict')
const { spawn, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const net = require('node:net')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const lock = path.join(root, '.next-isolated.lock')
const tsconfig = path.join(root, 'tsconfig.json')
const nextEnv = path.join(root, 'next-env.d.ts')

const waitHttp = async (url, ms = 30000) => {
  const t = Date.now()
  while (Date.now() - t < ms) {
    try { await fetch(url); return } catch {}
    await new Promise(r => setTimeout(r, 250))
  }
  throw new Error(`Timed out waiting for ${url}`)
}

const portFree = port => new Promise(resolve => {
  const s = net.createServer()
  s.once('error', () => resolve(false))
  s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)))
})

async function main() {
  const beforeTs = fs.readFileSync(tsconfig, 'utf8')
  const beforeEnv = fs.readFileSync(nextEnv, 'utf8')

  // 1. Failed launch leaves no lock or distDir residue.
  const bad = spawnSync(process.execPath, ['scripts/local-stack-app.cjs', 'bogus'], { cwd: root, encoding: 'utf8' })
  assert.notEqual(bad.status, 0)
  assert.equal(fs.existsSync(lock), false)
  assert.equal(fs.readFileSync(tsconfig, 'utf8'), beforeTs)

  // 2. Normal launch + SIGTERM forwards termination and waits for isolated-next cleanup.
  const child = spawn(process.execPath, ['scripts/local-stack-app.cjs', 'dev', '--port=3199', '--dist=.next-teardown-test'], { cwd: root, stdio: 'pipe' })
  await waitHttp('http://127.0.0.1:3199/login')
  assert.equal(fs.existsSync(lock), true)
  child.kill('SIGTERM')
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for child exit after SIGTERM')), 15000)
    child.once('exit', () => { clearTimeout(timer); resolve() })
  })

  assert.equal(fs.existsSync(lock), false, '.next-isolated.lock must be removed after SIGTERM')
  assert.equal(await portFree(3199), true, 'port 3199 listener must be gone after SIGTERM')
  assert.equal(fs.readFileSync(tsconfig, 'utf8').includes('.next-teardown-test'), false, 'tsconfig.json must not retain .next-teardown-test')
  assert.equal(fs.readFileSync(nextEnv, 'utf8'), beforeEnv, 'next-env.d.ts must be restored')
  fs.rmSync(path.join(root, '.next-teardown-test'), { recursive: true, force: true })
  console.log('local-stack-app-test: PASS')
}

main().catch(e => { console.error(e); process.exit(1) })
