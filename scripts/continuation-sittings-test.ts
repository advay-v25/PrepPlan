/** Long carried work in the weekly proposal (pure): ordered sittings that fit real gaps, the remainder waiting, and one-sitting work kept whole. */
import { nextSitting, placeContinuing, type ContinuingItem, type PlaceInput } from '../src/lib/planning/weeklyReview/composer'
import { fillWindows } from '../src/lib/planning/extraWindows'
let passed = 0, failed = 0
const check = (n: string, ok: boolean, d = '') => { ok ? (passed++, console.log(`  ✓ ${n}`)) : (failed++, console.log(`  ✗ ${n}${d ? ` — ${d}` : ''}`)) }
const item = (taskType: string, minutes: number, over: Partial<ContinuingItem> = {}): ContinuingItem => ({ taskId: 't', title: 'Task', taskType, minutes, intent: 'continue', lmId: null, outcomeId: null, repairThreadId: null, originalDate: '2027-01-01', ...over })
const days = ['2027-01-04', '2027-01-05', '2027-01-06']
const input = (items: ContinuingItem[], gaps: [number, number][][], over: Partial<PlaceInput> = {}): PlaceInput => ({ items, weekDates: days, studyDates: days, capacity: {}, maxSittingMinutes: 45, gapsByDate: Object.fromEntries(days.map((d, i) => [d, (gaps[i] ?? []).map(([start, end]) => ({ start, end }))])), ...over })
const run = (it: ContinuingItem, gaps: [number, number][][], over?: Partial<PlaceInput>) => placeContinuing(input([it], gaps, over)).placements[0]
const shape = (p: ReturnType<typeof run>) => (p.sittings ?? []).map(s => `${s.date?.slice(8) ?? 'wait'}:${s.minutes}`).join()
const sum = (p: ReturnType<typeof run>) => (p.sittings ?? []).reduce((n, s) => n + s.minutes, 0)

check('pieces are even, so no tiny remainder is stranded', nextSitting(50, 200, 45) === 25 && nextSitting(90, 200, 45) === 45 && nextSitting(20, 10, 45) === 0 && nextSitting(10, 60, 45) === 10)
const drain = (need: number, limit: number) => { const out: number[] = []; while (need > 0) { const t = nextSitting(need, 1000, limit); if (!t) return [...out, -need]; out.push(t); need -= t } return out }
check('every length up to three hours drains completely at every sitting limit, within the limit and never under 5', [20, 25, 30, 45, 60].every(l => Array.from({ length: 176 }, (_, i) => i + 5).every(n => { const d = drain(n, l); return d.every(x => x >= 5 && x <= l) && d.reduce((a, b) => a + b, 0) === n })))
check('45 minutes at a 20-minute limit is three sittings of 15', drain(45, 20).join() === '15,15,15')
let p = run(item('study', 120), [[[0, 60]], [[0, 60]], [[0, 60]]])
check('a long study task becomes ordered sittings within the limit, minutes preserved', shape(p) === '04:40,04:20,05:30,05:30' && sum(p) === 120, shape(p))
check('sittings are in date order', [...p.sittings!].map(s => s.date).join() === [...p.sittings!].map(s => s.date).sort().join())
p = run(item('review', 120), [[[0, 45]]])
check('what fits is proposed and the exact remainder waits', shape(p) === '04:40,wait:80' && sum(p) === 120 && /stays owed/.test(p.sittings![1].reason!), shape(p))
p = run(item('study', 40), [[[0, 20]], [[0, 25]]])
check('a task within the limit also splits when no single gap holds it', shape(p) === '04:20,05:20', shape(p))
p = run(item('study', 40), [[[0, 60]]])
check('a task that fits whole stays one sitting', !p.sittings && p.date === '2027-01-04')
p = run(item('study', 90), [[[0, 10]], [[0, 12]]])
check('no usable opening: one waiting task with its full minutes', !p.sittings && p.date === null && /no room/i.test(p.reason!))
for (const type of ['recheck', 'verification', 'repair']) {
  p = run(item(type, 60), [[[0, 200]]])
  check(`a ${type} longer than a sitting stays whole and says it needs a larger slot`, !p.sittings && p.date === null && /one sitting/.test(p.reason!) && /60-minute opening, longer than your 45-minute/.test(p.reason!), p.reason!)
}
p = run(item('recheck', 40), [[[0, 20]], [[0, 25]]])
check('a re-check is not split across gaps', !p.sittings && p.date === null && /one sitting/.test(p.reason!))
p = run(item('study', 90), [[[0, 45]], [[0, 100]]], { overrides: { t: '2027-01-05' } })
check('a chosen day takes what it can; the rest waits', shape(p) === '05:45,05:45', shape(p))
check('kept for later is never split', run(item('study', 90, { intent: 'later' }), [[[0, 200]]]).date === null)
const placed = placeContinuing(input([item('study', 90)], [[[0, 45]]]))
check('only placed minutes are reserved', placed.reservedStudyMinutes === 45 && placed.reservedByDate['2027-01-04'] === 45)

const windows = [{ date: '2027-01-04', start: 420, end: 480 }]
const f = fillWindows(windows, [{ key: 'a', title: 'a', minutes: 90, kind: 'continuing', splittable: true }], 45)
check('an added window takes sittings and returns the remainder', f.placed.map(x => `${x.start}:${x.minutes}`).join() === '420:45,465:15' && f.waiting[0].minutes === 30, JSON.stringify(f.placed))
check('a check stays whole in a long enough window, past the study limit', fillWindows(windows, [{ key: 'c', title: 'c', minutes: 60, kind: 'single' }], 45).placed[0]?.minutes === 60)
check('a check that no window holds stays whole and waiting', fillWindows(windows, [{ key: 'c', title: 'c', minutes: 75, kind: 'single' }], 45).waiting[0]?.minutes === 75)
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
