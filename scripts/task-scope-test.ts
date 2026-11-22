import { test } from 'node:test'
import assert from 'node:assert/strict'
import { summarizeScopeGroups, type ScopePart } from '../src/lib/planning/taskScope'
import { buildCompletedScope, type ScopeInput, type BlockRow } from '../src/lib/tests/completedScope'

const group = [{ id: 'g', expected: 2 }]
const part = (execution: string, extra: Partial<ScopePart> = {}): ScopePart => ({ groupId: 'g', execution, cancelled: false, cycleId: 'current', ...extra })
const block = (id: string, extra: Partial<BlockRow> = {}): BlockRow => ({ id, title: id, taskType: 'study', execution: 'completed', localDate: '2026-10-28', outcomeId: 'los', readingId: 'reading', origin: 'student', ...extra })
const input = (blocks: BlockRow[], confirmations = new Map<string, string[]>()): ScopeInput => ({
  cycle: { id: 'current', startsAt: '2026-10-26', endsAt: '2026-11-01' }, today: '2026-10-28', blocks, confirmations, classItems: [],
  outcomes: new Map([['los', { id: 'los', readingId: 'reading', subjectId: 'fsa', code: 'a', title: 'Outcome' }]]),
  readings: new Map([['reading', { id: 'reading', subjectId: 'fsa', readingNo: 1, title: 'Reading', pageCount: 20, structurePending: false }]]),
  priorOutcomes: new Set(), priorReadings: new Set(),
})

test('one completed sitting never completes the shared scope', () => {
  const g = summarizeScopeGroups(group, [part('completed'), part('not_started')]).get('g')!
  assert.equal(g.completed, 1); assert.equal(g.complete, false)
  const scope = buildCompletedScope(input([block('first', { scopePending: !g.complete })]))
  assert.equal(scope.targets.length, 0); assert.equal(scope.unresolved[0].reason, 'split')
})

test('both finished sittings produce ONE full outcome, not two topics', () => {
  const g = summarizeScopeGroups(group, [part('completed'), part('completed')]).get('g')!
  assert.equal(g.complete, true)
  const scope = buildCompletedScope(input([block('first', { scopePending: !g.complete }), block('second', { scopePending: !g.complete })]))
  assert.equal(scope.targets.length, 1); assert.equal(scope.targets[0].weight, 1); assert.equal(scope.targets[0].sources.length, 2)
})

test('partial LOS work requires explicit confirmation even with a direct mapping', () => {
  const b = block('partial', { execution: 'partial', readingId: null })
  const scope = buildCompletedScope(input([b]))
  assert.equal(scope.targets.length, 0); assert.equal(scope.unresolved[0].readingId, 'reading')
  const confirmed = buildCompletedScope(input([b], new Map([['partial', ['los']]])))
  assert.equal(confirmed.targets.length, 1); assert.equal(confirmed.targets[0].weight, 0.5)
})

test('missing, cancelled, deferred and partially done sittings cannot imply full coverage', () => {
  for (const parts of [[part('completed')], [part('completed'), part('completed', { cancelled: true })], [part('completed'), part('partial')], [part('completed'), part('deferred')]]) {
    assert.equal(summarizeScopeGroups(group, parts).get('g')!.complete, false)
  }
})

test('repeated splits preserve a three-part scope, including across weeks', () => {
  const g = summarizeScopeGroups([{ id: 'g', expected: 3 }], [part('completed', { cycleId: 'previous' }), part('completed'), part('not_started')]).get('g')!
  assert.equal(g.complete, false); assert.ok(g.cycles.includes('previous'))
  const complete = summarizeScopeGroups([{ id: 'g', expected: 3 }], [part('completed', { cycleId: 'previous' }), part('completed'), part('completed')]).get('g')!
  assert.equal(complete.complete, true); assert.ok(complete.cycles.includes('current'))
})
