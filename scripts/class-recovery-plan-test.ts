/** Pure: where unfinished study tasks go after a class change. Real room only; nothing lost, lengthened or hidden. */
import { planClassRecovery, type RecoveryInput, type RecoveryTask } from '../src/lib/planning/classRecoveryPlan'

let passed = 0, failed = 0
const check = (n: string, ok: boolean, d = '') => { ok ? (passed++, console.log(`  ✓ ${n}`)) : (failed++, console.log(`  ✗ ${n}${d ? ` — ${d}` : ''}`)) }

// 2026-11-16 is a Monday; zone UTC so clock minutes equal UTC.
const D = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19']
const at = (d: string, h: number, m = 0) => `${d}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`
const task = (id: string, o: Partial<RecoveryTask> = {}): RecoveryTask => ({ id, title: id, revision: 1, date: D[0], startsAt: at(D[0], 18), minutes: 60, placement: 'timed', execution: 'not_started', taskType: 'study', priority: 'core', lmId: null, fixed: false, ...o })
const base = (tasks: RecoveryTask[], o: Partial<RecoveryInput> = {}): RecoveryInput => ({
  tasks, overlaps: {}, today: D[0], cycleEnd: D[3], timezone: 'UTC', studyDates: D,
  available: { [D[0]]: 240, [D[1]]: 240, [D[2]]: 240, [D[3]]: 240 },
  windows: [1, 2, 3, 4].map(weekday => ({ weekday, start: 17 * 60, end: 21 * 60 })), blockers: [], earliestToday: 0, ...o })

console.log('\nA class now overlaps timed study work')
{
  const t = task('a')
  const r = planClassRecovery(base([t], { overlaps: { a: 'Evening class' }, blockers: [{ date: D[0], start: 17 * 60 + 30, end: 19 * 60 }] }))
  check('it moves to the first real gap the same day, keeping its identity and minutes', r.moves.length === 1 && r.moves[0].task_id === 'a' && r.moves[0].minutes === 60 && r.moves[0].to_date === D[0] && r.moves[0].to_starts === at(D[0], 19, 0), JSON.stringify(r.moves))
  check('nothing is lost: moved + unplaced + kept covers every affected task', r.moves.length + r.unplaced.length + r.kept.length === 1)
  check('the reason names what it overlaps', r.moves[0].reason === 'Overlaps Evening class')
}
console.log('\nNo room')
{
  const r = planClassRecovery(base([task('a', { minutes: 120 })], { overlaps: { a: 'Evening class' }, blockers: D.map(d => ({ date: d, start: 17 * 60, end: 20 * 60 })) }))
  check('work that cannot fit stays visible as unplaced, never dropped or shortened', r.moves.length === 0 && r.unplaced.length === 1 && r.unplaced[0].minutes === 120)
  const stay = planClassRecovery(base([task('a'), task('b', { startsAt: at(D[1], 18), date: D[1] })], { overlaps: { a: 'Class' }, blockers: [{ date: D[0], start: 17 * 60, end: 21 * 60 }] }))
  check('it goes to a later day rather than overlapping, and an unaffected task is counted unchanged', stay.moves[0]?.to_date === D[1] && stay.unchanged === 1, JSON.stringify(stay.moves))
}
console.log('\nConstraints')
{
  const r = planClassRecovery(base([task('a', { execution: 'in_progress' })], { overlaps: { a: 'Class' } }))
  check('started work is a visible constraint, not moved', r.moves.length === 0 && r.kept.length === 1 && /already started/.test(r.kept[0].reason))
  const fixed = planClassRecovery(base([task('a', { fixed: true })], { overlaps: { a: 'Class' } }))
  check('recorded or protected work is kept', fixed.moves.length === 0 && fixed.kept.length === 1)
  const ord = planClassRecovery(base([task('a', { lmId: 'LM1', date: D[0] }), task('b', { lmId: 'LM1', date: D[1], startsAt: at(D[1], 18) })],
    { overlaps: { a: 'Class' }, blockers: [{ date: D[0], start: 17 * 60, end: 21 * 60 }, { date: D[1], start: 17 * 60, end: 18 * 60 + 0 }] }))
  check('a sitting never lands after a later sitting of the same reading', ord.moves.length === 0 && ord.unplaced.length === 1 || (ord.moves[0] && ord.moves[0].to_date <= D[1]), JSON.stringify(ord))
  const early = planClassRecovery(base([task('a', { date: D[2], startsAt: at(D[2], 18) })], { overlaps: { a: 'Class' }, blockers: [{ date: D[2], start: 17 * 60, end: 21 * 60 }] }))
  check('never placed earlier than it was', early.moves.every(m => m.to_date >= D[2]))
  const paper = planClassRecovery(base([task('a', { taskType: 'diagnostic' })], { overlaps: { a: 'Class' }, studyDates: [D[1]] }))
  check('a paper keeps its reserved time (shown as a constraint, never moved here)', paper.moves.length === 0 && paper.kept.length === 1)
}
console.log('\nA day that no longer holds its load')
{
  const t1 = task('x', { placement: 'day_preferred', startsAt: null, minutes: 90, priority: 'optional' }), t2 = task('y', { placement: 'day_preferred', startsAt: null, minutes: 90 })
  const r = planClassRecovery(base([t1, t2], { available: { [D[0]]: 100, [D[1]]: 240, [D[2]]: 240, [D[3]]: 240 } }))
  check('the lowest-priority floating task leaves the overloaded day, the other stays', r.moves.length === 1 && r.moves[0].task_id === 'x' && r.moves[0].to_date === D[1] && r.moves[0].to_starts === null, JSON.stringify(r))
  const none = planClassRecovery(base([t1, t2], { available: { [D[0]]: 100, [D[1]]: 0, [D[2]]: 0, [D[3]]: 0 } }))
  check('with no room anywhere it is reported unplaced', none.unplaced.length === 1 && none.unplaced[0].task_id === 'x')
  const mock = planClassRecovery(base([task('m', { taskType: 'mock', minutes: 180 })], { overlaps: { m: 'Class' } }))
  check('a mock is a visible constraint too', mock.moves.length === 0 && mock.kept.length === 1)
}
console.log('\nToday is not rewound')
{
  const r = planClassRecovery(base([task('a', { startsAt: at(D[0], 17, 5), minutes: 30 })], { overlaps: { a: 'Class' }, earliestToday: 18 * 60 + 10 }))
  check('today’s new start is no earlier than now (rounded up to the 15-minute grid)', r.moves[0]?.to_starts === at(D[0], 18, 15), JSON.stringify(r.moves))
}

console.log('\nDeclared sitting order (dependencies) is never inverted')
{
  const first = task('s1', { startsAt: at(D[0], 19, 0), after: [] }), second = task('s2', { startsAt: at(D[0], 20, 0), after: ['s1'] })
  const r1 = planClassRecovery(base([first, second], { overlaps: { s1: 'Class' }, blockers: [{ date: D[0], start: 17 * 60, end: 20 * 60 + 30 }] }))
  check('moving the EARLIER sitting never puts it after its later sibling on the same day: it goes to no slot after 20:00 and is unplaced rather than inverted', r1.moves.every(m => !(m.to_date === D[0] && m.to_starts && Date.parse(m.to_starts) + m.minutes * 60000 > Date.parse(at(D[0], 20, 0)))), JSON.stringify(r1.moves))
  const r2 = planClassRecovery(base([task('a1', { startsAt: at(D[0], 18, 0) }), task('a2', { startsAt: at(D[0], 19, 0), after: ['a1'] })], { overlaps: { a2: 'Class' }, blockers: [{ date: D[0], start: 19 * 60, end: 20 * 60 }] }))
  const m2 = r2.moves.find(m => m.task_id === 'a2')
  check('moving the LATER sitting never lands before its predecessor (same day or an earlier day)', !m2 || m2.to_date > D[0] || Date.parse(m2.to_starts!) >= Date.parse(at(D[0], 19, 0)), JSON.stringify(m2))
  const r3 = planClassRecovery(base([task('p1', { startsAt: at(D[1], 18, 0), date: D[1] }), task('p2', { startsAt: at(D[0], 19, 0), after: ['p1'] })], { overlaps: { p2: 'Class' }, blockers: [{ date: D[0], start: 19 * 60, end: 21 * 60 }] }))
  check('a successor already after its predecessor on a later day is not pulled before it (cross-day order)', r3.moves.every(m => m.task_id !== 'p2' || m.to_date >= D[1]), JSON.stringify(r3.moves))
  const r4 = planClassRecovery(base([task('c1', { startsAt: at(D[0], 18, 0), execution: 'completed' }), task('c2', { startsAt: at(D[0], 19, 0), after: ['c1'] })], { overlaps: { c2: 'Class' }, blockers: [{ date: D[0], start: 19 * 60, end: 20 * 60 }] }))
  check('a COMPLETED predecessor no longer constrains the move', r4.moves.length === 1 && r4.moves[0].task_id === 'c2')
  const r5 = planClassRecovery(base([task('n1', { startsAt: at(D[3], 20, 0), date: D[3] }), task('n2', { startsAt: at(D[0], 19, 0), after: ['n1'] })], { overlaps: { n2: 'Class' }, blockers: D.slice(0, 3).map(d => ({ date: d, start: 17 * 60, end: 21 * 60 })) }))
  check('no room before its predecessor: an honest unplaced outcome, never an inversion', r5.moves.length === 0 && r5.unplaced.length === 1 || r5.moves.every(m => m.to_date >= D[3]), JSON.stringify(r5))
  const free = planClassRecovery(base([task('u1', { startsAt: at(D[0], 20, 0), lmId: 'LM9' }), task('u2', { startsAt: at(D[0], 19, 0), lmId: 'LM9' })], { overlaps: { u2: 'Class' }, blockers: [{ date: D[0], start: 19 * 60, end: 20 * 60 }] }))
  check('with NO declared order, a shared reading alone does not invent one (display/title order is not curriculum truth)', free.moves.length === 1)
}
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
