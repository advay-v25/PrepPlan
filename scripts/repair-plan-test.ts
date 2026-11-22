import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planRepairFollowUp, splitIntoSittings, type PlanInput, type PlanThread } from '../src/lib/repairs/plan'
import { questionsPerRepairConcept, repairCheckAvailableDate } from '../src/lib/tests/repairCheck'

test('a single-concept check can meet the five-question minimum without borrowing another concept', () => {
  assert.equal(questionsPerRepairConcept(1), 5)
  assert.equal(questionsPerRepairConcept(2), 3)
  assert.equal(questionsPerRepairConcept(30), 3)
})
test('a delayed repair resets spacing from its actual local completion, even if the check is moved earlier', () => {
  assert.equal(repairCheckAvailableDate('2026-10-29', ['2026-10-30'], '2026-10-30T20:00:00Z', 'Asia/Kolkata'), '2026-11-03')
  assert.equal(repairCheckAvailableDate('2026-11-05', [], '2026-10-30T20:00:00Z', 'Asia/Kolkata'), '2026-11-05')
})

const week = ['2031-03-03', '2031-03-04', '2031-03-05', '2031-03-06', '2031-03-07', '2031-03-08', '2031-03-09']
const cap = (n: number) => Object.fromEntries(week.map(d => [d, n]))
let n = 0
const th = (id: string, extra: Partial<PlanThread> = {}): PlanThread => ({ id, conceptId: `c-${id}`, conceptName: `Concept ${id}`, severity: 'needs_repair', occurrence: 1, scopeNotes: null, takenOn: '2031-03-02', ...extra })
const run = (threads: PlanThread[], o: Partial<PlanInput> = {}) => planRepairFollowUp({
  attemptId: 'a', today: '2031-03-03', cycle: { start: week[0], end: week[6] }, weekDates: week, studyDates: week.slice(0, 6), capacity: cap(120), maxSittingMinutes: 90,
  threads, newId: () => `task-${++n}`, ...o })

test('sittings respect the limit, stay on the 5-minute grid and never go under 15', () => {
  assert.deepEqual(splitIntoSittings(30, null), [30]); assert.deepEqual(splitIntoSittings(60, 45), [30, 30]); assert.deepEqual(splitIntoSittings(45, 45), [45])
  for (const [t, m] of [[60, 25], [45, 20], [100, 30]] as const) { const s = splitIntoSittings(t, m); assert.equal(s.reduce((a, b) => a + b), t); assert.ok(s.every(x => x >= 15 && x % 5 === 0)) }
})
test('one repair is placed on a real day, with a check three or more days after the last repair', () => {
  const r = run([th('a')])
  assert.equal(r.tasks.length, 1); assert.equal(r.tasks[0].local_date, '2031-03-03'); assert.equal(r.check!.local_date, '2031-03-06')
  assert.deepEqual(r.check!.threadIds, ['a']); assert.equal(r.waitingChecks.length, 0)
})
test('the check follows the LAST portion of the LAST repair, not the first', () => {
  const r = run([th('a', { occurrence: 3 })], { maxSittingMinutes: 30 })            // 60 min -> two 30-minute sittings
  assert.equal(r.tasks.length, 2)
  assert.ok(r.check!.local_date >= '2031-03-06')
})
test('a repair that cannot fit stays unplaced with a reason and gets no check', () => {
  const r = run([th('a')], { capacity: cap(10) })
  assert.equal(r.tasks.length, 0); assert.equal(r.check, null); assert.match(r.unplaced[0].reason, /room/)
})
test('a repair is placed whole: if one portion cannot fit, none is placed', () => {
  const r = run([th('a', { occurrence: 3 })], { maxSittingMinutes: 30, capacity: { ...cap(0), '2031-03-03': 30 } })
  assert.equal(r.tasks.length, 0); assert.equal(r.unplaced.length, 1)
})
test('no day is filled past its free time; work already planned counts', () => {
  const r = run([th('a'), th('b', { occurrence: 2 })], { capacity: cap(50) })
  const perDay: Record<string, number> = {}; for (const t of r.tasks) perDay[t.local_date] = (perDay[t.local_date] ?? 0) + t.duration_minutes
  assert.ok(Object.values(perDay).every(m => m <= 50))
})
test('a check that lands after the open week becomes an explicit waiting obligation linked to its repairs', () => {
  const r = run([th('a')], { today: '2031-03-07', studyDates: ['2031-03-07', '2031-03-08'] })
  assert.equal(r.check, null); assert.deepEqual(r.waitingChecks[0].threadIds, ['a']); assert.equal(r.waitingChecks[0].earliestDate, '2031-03-10')
})
test('days before today are never used', () => {
  assert.ok(run([th('a')], { today: '2031-03-05' }).tasks.every(t => t.local_date >= '2031-03-05'))
})
test('"keep for later" leaves a repair out of the proposal entirely', () => {
  const r = run([th('a'), th('b')], { keepForLater: ['b'] })
  assert.deepEqual(r.threadIds, ['a']); assert.ok(r.tasks.every(t => t.repair_thread_id === 'a'))
})
test('the student can choose the day, but never a check before the required gap', () => {
  const r = run([th('a')], { overrides: { 'a:0': '2031-03-05', check: '2031-03-06' } })
  assert.equal(r.tasks[0].local_date, '2031-03-05'); assert.equal(r.check!.local_date, '2031-03-08')   // 03-06 is under 3 days after 03-05: moved to the earliest valid day
})
test('a repeat miss earns a longer session than a first miss', () => {
  assert.ok(run([th('a', { occurrence: 3 })], { maxSittingMinutes: null }).tasks[0].duration_minutes > run([th('a')], { maxSittingMinutes: null }).tasks[0].duration_minutes)
})
