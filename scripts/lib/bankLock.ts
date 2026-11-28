import fs from 'node:fs'
import path from 'node:path'
/**
 * One fixture bank at a time. A second bank for overlapping readings would contaminate the first run's delivered papers (and an "actual bank"
 * measurement), which is exactly the cross-worker contamination the lifecycle proof must not cause itself. mkdir is atomic; a dead holder is reclaimed.
 */
// The lock guards ONE database. A local-stack run has its own database, so its lock lives in the stack directory and never queues behind a run against another target.
const LOCK = process.env.E2E_SUITE === 'local-stack' && process.env.LOCAL_STACK_DIR ? path.join(process.env.LOCAL_STACK_DIR, '.bank.lock') : path.resolve(process.cwd(), '.lifecycle-bank.lock')
const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }
export async function acquireBankLock(waitMs = 20 * 60_000) {
  const until = Date.now() + waitMs
  for (;;) {
    try { fs.mkdirSync(LOCK); fs.writeFileSync(path.join(LOCK, 'pid'), String(process.pid)); return }
    catch {
      let holder = 0
      try { holder = Number(fs.readFileSync(path.join(LOCK, 'pid'), 'utf8').trim() || 0) } catch { /* pid file not written yet */ }
      // A just-created lock directory has no pid file for a moment: that is a holder mid-handoff, not a dead one. Only a directory that stayed pid-less for 5 s is reclaimed.
      if (!holder) { let age = Infinity; try { age = Date.now() - fs.statSync(LOCK).mtimeMs } catch { continue } if (age < 5000) { await new Promise(r => setTimeout(r, 200)); continue } }
      if (!holder || !alive(holder)) { fs.rmSync(LOCK, { recursive: true, force: true }); continue }
      if (Date.now() > until) throw new Error(`fixture bank lock is held by pid ${holder}; refusing to create an overlapping bank`)
      await new Promise(r => setTimeout(r, 3000))
    }
  }
}
export function releaseBankLock() { try { if (Number(fs.readFileSync(path.join(LOCK, 'pid'), 'utf8')) === process.pid) fs.rmSync(LOCK, { recursive: true, force: true }) } catch { /* already gone */ } }
