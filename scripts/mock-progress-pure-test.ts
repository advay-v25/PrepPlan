import assert from 'node:assert/strict'
import { recoveryItemState, type Occurrence } from '../src/lib/mocks/recoveryProgress'
import { taskTimes, type TimeEvent } from '../src/lib/state/reportedTime'

let passed = 0
const check = (name: string, work: () => void) => { work(); passed++; console.log(`  ✓ ${name}`) }
const row = (id: string, execution: string, minutes = 15, extra: Partial<Occurrence> = {}): Occurrence => ({ id, execution, duration_minutes: minutes, cycle_id: 'closed', source_key: 'pacing:1', cancelled_at: null, continued_from_task_id: null, local_date: '2026-11-16', title: id, outcome_id: null, lm_id: null, ...extra })
const event = (id: string, task: string, type: string, minutes: number | null, payload = {}): TimeEvent => ({ id, task_id: task, event_type: type, actual_duration_minutes: minutes, created_at: id, payload })
const state = (rows: Occurrence[], events: TimeEvent[], minutes = 30) => recoveryItemState({ key: 'pacing', kind: 'pacing', minutes }, rows, taskTimes(events), 'current')
const split = [row('a', 'completed'), row('b', 'partial')]
const reports = [event('1', 'a', 'completed', 15), event('2', 'b', 'partial', 5)]

check('every split must finish', () => { assert.equal(state(split, reports).status, 'unfinished'); assert.equal(state(split, reports).remaining, 10) })
check('Undo removes time before estimating the remainder', () => { const s = state([split[0], { ...split[1], execution: 'not_started' }], [...reports, event('3', 'b', 'undone', null, { undid_event_id: '2', undid: 'partial' })]); assert.equal(s.reported, 15); assert.equal(s.remaining, 15) })
check('undoing Undo restores one report', () => { const s = state(split, [...reports, event('3', 'b', 'undone', null, { undid_event_id: '2', undid: 'partial' }), event('4', 'b', 'undone', null, { undid: 'undone' })]); assert.equal(s.reported, 20); assert.equal(s.remaining, 10) })
check('reaching the time estimate does not finish work', () => assert.equal(state([row('a', 'partial', 30)], [event('1', 'a', 'partial', 30)]).status, 'needs_review'))
check('exceeding the time estimate does not finish work', () => assert.equal(state([row('a', 'partial', 30)], [event('1', 'a', 'partial', 45)]).status, 'needs_review'))
check('unknown time does not become zero', () => assert.equal(state([row('a', 'partial', 30)], [event('1', 'a', 'partial', null)]).status, 'needs_review'))
check('small remainders stay exact', () => { assert.equal(state([row('a', 'partial', 30)], [event('1', 'a', 'partial', 23)]).remaining, 7); assert.equal(state([row('a', 'partial', 25)], [event('1', 'a', 'partial', 20)], 25).remaining, 5) })
check('a remainder below the task floor needs a decision, not invented minutes', () => assert.equal(state([row('a', 'partial', 25)], [event('1', 'a', 'partial', 23)], 25).status, 'needs_review'))
check('all completed splits are complete even if actual time differs', () => assert.equal(state([row('a', 'completed'), row('b', 'completed')], [event('1', 'a', 'completed', 10), event('2', 'b', 'completed', null)]).status, 'completed'))
check('a 45/20/25 continuation counts once', () => { const s = state([row('a', 'partial', 45), row('b', 'completed', 25, { continued_from_task_id: 'a', cycle_id: 'current' })], [event('1', 'a', 'partial', 20), event('2', 'b', 'completed', 25)], 45); assert.equal(s.allocated, 45); assert.equal(s.reported, 45); assert.equal(s.status, 'completed') })
check('a current partial continuation remains actionable', () => assert.equal(state([row('a', 'partial', 45), row('b', 'partial', 25, { continued_from_task_id: 'a', cycle_id: 'current' })], [event('1', 'a', 'partial', 20)], 45).status, 'continues'))
check('cancelling a continuation does not resurrect its full predecessor estimate', () => { const s = state([row('a', 'partial', 45), row('b', 'cancelled', 25, { continued_from_task_id: 'a', cancelled_at: 'now' })], [event('1', 'a', 'partial', 20)], 45); assert.equal(s.remaining, 25); assert.equal(s.reported, 20) })
check('cancelled progress remains actual history after replacement', () => { const s = state([row('a', 'cancelled', 30, { cancelled_at: 'now' }), row('b', 'completed', 20, { source_key: 'pacing:2' })], [event('1', 'a', 'partial', 10), event('2', 'b', 'completed', 20)]); assert.equal(s.status, 'completed'); assert.equal(s.reported, 30); assert.equal(s.allocated, 30) })
check('an unallocated choice retains its full estimate', () => { const s = state([], []); assert.equal(s.status, 'none'); assert.equal(s.remaining, 30) })
console.log(`\n${passed} passed, 0 failed`)
