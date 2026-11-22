import { test } from 'node:test'
import assert from 'node:assert/strict'
import { confirmedActivity, type StudyActivityBlock } from '../src/lib/curriculum/studyActivity'
import { assembleEligiblePool } from '../src/lib/tests/assembly'
import type { PoolItem } from '../src/lib/tests/itemPool'
import { filterEligiblePool } from '../src/lib/tests/itemPool'
import { readAll } from '../src/lib/supabase/readAll'
import { classifyLos, deriveProgress } from '../src/lib/curriculum/losTracker'
import { repairDates } from '../src/lib/planning/repairDates'
import { activityCoverage } from '../src/lib/curriculum/activityCoverage'
import { learningLogSchema,recordLearning } from '../src/lib/learning/log'

const block = (patch: Partial<StudyActivityBlock> = {}): StudyActivityBlock => ({
  id: 'sitting', lm_id: 'r1', outcome_id: null, execution: 'completed', task_type: 'study',
  cancelled_at: null, local_date: '2026-10-26',
  cycle_id: 'week1', title: 'A reading sitting', revision: 1, scope_group_id: null, ...patch,
})
const outcomes = new Map([['a', 'r1'], ['b', 'r1'], ['c', 'r2']])
function activity(b: StudyActivityBlock[], ids: string[] = [], pending = new Set<string>(), times = new Map<string, string>()) {
  return confirmedActivity(b, new Map([['sitting', ids]]), outcomes, pending, times)
}

test('a finished reading-level sitting does not silently complete any outcome', () => assert.deepEqual(activity([block()]), []))
test('exact confirmed subset is shared activity, foreign and duplicate outcomes cannot leak', () => {
  assert.deepEqual(activity([block()], ['a', 'a', 'c', 'missing']).map(o => o.outcomeId), ['a'])
})
test('direct completed outcome counts; planned work does not', () => {
  assert.deepEqual(activity([block({ outcome_id: 'a' })]).map(o => o.outcomeId), ['a'])
  assert.deepEqual(activity([block({ outcome_id: 'a', execution: 'not_started' })], ['a']), [])
})
test('partial work needs an explicit confirmation, even with a direct mapping', () => {
  assert.deepEqual(activity([block({ outcome_id: 'a', execution: 'partial' })]), [])
  assert.deepEqual(activity([block({ outcome_id: 'a', execution: 'partial' })], ['a', 'b']).map(o => o.outcomeId), ['a'])
})
test('split scope is not inferred complete from the first sitting', () => {
  const sitting = block({ outcome_id: 'a', scope_group_id: 'split1' })
  assert.deepEqual(activity([sitting], [], new Set(['split1'])), [])
  assert.equal(activity([sitting], ['a'], new Set(['split1'])).length, 1)
  assert.equal(activity([sitting]).length, 1)
})
test('reopened or cancelled work loses its activity projection without deleting history', () => {
  for (const execution of ['not_started', 'in_progress', 'skipped', 'deferred', 'cancelled']) {
    assert.deepEqual(activity([block({ execution })], ['a']), [])
  }
  assert.deepEqual(activity([block({ cancelled_at: '2026-10-27T00:00:00Z' })], ['a']), [])
})
test('non-study commitments cannot manufacture curriculum activity', () => {
  assert.deepEqual(activity([block({ task_type: 'diagnostic' })], ['a']), [])
})
test('moving a completed task does not make it work performed after a later test', () => {
  const recorded = '2026-10-26T09:00:00Z'
  assert.equal(activity([block({ local_date: '2026-10-29' })], ['a'], new Set(), new Map([['sitting', recorded]]))[0].at, recorded)
})
test('activity alone has no sample, confidence or mastery evidence', () => {
  const observation = activity([block()], ['a'])
  const classification = classifyLos(null, new Date('2026-10-29T00:00:00Z'))
  assert.equal(classification.band, 'untested')
  assert.equal(deriveProgress({ band: classification.band, hasOpenRepair: false, hasScheduledWork: false,
    workCompleted: observation.length > 0, nextRecheckDueAt: null }, new Date('2026-10-29')), 'in_progress')
  assert.equal('is_correct' in observation[0], false)
})

const item = (id: string, outcome: string | null = 'a', reading = 'r1'): PoolItem => ({
  id, lm_id: reading, outcome_id: outcome, concept_id: 'active-concept', intended_difficulty: 'medium',
  cognition: 'apply', item_form: 'scenario', key_index: 0,
})
const blueprint = { perReading: [{ readingId: 'r1', subjectId: 'fsa', questions: 5, pages: 20 }],
  perOutcome: [{ readingId: 'r1', subjectId: 'fsa', outcomeId: 'a', questions: 5, kind: 'new' as const }] }

test('pool rejects seen items, inactive concepts and inconsistent reading/concept/outcome tags', () => {
  const rows = [item('valid'), item('seen'), { ...item('inactive'), concept_id: 'retired' },
    item('wrong-reading', 'a', 'r2'), item('wrong-outcome', 'b'), item('unmapped', null), { ...item('no-concept'), concept_id: null }]
  assert.deepEqual(filterEligiblePool(rows, new Set(['seen']), new Set(['active-concept']),
    new Map([['a', 'r1'], ['b', 'r1']]), new Set(['active-concept:a'])).map(i => i.id), ['valid'])
})

test('a bank shortage never fills with uncompleted, unmapped or other-reading questions', () => {
  const result = assembleEligiblePool(blueprint, [item('valid'), item('uncompleted', 'b'), item('unmapped', null), item('other', 'a', 'r2')], () => 0.5)
  assert.deepEqual(result.items.map(i => i.itemId), ['valid'])
  assert.deepEqual(result.shortfalls, [{ readingId: 'r1', wanted: 5, delivered: 1 }])
})
test('fallback can only redistribute among outcomes explicitly in the reviewed blueprint', () => {
  const bp = { ...blueprint, perOutcome: [
    { ...blueprint.perOutcome[0], questions: 2 }, { ...blueprint.perOutcome[0], outcomeId: 'b', questions: 3 },
  ] }
  const result = assembleEligiblePool(bp, Array.from({ length: 7 }, (_, i) => item(String(i), 'a')), () => 0.5)
  assert.equal(result.delivered, 5)
  assert.equal(new Set(result.items.map(i => i.itemId)).size, 5)
  assert.equal(result.items.filter(i => i.requestedOutcomeId === null).length, 3)
  assert.equal(result.items.every(i => i.outcomeId === 'a'), true)
})
test('one reading cannot consume another reading allocation; item ids are never repeated', () => {
  const bp = { ...blueprint, perReading: [...blueprint.perReading, { ...blueprint.perReading[0], readingId: 'r2', questions: 3 }] }
  const result = assembleEligiblePool(bp, Array.from({ length: 9 }, (_, i) => item(String(i))), () => 0.5)
  assert.equal(result.delivered, 5)
  assert.equal(result.perReading.find(r => r.readingId === 'r2')?.delivered, 0)
})
test('paper ceiling and malformed allocations fail before selection', () => {
  for (const questions of [91, -1, 2.5]) assert.throws(() => assembleEligiblePool({ ...blueprint, perReading: [{ ...blueprint.perReading[0], questions }] }, []))
  assert.throws(() => assembleEligiblePool({ ...blueprint, perReading: [...blueprint.perReading, ...blueprint.perReading] }, []))
})
test('empty scope produces an empty paper, without consuming bank questions', () => {
  assert.equal(assembleEligiblePool({ perReading: [], perOutcome: [] }, [item('one')]).delivered, 0)
})
test('pagination reads well past the default 1000-row history limit', async () => {
  const source = Array.from({ length: 1253 }, (_, i) => ({ id: i }))
  const calls: number[] = []
  const loaded = await readAll(async (a, z) => { calls.push(a); return { data: source.slice(a, z + 1), error: null } })
  assert.equal(loaded.length, 1253); assert.deepEqual(calls, [0, 500, 1000])
})
test('a failed history page fails the read rather than returning fabricated incomplete truth', async () => {
  await assert.rejects(() => readAll(async a => a === 0 ? { data: Array(500).fill(1), error: null }
    : { data: null, error: { message: 'unavailable' } }), /unavailable/)
})

test('a Thursday paper cannot claim its Monday re-check fits inside the closing week', () => {
  const plan = repairDates('2026-10-30', '2026-10-29', 2, { start: '2026-10-26', end: '2026-11-01' })
  assert.equal(plan.recheck, '2026-11-02'); assert.equal(plan.requiresWeeklyReview, true)
})
test('re-check follows the last repair rather than running before later repairs', () => {
  const plan = repairDates('2026-11-02', '2026-11-01', 10, { start: '2026-11-02', end: '2026-11-08' })
  assert.equal(plan.repairs.at(-1), '2026-11-06'); assert.equal(plan.recheck, '2026-11-09'); assert.equal(plan.requiresWeeklyReview, true)
})
test('an old result never proposes past days; a missing active cycle requires review', () => {
  const plan = repairDates('2026-09-01', '2026-10-29', 1, null)
  assert.equal(plan.start, '2026-10-29'); assert.equal(plan.requiresWeeklyReview, true)
  assert.equal(repairDates('2026-10-27', '2026-10-26', 2, { start: '2026-10-26', end: '2026-11-01' }).requiresWeeklyReview, false)
})

test('subset activity does not finish a reading; only all full outcomes do',()=>{
 const rows=[block()]
 const readingOf=new Map([['a','r1'],['b','r1']])
 const a=[{blockId:'sitting',outcomeId:'a',at:null}]
 assert.equal(activityCoverage(rows,a,readingOf,new Set()).has('r1'),false)
 assert.equal(activityCoverage(rows,[...a,{blockId:'sitting',outcomeId:'b',at:null}],readingOf,new Set()).get('r1'),'studied')
})
test('class coverage is exposure; partial, unfinished split and removed work cannot complete a reading',()=>{
 const readingOf=new Map([['a','r1']]),observed=[{blockId:'sitting',outcomeId:'a',at:null}]
 assert.equal(activityCoverage([block({activityKind:'class'})],observed,readingOf,new Set()).get('r1'),'taught')
 for(const b of [block({execution:'partial'}),block({cancelled_at:'2026-10-29'}),block({scope_group_id:'pending'})])assert.equal(activityCoverage([b],observed,readingOf,new Set(['pending'])).has('r1'),false)
})
test('reported minutes are optional and exact, including short or long real sittings',()=>{
 const base={activity_type:'independent_study',reading_id:'r1',outcome_ids:['a'],idempotency_key:'a-valid-key'}
 assert.equal(learningLogSchema.safeParse(base).success,true)
 for(const duration_minutes of [null,1,45,720])assert.equal(learningLogSchema.safeParse({...base,duration_minutes}).success,true)
 for(const duration_minutes of [0,-1,721,1.5,'45'])assert.equal(learningLogSchema.safeParse({...base,duration_minutes}).success,false)
})
test('shared adapter deduplicates targets without dividing or inventing time',async()=>{
 let sent:any
 const db={rpc:async(_:string,args:any)=>{sent=args;return{data:{ok:true,taskId:'one'},error:null}}} as any
 await recordLearning(db,{activity_type:'independent_study',reading_id:'r1',outcome_ids:['b','a','a'],duration_minutes:45,idempotency_key:'same-valid-key'})
 assert.deepEqual(sent.p_outcome_ids,['a','b']);assert.equal(sent.p_duration_minutes,45)
 await recordLearning(db,{activity_type:'independent_study',reading_id:'r1',outcome_ids:['a'],idempotency_key:'another-valid-key'})
 assert.equal(sent.p_duration_minutes,null)
})
test('lost response and changed-key conflicts remain explicit, retryable outcomes',async()=>{
 const input={activity_type:'independent_study' as const,reading_id:'r1',outcome_ids:['a'],idempotency_key:'same-valid-key'}
 await assert.rejects(()=>recordLearning({rpc:async()=>({data:null,error:{code:'connection'}})} as any,input),e=>(e as any).status===503)
 await assert.rejects(()=>recordLearning({rpc:async()=>({data:{code:'IDEMPOTENCY_CONFLICT'},error:null})} as any,input),e=>(e as any).status===409)
})
