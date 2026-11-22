/** Phase 2 pure checks: whole/partial position, wording, week-versus-milestone explanation. */
import { computeSignals, type OutcomeState, type EvidenceStats } from '../src/lib/signals/signals'
import { coverageLine } from '../src/lib/state/progressSummary'
import { weekVsMilestone } from '../src/lib/curriculum/weekMilestone'

let passed = 0, failed = 0
const check = (n: string, ok: boolean, d = '') => { ok ? (passed++, console.log(`  ✓ ${n}`)) : (failed++, console.log(`  ✗ ${n}${d ? ` — ${d}` : ''}`)) }
const O = (id: string, o: Partial<OutcomeState> = {}): OutcomeState => ({ outcomeId: id, readingId: 'r', subjectId: 's', exposed: false, scheduled: false, tested: false, verified: false, ...o })
const E: EvidenceStats = { validEvents: 0, voidedEvents: 0, disputedEvents: 0, scoredPapers: 0, readingsTested: 0, subjectsTested: 0, latestEvidenceAt: null, high: { n: 0, correct: 0 }, low: { n: 0, correct: 0 }, medium: { n: 0, correct: 0 }, overconfidentOutcomes: 0, underconfidentOutcomes: 0, markedOutcomes: 0 }
const sig = (outcomes: OutcomeState[]) => computeSignals({ outcomes, blocks: [], evidence: E, movement: [], today: '2027-01-10', readings: { total: 102, covered: 102, partial: 0 } })

console.log('\nOne whole outcome plus one partial is NOT two confirmations\n')
{
  const s = sig([O('a', { exposed: true, whole: true }), O('b', { exposed: true, partial: true }), O('c')])
  check('position keeps them apart: 1 whole, 1 partial, exposure 2', s.position.whole === 1 && s.position.partial === 1 && s.position.exposed === 2)
  const line = coverageLine(s)
  check('the Home line says "1 whole outcome confirmed" and "1 only partly covered"', /1 whole outcome confirmed from logged work; 1 only partly covered/.test(line.detail), line.detail)
  check('it never says two are confirmed', !/2 of 3 outcomes are also confirmed/.test(line.detail) && !/2 whole/.test(line.detail))
  check('a first-pass-complete self-report stays a self-report (reading line unchanged, no chapter tests needed)', /First pass recorded complete · 102 readings/.test(line.value))
  check('an outcome that is both partly and wholly sourced counts once, as whole', sig([O('a', { exposed: true, whole: true, partial: true })]).position.partial === 0)
  const none = coverageLine(sig([O('a')]))
  check('nothing logged says so (zero is a measured value)', /nothing is confirmed from logged work yet/i.test(none.detail))
}

console.log('\nWeek versus milestone: explained from recorded provenance, never rewritten\n')
{
  const e = (topic: string, mins: number, taskType = 'study', extra: object = {}) => ({ layer: 'study' as const, execution: 'not_started', durationMinutes: mins, taskType, isTask: true, reading: { id: 'x', topicId: topic, label: 'x' }, continuation: null, ...extra })
  const ms = { topicId: 'ethics', topicName: 'Ethics' }, name = (id: string) => ({ fsa: 'Financial Statement Analysis', eq: 'Equity' }[id] ?? null)
  check('a week mostly on the milestone topic needs no note', weekVsMilestone(ms, [e('ethics', 60), e('fsa', 30)], name) === null)
  const note = weekVsMilestone(ms, [e('fsa', 90, 'class_consolidation'), e('eq', 30, 'review'), e('ethics', 30)], name)
  check('a week mainly elsewhere is named, with the roadmap kept as the longer-term order', !!note && /mainly on Financial Statement Analysis and Equity/.test(note) && /current milestone is Ethics/.test(note) && /was not changed/.test(note), String(note))
  check('only recorded provenance is cited (class follow-up, revision)', /follow-up from a class you logged/.test(note!) && /revision of earlier material/.test(note!) && !/carried over/.test(note!))
  check('carried-over work is cited only when a continuation exists', /carried over from an earlier week/.test(weekVsMilestone(ms, [e('fsa', 60, 'study', { continuation: { fromTaskId: 'q' } })], name)!))
  check('cancelled/skipped work and commitments are ignored', weekVsMilestone(ms, [e('fsa', 60, 'study', { execution: 'skipped' }), { ...e('fsa', 60), isTask: false }], name) === null)
  check('no milestone, or no topic-mapped work, says nothing', weekVsMilestone(null, [e('fsa', 60)], name) === null && weekVsMilestone(ms, [], name) === null)
}
console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed) process.exit(1)
