/** Pure scenario + invariant tests for the class-log consolidation planner. */
import { classLogFingerprint } from '../src/lib/planning/classlog/service'
import { classEntryIdentity } from '../src/lib/planning/classlog/identity'
import { parseLogInput } from '../src/lib/planning/classlog/parse'
import { occurrenceParts } from '../src/lib/planning/classlog/service'
import { remainingWindow } from '../src/lib/planning/pulse/capacity'
import { sittingText, sittingSuffix } from '../src/lib/planning/classlog/taskText'
import { planClassConsolidation, coveredUnits, DAILY_ABSORPTION_CAP_UNITS, type LoggedItem, type OpenDay, type ConsolidationPlan } from '../src/lib/planning/classlog/consolidation'

let passed = 0, failed = 0
const check = (name: string, ok: boolean, detail = '') => { if (ok) { passed++; console.log(`  ✓ ${name}`) } else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) } }

const item = (o: Partial<LoggedItem> & { classDate: string; outcomeId: string }): LoggedItem => ({
  sessionId: `s-${o.classDate}`, moduleId: 'fsa-income', title: o.outcomeId, extent: 'full', outcomeEffortUnits: 1, ...o,
})
const days = (dates: string[], cap = 120): OpenDay[] => dates.map(date => ({ date, capacityMinutes: cap }))
const M = 60

/** Invariants that must hold for every plan. */
function invariants(label: string, plan: ConsolidationPlan, input: { items: LoggedItem[]; days: OpenDay[] }) {
  const byDay = new Map<string, number>()
  for (const t of plan.tasks) byDay.set(t.date, (byDay.get(t.date) ?? 0) + t.minutes)
  const cap = new Map(input.days.map(d => [d.date, d.capacityMinutes]))
  check(`${label}: no day beyond its capacity`, [...byDay].every(([d, m]) => m <= (cap.get(d) ?? 0)))
  check(`${label}: only open days are used`, plan.tasks.every(t => cap.has(t.date)))
  check(`${label}: nothing on or before the class day`, plan.tasks.filter(t => t.outcomeId).every(t => {
    const it = input.items.find(i => i.outcomeId === t.outcomeId && i.sessionId === t.sessionId)!
    return t.date > it.classDate
  }))
  const placed = new Set(plan.tasks.filter(t => t.outcomeId).map(t => t.outcomeId))
  const carried = new Set(plan.carryover.map(c => c.outcomeId))
  check(`${label}: every logged outcome is placed or carried over`, input.items.every(i => placed.has(i.outcomeId) || carried.has(i.outcomeId)))
  check(`${label}: no duplicate task for the same outcome-day`, new Set(plan.tasks.map(t => `${t.outcomeId}|${t.date}|${t.title}`)).size === plan.tasks.length)
}

console.log('\nClass-log consolidation planner\n')

// --- Sat + Sun: cycle Sat 09-12 .. Fri 09-18, paper Friday
{
  const sat = [item({ classDate: '2026-09-12', outcomeId: 'eps', extent: 'part', title: 'EPS' }), item({ classDate: '2026-09-12', outcomeId: 'ci-x', moduleId: 'ci', title: 'CI part', extent: 'part' })]
  const openAfterSat = days(['2026-09-13', '2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17'])
  const p1 = planClassConsolidation({ items: sat, days: openAfterSat, repairs: [], minutesPerEffortUnit: 60 })
  invariants('Sat log', p1, { items: sat, days: openAfterSat })
  check('Sat log: consolidation starts Sunday, the day after class', p1.tasks[0].date === '2026-09-13')
  check('Sat log: nothing lands on the paper day (Friday)', p1.tasks.every(t => t.date !== '2026-09-18'))

  const sun = [...sat, item({ classDate: '2026-09-13', outcomeId: 'bs', title: 'Balance sheet', extent: 'part' }), item({ classDate: '2026-09-13', outcomeId: 'eco', moduleId: 'eco', title: 'Econ part', extent: 'part' })]
  const openAfterSun = days(['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17'])
  const p2 = planClassConsolidation({ items: sun, days: openAfterSun, repairs: [], minutesPerEffortUnit: 60 })
  invariants('Sun log', p2, { items: sun, days: openAfterSun })
  check('Sun log: newest class (Sunday) is placed before older Saturday material', p2.tasks[0].outcomeId === 'bs' || p2.tasks[0].outcomeId === 'eco')
  check('Sun log: all four outcomes appear', new Set(p2.tasks.map(t => t.outcomeId)).size === 4)
}

// --- Tue + Thu: cycle Tue 09-15 .. Mon 09-21
{
  const tue = [item({ classDate: '2026-09-15', outcomeId: 'a', extent: 'part' })]
  const open1 = days(['2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20'])
  const p = planClassConsolidation({ items: tue, days: open1, repairs: [], minutesPerEffortUnit: 60 })
  invariants('Tue log', p, { items: tue, days: open1 })
  check('Tue log: Wednesday gets part of Tuesday’s material', p.tasks.some(t => t.date === '2026-09-16'))
  const thu = [...tue, item({ classDate: '2026-09-17', outcomeId: 'b' })]
  const open2 = days(['2026-09-18', '2026-09-19', '2026-09-20'])
  const p2 = planClassConsolidation({ items: thu, days: open2, repairs: [], minutesPerEffortUnit: 60 })
  invariants('Thu log', p2, { items: thu, days: open2 })
  check('Thu log: the paper day (Monday) is untouched', p2.tasks.every(t => t.date !== '2026-09-21'))
}

// --- priorities, limits, honesty
{
  const items = [item({ classDate: '2026-09-12', outcomeId: 'x' })]
  const d = days(['2026-09-13', '2026-09-14'], 60)
  const p = planClassConsolidation({ items, days: d, repairs: [{ id: 'r1', title: 'Repair: y', minutes: 45 }], minutesPerEffortUnit: 60 })
  check('repairs are placed ahead of new class material', p.tasks[0].lane === 'repair')
  invariants('repair + class', p, { items, days: d })
}
{
  const items = ['a', 'b', 'c', 'd', 'e', 'f'].map(o => item({ classDate: '2026-09-12', outcomeId: o, outcomeEffortUnits: 2 }))
  const d = days(['2026-09-13', '2026-09-14'], 60)
  const p = planClassConsolidation({ items, days: d, repairs: [], minutesPerEffortUnit: 60 })
  invariants('overload', p, { items, days: d })
  check('too much material is carried over, not squeezed in', p.carryover.length > 0 && p.pressure === 'over')
  check('carryover names the reason', p.carryover.every(c => c.reason === 'no_capacity'))
}
{
  const items = [item({ classDate: '2026-09-17', outcomeId: 'late' })]
  const p = planClassConsolidation({ items, days: [], repairs: [], minutesPerEffortUnit: 60 })
  check('no open days: everything is carryover with the right reason', p.tasks.length === 0 && p.carryover[0]?.reason === 'no_open_day')
}
{
  const items = [item({ classDate: '2026-09-12', outcomeId: 'a', extent: 'part' }), item({ classDate: '2026-09-12', outcomeId: 'b', extent: 'full' })]
  check('a part costs half an outcome, a full costs all of it', coveredUnits(items[0]) === 0.5 && coveredUnits(items[1]) === 1)
}
{
  const items = [item({ classDate: '2026-09-12', outcomeId: 'a' }), item({ classDate: '2026-09-12', outcomeId: 'b' })]
  const d = days(['2026-09-13', '2026-09-14', '2026-09-15'])
  const first = planClassConsolidation({ items: [items[0]], days: d, repairs: [], minutesPerEffortUnit: 60 })
  const already = new Set([`${items[0].sessionId}:a`])
  const second = planClassConsolidation({ items, days: d, repairs: [], minutesPerEffortUnit: 60, alreadyPlanned: already })
  check('re-running with an already-planned outcome does not plan it twice', second.tasks.every(t => t.outcomeId === 'b') && first.tasks.length > 0)
  const again = planClassConsolidation({ items, days: d, repairs: [], minutesPerEffortUnit: 60, alreadyPlanned: new Set(items.map(i => `${i.sessionId}:${i.outcomeId}`)) })
  check('applying the same log twice changes nothing', again.tasks.length === 0 && again.carryover.length === 0)
}
{
  const items = [item({ classDate: '2026-09-12', outcomeId: 'rev', revision: true })]
  const d = days(['2026-09-13'])
  const p = planClassConsolidation({ items, days: d, repairs: [], minutesPerEffortUnit: 60 })
  check('a revision class is planned as revision, not new consolidation', p.tasks[0]?.lane === 'revision' && p.tasks[0]?.taskType === 'review')
}
{
  const items = [item({ classDate: '2026-09-12', outcomeId: 'big', outcomeEffortUnits: 4 })]
  const d = days(['2026-09-13', '2026-09-14', '2026-09-15'], 200)
  const p = planClassConsolidation({ items, days: d, repairs: [], minutesPerEffortUnit: 60 })
  check('a large outcome is split across days, no chunk over 90 minutes', p.tasks.length >= 3 && p.tasks.every(t => t.minutes <= 90))
  check('absorption cap respected per day', DAILY_ABSORPTION_CAP_UNITS >= 1 && p.tasks.every(t => t.minutes / 60 <= DAILY_ABSORPTION_CAP_UNITS))
}
{
  const base = { cycleId: 'c1', verificationDate: '2026-09-20', tasks: [{ date: '2026-09-14', title: 'T', minutes: 40, outcomeId: 'o1', sessionId: 's1', lane: 'new', detail: 'basic EPS only' }], carryover: [{ title: 'W', reason: 'no room' }], pressure: 'tight', skippedStudied: 0 }
  const h = (o: Partial<typeof base> = {}) => classLogFingerprint({ ...base, ...o })
  check('class-log token: identical reviewed effects give an identical token (an irrelevant change leaves the preview valid)', h() === h({ tasks: base.tasks.map(t => ({ ...t })) }))
  check('class-log token: a different open week (cycle) invalidates', h() !== h({ cycleId: 'c2' }))
  check('class-log token: a moved verification day invalidates', h() !== h({ verificationDate: '2026-09-19' }))
  check('class-log token: a changed task day, length, mapping, lane or method note each invalidate', [{ date: '2026-09-15' }, { minutes: 45 }, { outcomeId: 'o2' }, { sessionId: 's2' }, { lane: 'revision' }, { detail: 'diluted EPS' }].every(c => h() !== h({ tasks: [{ ...base.tasks[0], ...c }] })))
  check('class-log token: changed waiting work, load verdict or skipped-as-studied count each invalidate', h() !== h({ carryover: [] }) && h() !== h({ pressure: 'over' }) && h() !== h({ skippedStudied: 1 }))
}

console.log('\nPhase 1: sitting limit, contiguous gaps, exact minutes, linked sittings')
{
  // The audit case: an 88-minute follow-up at a 45-minute limit.
  const it = item({ classDate: '2026-11-08', outcomeId: 'rev', requiredMinutes: 88 })
  const p = planClassConsolidation({ items: [it], days: [{ date: '2026-11-10', capacityMinutes: 120 }, { date: '2026-11-11', capacityMinutes: 120 }], repairs: [], minutesPerEffortUnit: 60, maxSittingMinutes: 45 })
  check('88 minutes at a 45-minute limit becomes two linked sittings of 44, never one 88', p.tasks.length === 2 && p.tasks.every(t => t.minutes === 44) && p.carryover.length === 0, JSON.stringify(p.tasks.map(t => t.minutes)))
  check('the total proposed effort is kept exactly (88)', p.tasks.reduce((n, t) => n + t.minutes, 0) === 88)
  check('each sitting declares the one before it, in date order (never inferred from the title)', p.tasks[0].after === null && p.tasks[1].after === p.tasks[0].key && p.tasks[0].date <= p.tasks[1].date)
  check('the settled count and position are recorded', p.tasks[0].sitting?.index === 1 && p.tasks[1].sitting?.index === 2 && p.tasks[1].sitting?.count === 2)
  check('sittings of one item spread over days when days exist', new Set(p.tasks.map(t => t.date)).size === 2)
  const big = planClassConsolidation({ items: [item({ classDate: '2026-11-08', outcomeId: 'x', requiredMinutes: 100 })], days: days(['2026-11-10', '2026-11-11', '2026-11-12'], 200), repairs: [], minutesPerEffortUnit: 60, maxSittingMinutes: 45 })
  check('100 minutes at 45 is three near-equal sittings (34/33/33), not 45 + 45 + a stub', big.tasks.length === 3 && Math.max(...big.tasks.map(t => t.minutes)) - Math.min(...big.tasks.map(t => t.minutes)) <= 1 && big.tasks.every(t => t.minutes <= 45))
  const none = planClassConsolidation({ items: [item({ classDate: '2026-11-08', outcomeId: 'y', requiredMinutes: 20 })], days: days(['2026-11-10']), repairs: [], minutesPerEffortUnit: 60, maxSittingMinutes: 45 })
  check('a single sitting that fits carries no sitting suffix and settled count 1', none.tasks.length === 1 && none.tasks[0].sitting?.count === 1 && sittingSuffix(1, 1) === '')
  const exact = planClassConsolidation({ items: [item({ classDate: '2026-11-08', outcomeId: 'z', requiredMinutes: 8 })], days: days(['2026-11-10']), repairs: [], minutesPerEffortUnit: 60, maxSittingMinutes: 45 })
  check('a small obligation keeps its exact minutes (8, not rounded up to 15)', exact.tasks.length === 1 && exact.tasks[0].minutes === 8)
}
{
  // A covered effort that is not a whole number of minutes (20.4) at a 20-minute limit is one 20-minute sitting, not two sub-minimum stubs that fit nowhere.
  const p = planClassConsolidation({ items: [item({ classDate: '2026-11-08', outcomeId: 'dec', outcomeEffortUnits: 0.48, extent: 'part' })], days: [{ date: '2026-11-10', capacityMinutes: 240 }], repairs: [], minutesPerEffortUnit: 85, maxSittingMinutes: 20 })
  check('20.4 minutes at a 20-minute limit is one 20-minute sitting (regression: it used to place nothing)', p.tasks.length === 1 && p.tasks[0].minutes === 20 && p.carryover.length === 0, JSON.stringify(p))
  const tiny = planClassConsolidation({ items: [item({ classDate: '2026-11-08', outcomeId: 'tl', requiredMinutes: 30 })], days: days(['2026-11-10', '2026-11-11', '2026-11-12'], 240), repairs: [], minutesPerEffortUnit: 60, maxSittingMinutes: 10 })
  check('a limit below the usual minimum piece still splits (30 at 10 = three sittings of 10)', tiny.tasks.length === 3 && tiny.tasks.every(t => t.minutes === 10))
}
{
  // Fragmented rooms: two gaps of 30 and 20 minutes are not a 50-minute sitting.
  const p = planClassConsolidation({ items: [item({ classDate: '2026-11-08', outcomeId: 'f', requiredMinutes: 60 })], days: [{ date: '2026-11-10', capacityMinutes: 50, gaps: [30, 20] }], repairs: [], minutesPerEffortUnit: 60, maxSittingMinutes: 45 })
  // Intentional change from the earlier one-sitting-per-item-per-day rule: a limit is per SITTING, so the 20-minute gap can hold a second sitting.
  check('no sitting is longer than the largest contiguous gap it sits in (30, not the 50-minute sum of 30 and 20)', p.tasks.length === 2 && p.tasks.every(t => t.minutes <= 30) && p.tasks[0].minutes === 30)
  check('both gaps are used by ordered same-day sittings of 30 and 20; the remaining 10 minutes are owed exactly', p.tasks[1].minutes === 20 && p.carryover.length === 1 && p.carryover[0].remainingMinutes === 10 && p.carryover[0].placedMinutes === 50)
  check('the verdict is over, and the sittings of a partly placed item do not claim a settled total', p.pressure === 'over' && p.tasks.every(t => t.sitting?.count === null))
  // Small capacity: place what fits, owe the rest, and a retry plans ONLY the rest.
  const first = planClassConsolidation({ items: [item({ classDate: '2026-11-08', outcomeId: 'q', requiredMinutes: 100 })], days: [{ date: '2026-11-10', capacityMinutes: 40 }], repairs: [], minutesPerEffortUnit: 60, maxSittingMinutes: 45 })
  const placed = first.tasks.reduce((n, t) => n + t.minutes, 0), owed = first.carryover[0]?.remainingMinutes ?? 0
  check('small capacity: 40 placed and 60 owed (exactly the obligation, no more)', placed === 40 && owed === 60, `${placed}/${owed}`)
  const retry = planClassConsolidation({ items: [item({ classDate: '2026-11-08', outcomeId: 'q', requiredMinutes: owed, existing: { groupId: 'g1', count: first.tasks.length, lastTaskKey: 'task-existing' } })], days: days(['2026-11-11', '2026-11-12'], 100), repairs: [], minutesPerEffortUnit: 60, maxSittingMinutes: 45 })
  check('the retry plans only what is still owed (60), not the full 100 again', retry.tasks.reduce((n, t) => n + t.minutes, 0) === 60 && retry.carryover.length === 0)
  check('later sittings continue the numbering and follow the existing last sitting', retry.tasks[0].sitting?.index === first.tasks.length + 1 && retry.tasks[0].after === 'task-existing')
  const zero = planClassConsolidation({ items: [item({ classDate: '2026-11-08', outcomeId: 'q', requiredMinutes: 0 })], days: days(['2026-11-11']), repairs: [], minutesPerEffortUnit: 60 })
  check('nothing owed means nothing planned', zero.tasks.length === 0 && zero.carryover.length === 0)
  const noRoom = planClassConsolidation({ items: [item({ classDate: '2026-11-08', outcomeId: 'n', requiredMinutes: 45 })], days: [{ date: '2026-11-10', capacityMinutes: 0 }], repairs: [], minutesPerEffortUnit: 60, maxSittingMinutes: 45 })
  check('no room at all: nothing placed, the whole 45 minutes owed, reason no_capacity, verdict over', noRoom.tasks.length === 0 && noRoom.carryover[0].remainingMinutes === 45 && noRoom.carryover[0].reason === 'no_capacity' && noRoom.pressure === 'over')
}
{
  // The clock: a window that has passed is not time. Local midnight and a daylight-saving change keep this honest.
  const w = { start: '09:00', end: '13:00' }
  check('the audit case: at 19:54 the Sunday 09:00-13:00 window is gone', remainingWindow(w, '2026-11-15', 'Asia/Kolkata', new Date('2026-11-15T14:24:00Z')) === null)
  check('earlier the same day only the rest of the window remains', JSON.stringify(remainingWindow(w, '2026-11-15', 'Asia/Kolkata', new Date('2026-11-15T05:30:00Z'))) === JSON.stringify({ start: '11:00', end: '13:00' }))
  check('at local midnight the old day is empty and the new day is whole', remainingWindow(w, '2026-11-15', 'Asia/Kolkata', new Date('2026-11-15T18:31:00Z')) === null && JSON.stringify(remainingWindow(w, '2026-11-16', 'Asia/Kolkata', new Date('2026-11-15T18:31:00Z'))) === JSON.stringify(w))
  // Europe/London clocks go forward at 01:00 UTC on 2027-03-28: 01:00-02:00 local does not exist.
  const dst = { start: '01:00', end: '03:00' }
  check('across the spring-forward gap the window is measured in local wall-clock time (02:01 BST leaves 02:01-03:00)', JSON.stringify(remainingWindow(dst, '2027-03-28', 'Europe/London', new Date('2027-03-28T01:01:00Z'))) === JSON.stringify({ start: '02:01', end: '03:00' }))
  check('just before the change the window is still whole to its end (00:59 GMT)', JSON.stringify(remainingWindow(dst, '2027-03-28', 'Europe/London', new Date('2027-03-28T00:59:00Z'))) === JSON.stringify({ start: '01:00', end: '03:00' }))
}
{
  const t = sittingText({ outcomeTitle: 'Describe revenue recognition', readingNo: 20, readingTitle: 'Revenue', classDate: '2026-11-15', extent: 'part', revision: false, portionNote: 'the five steps', index: 2, count: 3 })
  check('instructions name the mapped outcome, the bounded part and the class date', /Describe revenue recognition/.test(t.objective) && /five steps/.test(t.objective) && /Reading 20/.test(t.objective) && /15 November/.test(t.rationale))
  check('a split sitting says which part of the activity it continues and which sitting it is', /Sitting 2 of 3/.test(t.objective) && /continues sitting 1/.test(t.approach))
  check('sittings of one piece of work do not read alike', sittingText({ outcomeTitle: 'X', readingNo: 1, readingTitle: 'R', classDate: '2026-11-15', extent: 'full', revision: false, index: 1, count: 3 }).approach !== sittingText({ outcomeTitle: 'X', readingNo: 1, readingTitle: 'R', classDate: '2026-11-15', extent: 'full', revision: false, index: 2, count: 3 }).approach)
  check('a part says why it stays pending; a full says what a later paper can do, with no guarantee', /pending/.test(t.verification) && !/guarantee|will understand|ready/.test(t.verification.toLowerCase().replace('readiness','')))
  check('completion allows partial reporting and records this sitting only', /partly done/.test(t.completion) && /this sitting only/.test(t.completion))
  check('no invented content: no page references or quoted book material', ![t.objective, t.approach, t.completion, t.verification, t.rationale].some(x => /\bpage\s+\d|\bp\.\s*\d/i.test(x)))
}
console.log('\nPhase 1 completion: several ordered sittings of one item on one day')
{
  // The owner probe: one 120-minute window, 88 minutes owed, a 45-minute limit.
  const p = planClassConsolidation({ items: [item({ classDate: '2026-11-08', outcomeId: 'probe', requiredMinutes: 88 })], days: [{ date: '2026-11-10', capacityMinutes: 120 }], repairs: [], minutesPerEffortUnit: 60, maxSittingMinutes: 45 })
  check('probe: 88 minutes become 44 + 44 on the single available day (was 45 placed, 43 owed)', p.tasks.length === 2 && p.tasks.every(t => t.minutes === 44 && t.date === '2026-11-10') && p.carryover.length === 0, JSON.stringify(p))
  check('probe: the two same-day sittings declare their order and keep the exact total', p.tasks[1].after === p.tasks[0].key && p.tasks[0].after === null && p.tasks.reduce((n, t) => n + t.minutes, 0) === 88)
  check('probe: pressure is not over once everything is placed', p.pressure !== 'over')
  // Fragments: 40 minutes cannot go into two separate 20-minute gaps as ONE sitting; at a 45 limit the item is not cut to fit arithmetic.
  const f = planClassConsolidation({ items: [item({ classDate: '2026-11-08', outcomeId: 'frag', requiredMinutes: 40 })], days: [{ date: '2026-11-10', capacityMinutes: 40, gaps: [20, 20] }], repairs: [], minutesPerEffortUnit: 60, maxSittingMinutes: 45 })
  check('fragments: a 40-minute need is planned as sittings that each fit one 20-minute gap (20 + 20), never one 40-minute block', f.tasks.length === 2 && f.tasks.every(t => t.minutes === 20), JSON.stringify(f.tasks.map(t => t.minutes)))
  const f2 = planClassConsolidation({ items: [item({ classDate: '2026-11-08', outcomeId: 'frag2', requiredMinutes: 40 })], days: [{ date: '2026-11-10', capacityMinutes: 20, gaps: [20] }], repairs: [], minutesPerEffortUnit: 60, maxSittingMinutes: 45 })
  check('fragments: one 20-minute gap places 20 and owes 20 exactly', f2.tasks.reduce((n, t) => n + t.minutes, 0) === 20 && f2.carryover[0]?.remainingMinutes === 20)
  // Several days still spread first (spacing), then same-day sittings only when the days run out.
  const sp = planClassConsolidation({ items: [item({ classDate: '2026-11-08', outcomeId: 'sp', requiredMinutes: 90 })], days: days(['2026-11-10', '2026-11-11'], 120), repairs: [], minutesPerEffortUnit: 60, maxSittingMinutes: 45 })
  check('spread: with two open days, two sittings of 45 land on separate days', sp.tasks.length === 2 && new Set(sp.tasks.map(t => t.date)).size === 2)
  // Two sessions covering the same outcome are two items.
  const two = planClassConsolidation({ items: [item({ classDate: '2026-11-08', sessionId: 'sA', outcomeId: 'same', requiredMinutes: 30 }), item({ classDate: '2026-11-09', sessionId: 'sB', outcomeId: 'same', requiredMinutes: 30 })], days: days(['2026-11-10'], 120), repairs: [], minutesPerEffortUnit: 60, maxSittingMinutes: 45 })
  check('same outcome, two sessions: two distinct items, each with its own sitting and its own key', two.tasks.length === 2 && new Set(two.tasks.map(t => t.itemKey)).size === 2 && two.tasks.every(t => t.after === null))
  check('same outcome, two sessions: carryover is reported per session, not collapsed to one', (() => { const c = planClassConsolidation({ items: [item({ classDate: '2026-11-08', sessionId: 'sA', outcomeId: 'same', requiredMinutes: 30 }), item({ classDate: '2026-11-09', sessionId: 'sB', outcomeId: 'same', requiredMinutes: 30 })], days: [{ date: '2026-11-10', capacityMinutes: 30 }], repairs: [], minutesPerEffortUnit: 60, maxSittingMinutes: 45 }); return c.carryover.length === 1 && c.carryover[0].sessionId !== undefined && c.tasks.length === 1 })())
}
{
  const base = { date: '2026-11-15', kind: 'covered', note: 'A class', items: [{ outcome: 'a', extent: 'part', note: 'EPS only', studied: false }, { outcome: 'b', extent: 'full' }] }
  const id = classEntryIdentity(base)
  check('retry identity ignores item display order and blank/default fields', classEntryIdentity({ ...base, note: ' A class ', items: [...base.items].reverse().map(i => ({ ...i, studied: i.studied ?? false })) }) === id)
  check('retry identity preserves the reported class note', classEntryIdentity({ ...base, note: 'Other class' }) !== id)
  check('retry identity preserves the reported portion note', classEntryIdentity({ ...base, items: [{ ...base.items[0], note: 'All EPS' }, base.items[1]] }) !== id)
  check('retry identity preserves the studied-in-class choice', classEntryIdentity({ ...base, items: [{ ...base.items[0], studied: true }, base.items[1]] }) !== id)
  check('class logging rejects impossible dates before reaching the database', parseLogInput({ classDate: '2026-02-30', kind: 'none', items: [] }) === null)
  check('class logging accepts real leap days', parseLogInput({ classDate: '2028-02-29', kind: 'none', items: [] }) !== null)
  const u = '3f2b8c1e-5d4a-4b7c-9e61-0a1b2c3d4e5f', v = '9a8b7c6d-1e2f-4a3b-8c5d-6e7f80910a1b'
  check('a retry of the same class keeps one identity; the same outcome logged for a DIFFERENT class does not', classEntryIdentity({ ...base, occurrence: `series:${u}:2026-11-15` }) === classEntryIdentity({ ...base, occurrence: `series:${u}:2026-11-15` })
    && classEntryIdentity({ ...base, occurrence: `series:${u}:2026-11-15` }) !== classEntryIdentity({ ...base, occurrence: `series:${v}:2026-11-15` })
    && classEntryIdentity({ ...base, occurrence: `series:${u}:2026-11-15` }) !== id)
  check('a class identity is a series occurrence, a one-off or a manual session; anything else is refused at the boundary',
    ['series:' + u + ':2026-11-15', 'once:' + u, 'manual:' + v].every(k => parseLogInput({ classDate: '2026-11-15', kind: 'none', items: [], occurrenceKey: k })?.occurrenceKey === k)
    && ['series:x', 'once:', 'manual:1', `series:${u}`, `once:${u}:2026-11-15`, 5, ''].every(k => parseLogInput({ classDate: '2026-11-15', kind: 'none', items: [], occurrenceKey: k }) === null))
  check('no identity at all stays a legacy date-level entry (unresolved, never guessed)', parseLogInput({ classDate: '2026-11-15', kind: 'none', items: [] })?.occurrenceKey === undefined)
  check('occurrenceParts names the commitment and the ORIGINAL date a key carries', occurrenceParts(`series:${u}:2026-11-08`).commitmentId === u && occurrenceParts(`series:${u}:2026-11-08`).date === '2026-11-08'
    && occurrenceParts(`once:${u}`).date === null && occurrenceParts(`manual:${v}`).commitmentId === null)
}
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
