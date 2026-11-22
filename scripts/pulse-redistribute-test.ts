/** Pure: how a missed sitting is absorbed. Real room only, sitting limits, earliest first, never more than was missed. */
import { planRedistribution, MAX_TASK_MINUTES } from '../src/lib/planning/pulse/redistribute'

let passed = 0, failed = 0
const check = (n: string, ok: boolean, d = '') => { ok ? (passed++, console.log(`  ✓ ${n}`)) : (failed++, console.log(`  ✗ ${n}${d ? ` — ${d}` : ''}`)) }
const c = (id: string, date: string, duration: number) => ({ id, revision: 1, date, duration, title: id })

console.log('\nRedistribution planning')
{
  const r = planRedistribution({ missedMinutes: 40, candidates: [c('a', '2026-11-06', 30), c('b', '2026-11-07', 30)], dayRoom: { '2026-11-06': 60, '2026-11-07': 60 }, sittingLimit: 90 })
  check('a fitting shortfall goes to the earliest session and is fully placed', r.placed === 40 && r.unplaced === 0 && r.changes.length === 1 && r.changes[0].task_id === 'a')
  const split = planRedistribution({ missedMinutes: 50, candidates: [c('a', '2026-11-06', 30), c('b', '2026-11-07', 30)], dayRoom: { '2026-11-06': 20, '2026-11-07': 60 }, sittingLimit: 90 })
  check('a day with little room takes only what fits; the rest goes to the next day', split.changes.map(x => `${x.task_id}:${x.add_minutes}`).join() === 'a:20,b:30' && split.placed === 50)
  const noRoom = planRedistribution({ missedMinutes: 30, candidates: [c('a', '2026-11-06', 30)], dayRoom: { '2026-11-06': 0 }, sittingLimit: 90 })
  check('no free time that day: nothing is placed and the whole amount is reported as unplaced', noRoom.placed === 0 && noRoom.unplaced === 30 && noRoom.changes.length === 0)
  const limit = planRedistribution({ missedMinutes: 60, candidates: [c('a', '2026-11-06', 45)], dayRoom: { '2026-11-06': 200 }, sittingLimit: 60 })
  check('the sitting limit caps a session even when the day has room (45 + 15 = 60)', limit.placed === 15 && limit.unplaced === 45)
  const ceiling = planRedistribution({ missedMinutes: 60, candidates: [c('a', '2026-11-06', 170)], dayRoom: { '2026-11-06': 200 }, sittingLimit: 0 })
  check('with no limit set the 180-minute task ceiling still holds', ceiling.placed === MAX_TASK_MINUTES - 170)
  const day = planRedistribution({ missedMinutes: 100, candidates: [c('a', '2026-11-06', 20), c('b', '2026-11-06', 20)], dayRoom: { '2026-11-06': 50 }, sittingLimit: 90 })
  check('two sessions on one day share that day’s room, never double count it', day.placed === 50)
  check('never more than was missed', planRedistribution({ missedMinutes: 10, candidates: [c('a', '2026-11-06', 20)], dayRoom: { '2026-11-06': 100 }, sittingLimit: 90 }).placed === 10)
}

console.log('\nTimed sessions: the slot, not the day total')
{
  const slot = planRedistribution({ missedMinutes: 40, candidates: [{ ...c('t', '2026-11-06', 30), maxAdd: 10 }], dayRoom: { '2026-11-06': 200 }, sittingLimit: 90 })
  check('a timed session grows only into its free slot (10), however much day room there is', slot.placed === 10 && slot.unplaced === 30)
  const none = planRedistribution({ missedMinutes: 20, candidates: [{ ...c('t', '2026-11-06', 30), maxAdd: 0 }], dayRoom: { '2026-11-06': 200 }, sittingLimit: 90 })
  check('a session under way, outside its window or boxed in takes nothing (maxAdd 0)', none.placed === 0 && none.unplaced === 20)
  const spill = planRedistribution({ missedMinutes: 40, candidates: [{ ...c('t', '2026-11-06', 30), maxAdd: 10 }, c('d', '2026-11-07', 30)], dayRoom: { '2026-11-06': 200, '2026-11-07': 200 }, sittingLimit: 90 })
  check('what the slot cannot take goes to the next valid session, so partial absorption is exact', spill.changes.map(x => `${x.task_id}:${x.add_minutes}`).join() === 't:10,d:30' && spill.unplaced === 0)
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
