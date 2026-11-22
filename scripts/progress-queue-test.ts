import { createProgressQueue, mergeProgress, type ProgressPayload } from '../src/lib/tests/progressQueue'
let pass = 0, fail = 0
const ok = (n: string, c: boolean, d?: unknown) => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${c ? '' : ' — ' + JSON.stringify(d)}`) }
const gate = () => { let open!: () => void; const p = new Promise<void>(r => { open = r }); return { p, open } }

async function main() {
  // many heartbeats while one request is slow: bounded concurrency, merged payload
  const g = gate(); let concurrent = 0, peak = 0; const sent: ProgressPayload[] = []
  const q = createProgressQueue(async p => { concurrent++; peak = Math.max(peak, concurrent); sent.push(p); await g.p; concurrent--; return 'ok' })
  for (let s = 1; s <= 200; s++) q.push({ itemId: s % 2 ? 'q1' : 'q2', activeSeconds: s, interruptedSeconds: 0 })
  ok('only one heartbeat is ever in flight, however many are produced', peak === 1 && q.size() <= 3, { peak, size: q.size() })
  g.open(); await q.whenIdle()
  ok('200 heartbeats collapse to at most one send per question after the first', sent.length <= 3, sent.length)
  ok('the latest (largest) seconds per question survive the merge', sent.some(p => p.itemId === 'q1' && p.activeSeconds === 199) && sent.some(p => p.itemId === 'q2' && p.activeSeconds === 200), sent)
  ok('an older value never replaces a newer one when merged', mergeProgress({ itemId: 'a', activeSeconds: 50, interruptedSeconds: 9 }, { itemId: 'a', activeSeconds: 10, interruptedSeconds: 2 }).activeSeconds === 50)
  ok('a flag and a visit are kept through a merge', (m => m.flagged === true && m.visit === true)(mergeProgress({ itemId: 'a', activeSeconds: 1, interruptedSeconds: 0, visit: true }, { itemId: 'a', activeSeconds: 2, interruptedSeconds: 0, flagged: true })))

  // closed refusal stops everything
  let calls = 0
  const q2 = createProgressQueue(async () => { calls++; return 'stop' })
  q2.push({ itemId: 'a', activeSeconds: 1, interruptedSeconds: 0 }); await q2.whenIdle()
  q2.push({ itemId: 'a', activeSeconds: 2, interruptedSeconds: 0 }); q2.push({ itemId: 'b', activeSeconds: 2, interruptedSeconds: 0 }); await q2.whenIdle()
  ok('after the server says the attempt is closed, nothing further is sent', calls === 1 && q2.isClosed() && q2.size() === 0, calls)

  // a failing send never throws into the caller and does not wedge the queue
  let n = 0
  const q3 = createProgressQueue(async () => { n++; if (n === 1) throw new Error('network'); return 'ok' })
  q3.push({ itemId: 'a', activeSeconds: 1, interruptedSeconds: 0 }); q3.push({ itemId: 'b', activeSeconds: 1, interruptedSeconds: 0 }); await q3.whenIdle()
  ok('a failed heartbeat is dropped and the next one still goes out', n === 2)

  // final flush bypasses the queue and carries the merged latest value
  const g4 = gate(); const finals: { p: ProgressPayload; k: boolean }[] = []
  const q4 = createProgressQueue(async (p, k) => { finals.push({ p, k }); if (!k) await g4.p; return 'ok' })
  q4.push({ itemId: 'a', activeSeconds: 5, interruptedSeconds: 0 }); q4.push({ itemId: 'b', activeSeconds: 7, interruptedSeconds: 1 }); q4.final({ itemId: 'b', activeSeconds: 9, interruptedSeconds: 1 })
  ok('the page-hide flush is sent immediately even while a heartbeat is slow, with the merged value', finals.some(f => f.k && f.p.itemId === 'b' && f.p.activeSeconds === 9) && finals.filter(f => !f.k).length === 1)
  g4.open(); await q4.whenIdle()
  console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
}
main()
