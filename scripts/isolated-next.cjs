#!/usr/bin/env node
// Runs `next <args>` with a disposable distDir (e.g. `node scripts/isolated-next.cjs .next-verify dev -p 3102`).
// Next.js rewrites the root next-env.d.ts to point at whatever distDir it ran with, so when the run ends, for any reason,
// canonical types are regenerated from the normal .next output, and the distDir entries it adds to tsconfig.json are removed. One isolated run at a time; other servers are untouched.
const { spawn, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const [dist, ...args] = process.argv.slice(2)
if (!/^\.next-[\w-]+$/.test(dist ?? '') || !args.length) {
  console.error('usage: node scripts/isolated-next.cjs .next-<name> <next args…>')
  process.exit(2)
}
const root = path.resolve(__dirname, '..')
const next = path.join(root, 'node_modules', '.bin', 'next')
const lock = path.join(root, '.next-isolated.lock')

const alive = pid => { try { process.kill(pid, 0); return true } catch { return false } }
try { fs.mkdirSync(lock) } catch {
  const holder = Number(fs.readFileSync(path.join(lock, 'pid'), 'utf8').trim())
  if (alive(holder)) { console.error(`Another isolated Next.js run (pid ${holder}) is active; wait for it to finish.`); process.exit(1) }
  fs.rmSync(lock, { recursive: true })
  fs.mkdirSync(lock)
}
fs.writeFileSync(path.join(lock, 'pid'), String(process.pid))

let restored = false
const restore = () => {
  if (restored) return
  restored = true
  const { NEXT_DIST_DIR, ...env } = process.env
  const r = spawnSync(next, ['typegen'], { cwd: root, env, stdio: 'inherit' })
  const ts = path.join(root, 'tsconfig.json')
  const text = fs.readFileSync(ts, 'utf8')
  const clean = text.replace(new RegExp(`,\\n\\s*"${dist.replaceAll('.', '\\.')}/[^"]*"`, 'g'), '')
  if (clean !== text) fs.writeFileSync(ts, clean)
  fs.rmSync(lock, { recursive: true, force: true })
  if (r.status) console.error('Canonical type regeneration failed; run `npm run types:restore`.')
}

const child = spawn(next, args, { cwd: root, env: { ...process.env, NEXT_DIST_DIR: dist }, stdio: 'inherit' })
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => child.kill(sig))
child.on('error', e => { console.error(e.message); restore(); process.exit(1) })
child.on('exit', (code, signal) => { restore(); process.exit(code ?? (signal ? 1 : 0)) })
