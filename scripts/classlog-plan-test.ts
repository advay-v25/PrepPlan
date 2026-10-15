/** Pure scenario + invariant tests for the class-log consolidation planner. */
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

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
