/**
 * Pure regression: completed revision -> revisionary paper. The rule chain, with no database:
 *   declared coverage creates no scope; a scheduled revision is not a completed one; a completed revision with explicit
 *   curriculum scope is eligible and revisionary; new learning is diagnostic; both is mixed; missed or deferred work is excluded;
 *   a continuation does not bring back last week's confirmed scope. Item eligibility and scoring are not touched.
 */
import { buildCompletedScope, type BlockRow, type OutcomeRef, type ReadingRef, type ScopeInput } from '../src/lib/tests/completedScope'
import { allocateWeighted, type SubjectWeight } from '../src/lib/tests/weightedBlueprint'
import { choosePaperKind, PAPER_SCOPE_KINDS } from '../src/lib/tests/paperPreview'

let passed = 0, failed = 0
const check = (n: string, ok: boolean, d = '') => { ok ? (passed++, console.log(`  ✓ ${n}`)) : (failed++, console.log(`  ✗ ${n}${d ? ` — ${d}` : ''}`)) }

const subjects: SubjectWeight[] = [{ id: 'fsa', min: 11, max: 14 }, { id: 'eq', min: 11, max: 14 }]
const defs: [string, string, number][] = [['r1', 'fsa', 40], ['r2', 'fsa', 30], ['r3', 'eq', 30]]
const readings = new Map<string, ReadingRef>(defs.map(([id, s, p], i) => [id, { id, subjectId: s, readingNo: i + 1, title: id, pageCount: p, structurePending: false }]))
const outcomes = new Map<string, OutcomeRef>()
for (const [rid, sid] of defs.map(d => [d[0], d[1]])) for (const c of 'abcd') outcomes.set(`${rid}-${c}`, { id: `${rid}-${c}`, readingId: rid, subjectId: sid, code: c, title: `${rid}${c}` })
const blk = (id: string, o: Partial<BlockRow> = {}): BlockRow => ({ id, title: id, taskType: 'review', execution: 'completed', localDate: '2026-11-03', outcomeId: null, readingId: 'r1', origin: 'planner', ...o })
const scope = (blocks: BlockRow[], extra: Partial<ScopeInput> = {}) => buildCompletedScope({
  cycle: { id: 'c2', startsAt: '2026-11-02', endsAt: '2026-11-08' }, today: '2026-11-06', blocks, confirmations: new Map(), classItems: [],
  outcomes, readings, priorOutcomes: new Set(), priorReadings: new Set(), ...extra,
})
const paperOf = (s: ReturnType<typeof scope>) => choosePaperKind(s.totals.newOutcomes, s.totals.revisionOutcomes)

console.log('\nDeclaring prior coverage')
{
  // The student said "I covered reading 1" in onboarding: it is prior history for new/revision, never scope on its own.
  const s = scope([], { priorReadings: new Set(['r1']) })
  check('declared coverage alone creates no test scope this week', s.totals.outcomes === 0 && s.targets.length === 0)
  check('and no unresolved work either (nothing was done)', s.unresolved.length === 0 && s.excluded.length === 0)
}

console.log('\nScheduling revision is not completing it')
{
  const future = scope([blk('rev', { execution: 'not_started', localDate: '2026-11-07', outcomeId: 'r1-a' })], { priorReadings: new Set(['r1']) })
  check('a revision block still ahead is not scope', future.targets.length === 0 && future.excluded.length === 0)
  const overdue = scope([blk('rev', { execution: 'not_started', localDate: '2026-11-03', outcomeId: 'r1-a' })], { priorReadings: new Set(['r1']) })
  check('an overdue, undone revision is excluded as not completed, never scope', overdue.targets.length === 0 && overdue.excluded.some(e => e.reason === 'not_completed'))
  const started = scope([blk('rev', { execution: 'in_progress', outcomeId: 'r1-a', localDate: '2026-11-03' })])
  check('in progress is not completed', started.targets.length === 0)
}

console.log('\nCompleting revision with explicit curriculum scope')
{
  const direct = scope([blk('rev', { outcomeId: 'r1-a' })], { priorReadings: new Set(['r1']) })
  check('a completed revision block tied to an outcome is scope', direct.targets.map(t => t.outcomeId).join() === 'r1-a')
  check('it is revision, whatever the history', direct.targets[0].kind === 'revision')
  check('the paper it produces is revisionary', paperOf(direct) === 'revisionary')
  const bp = allocateWeighted({ scope: direct, subjects, kinds: PAPER_SCOPE_KINDS[paperOf(direct)] })
  check('and a revisionary blueprint actually carries it (questions allocated, no new-learning section)', bp.totalQuestions > 0 && bp.perOutcome.every(o => o.kind === 'revision'))
  const readingLevel = scope([blk('rev')], { priorReadings: new Set(['r1']) })
  check('a reading-level revision is unresolved until its scope is confirmed', readingLevel.targets.length === 0 && readingLevel.unresolved.some(u => u.blockId === 'rev'))
  const confirmed = scope([blk('rev')], { priorReadings: new Set(['r1']), confirmations: new Map([['rev', ['r1-a', 'r1-b']]]) })
  check('confirming the outcomes makes them eligible, as revision', confirmed.targets.length === 2 && confirmed.targets.every(t => t.kind === 'revision') && paperOf(confirmed) === 'revisionary')
  const partial = scope([blk('rev', { execution: 'partial' })], { confirmations: new Map([['rev', ['r1-c']]]) })
  check('a partly completed revision counts at half weight, only for what was confirmed', partial.targets.length === 1 && partial.targets[0].weight === 0.5)
}

console.log('\nNew learning, and a mixture')
{
  const fresh = scope([blk('study', { taskType: 'study', outcomeId: 'r3-a', readingId: 'r3' })])
  check('new completed learning is diagnostic scope', fresh.targets[0].kind === 'new' && paperOf(fresh) === 'diagnostic')
  const mix = scope([blk('study', { taskType: 'study', outcomeId: 'r3-a', readingId: 'r3' }), blk('rev', { outcomeId: 'r1-a' })], { priorReadings: new Set(['r1']) })
  check('both together produce the existing mixed paper', paperOf(mix) === 'mixed')
  const bp = allocateWeighted({ scope: mix, subjects, kinds: PAPER_SCOPE_KINDS.mixed })
  check('with separate new and revision sections', bp.sections.some(s => s.kind === 'new') && bp.sections.some(s => s.kind === 'revision'))
}

console.log('\nMissed and deferred work')
{
  const s = scope([blk('a', { execution: 'skipped', outcomeId: 'r1-a' }), blk('b', { execution: 'deferred', outcomeId: 'r1-b' })])
  check('neither enters scope', s.targets.length === 0)
  check('each is excluded for its own reason', s.excluded.some(e => e.reason === 'missed') && s.excluded.some(e => e.reason === 'postponed'))
}

console.log('\nContinuations')
{
  // Last week: r1-a was revised and confirmed (that is prior history now). This week only a continuation exists, not yet done.
  const lastWeek = new Set(['r1-a'])
  const pending = scope([blk('cont', { execution: 'not_started', localDate: '2026-11-07', outcomeId: 'r1-a' })], { priorOutcomes: lastWeek })
  check('an unfinished continuation does not bring last week’s confirmed scope back', pending.targets.length === 0)
  const done = scope([blk('cont', { taskType: 'study', outcomeId: 'r1-a' })], { priorOutcomes: lastWeek })
  check('finishing it this week is revision of something already covered, not new learning', done.targets.length === 1 && done.targets[0].kind === 'revision')
  check('last week’s own blocks are not part of this cycle’s input, so nothing of theirs reappears', scope([]).targets.length === 0)
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
