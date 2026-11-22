/** Pure tests for the Phase 3 contract: novelty (families), breadth under the 90-question ceiling, findings, the next action and the SWOT relationship rule. */
import { assembleEligiblePool, pickDistinct } from '../src/lib/tests/assembly'
import { filterEligiblePool, type PoolItem } from '../src/lib/tests/itemPool'
import { allocateWeighted, type SubjectWeight } from '../src/lib/tests/weightedBlueprint'
import { buildFindings, buildSwot, chooseNextAction, type Tagged, type OutcomeStatus, type ReadingEdge } from '../src/lib/tests/resultAnalysis'

let passed = 0, failed = 0
const check = (n: string, ok: boolean, d = '') => { ok ? (passed++, console.log(`  ✓ ${n}`)) : (failed++, console.log(`  ✗ ${n}${d ? ` — ${d}` : ''}`)) }

const item = (id: string, family: string | null, outcome = 'o1', reading = 'r1'): PoolItem => ({ id, lm_id: reading, outcome_id: outcome, concept_id: 'c', intended_difficulty: 'standard', cognition: 'apply', item_form: 'direct', key_index: 0, family_id: family })

console.log('\nNovelty: families\n')
{
  const readingOf = new Map([['o1', 'r1']]), bind = new Set(['c:o1']), active = new Set(['c'])
  const rows = [item('a', 'F1'), item('b', 'F1'), item('c2', null), item('d', null), item('e', 'F2')]
  check('a family the student has answered is not fresh evidence (a reworded sibling is excluded)', filterEligiblePool(rows, new Set(['x']), active, readingOf, bind, new Set(['F1'])).map(i => i.id).join() === 'c2,d,e')
  check('an unknown family stays unknown: two unfamiliar items are both independent', filterEligiblePool(rows, new Set(), active, readingOf, bind, new Set(['F1'])).filter(i => i.family_id === null).length === 2)
  const bp = { perReading: [{ readingId: 'r1', subjectId: 's', questions: 4, pages: 10 }], perOutcome: [{ outcomeId: 'o1', readingId: 'r1', subjectId: 's', questions: 4, kind: 'new' as const }] }
  const out = assembleEligiblePool(bp, rows, () => 0.5)
  const fams = out.items.map(i => rows.find(r => r.id === i.itemId)!.family_id).filter(Boolean)
  check('a paper holds at most one question per known family', new Set(fams).size === fams.length && out.items.length === 4, JSON.stringify(out.items.map(i => i.itemId)))
  const used = { d: new Map(), c: new Map(), f: new Map(), k: new Map() }
  check('the picker never returns two of one family', pickDistinct([item('p', 'G'), item('q', 'G'), item('r', 'G')], 3, used, () => 0.5).length === 1)
}

console.log('\nBreadth under the 90-question ceiling\n')
{
  const subjects: SubjectWeight[] = [{ id: 's1', min: 10, max: 15 }, { id: 's2', min: 5, max: 10 }]
  const targets = [] as any[], readings = [] as any[]
  for (let r = 0; r < 12; r++) { const outs = Array.from({ length: 10 }, (_, k) => `r${r}-o${k}`); readings.push({ readingId: `r${r}`, subjectId: r % 2 ? 's1' : 's2', pageCount: 20, outcomeIds: outs, newCount: 10, revisionCount: 0 }); for (const o of outs) targets.push({ outcomeId: o, readingId: `r${r}`, subjectId: r % 2 ? 's1' : 's2', kind: 'new', weight: 1, sources: [] }) }
  const big = allocateWeighted({ scope: { targets, readings }, subjects, kinds: ['new'] })
  check('120 confirmed outcomes never produce a paper above the ceiling', big.totalQuestions <= 90 && big.totalQuestions > 0)
  check('the outcomes that did not fit stay in an explicit pending list', big.rollingCoverage.length === 120 - big.perOutcome.length && big.rollingCoverage.length > 0)
  const forced = allocateWeighted({ scope: { targets, readings }, subjects, kinds: ['new'], totalOverride: 500 })
  check('even a forced size is clamped to 90 and the remainder stays pending', forced.totalQuestions === 90 && forced.rollingCoverage.length === 30)
  const small = allocateWeighted({ scope: { targets: targets.slice(0, 20), readings: readings.slice(0, 2) }, subjects, kinds: ['new'] })
  check('breadth before depth: a scope the paper can afford is covered outcome by outcome', small.rollingCoverage.length === 0 && small.perOutcome.length === 20)
}

console.log('\nFindings, support and the next action\n')
{
  const t = (over: Partial<Tagged>): Tagged => ({ itemId: 'i', correct: true, level: 'high', activeSeconds: 40, interruptedSeconds: 0, changedCount: 0, flagged: false, readingId: 'r1', subjectId: 's', outcomeId: 'o1', conceptId: 'c', conceptName: 'C', difficulty: null, form: null, cognition: null, errorCode: null, timing: 'reasonable', reading: null, verdict: 'observed_success' as any, tags: [], ...over } as Tagged)
  const none = () => null
  const mis = buildFindings({ tagged: [t({ itemId: 'm', correct: false, tags: ['confident_mistake'], errorCode: 'C' })], distractor: () => ({ label: 'a concept misunderstanding', description: 'treats the assumption as never applying' }), outcomeTitle: id => id, omitted: [] })
  check('a confident mistake is a possible misconception that uses the distractor evidence and says how many observations support it', mis[0]?.kind === 'misconception' && /Possible misconception/.test(mis[0].interpretation) && /never applying/.test(mis[0].interpretation) && /1 question — a second would confirm/.test(mis[0].interpretation))
  const prov = buildFindings({ tagged: [t({ level: 'low', tags: ['correct_guess'] })], distractor: none, outcomeTitle: id => id, omitted: [] })
  check('correct but uncertain is provisional evidence and offers a fresh check', prov[0]?.kind === 'provisional' && prov[0].action === 'fresh_check' && /provisional/.test(prov[0].interpretation))
  check('one slow-but-correct answer is not a timing finding', buildFindings({ tagged: [t({ tags: ['slow_correct'] })], distractor: none, outcomeTitle: id => id, omitted: [] }).length === 0)
  const slow = buildFindings({ tagged: [t({ itemId: 'a', tags: ['slow_correct'] }), t({ itemId: 'b', tags: ['slow_correct'] })], distractor: none, outcomeTitle: id => id, omitted: [] })
  check('repeatedly slow-but-correct is a timing issue, separate from repair', slow[0]?.kind === 'timing' && slow[0].action === 'timed_practice' && /not a concept gap/.test(slow[0].interpretation))
  const om = buildFindings({ tagged: [], distractor: none, outcomeTitle: id => id, omitted: [{ itemId: 'x', outcomeId: 'o2' }] })
  check('an unanswered question is recorded as an omission with its cause unknown, not as a wrong answer', om[0]?.kind === 'omitted' && /unknown/.test(om[0].interpretation) && /not counted as a wrong answer/.test(om[0].interpretation))
  const intr = buildFindings({ tagged: [t({ tags: ['interrupted'], interruptedSeconds: 60 })], distractor: none, outcomeTitle: id => id, omitted: [] })
  check('an interruption is recorded and not held against the student', intr[0]?.kind === 'interrupted' && /not held against you/.test(intr[0].interpretation))

  const na = (findings: any[], extra = {}) => chooseNextAction({ findings, repairCount: 0, furtherPaper: false, hasRepairOpen: false, ...extra })
  check('a genuine gap leads to a repair preview', na(mis).kind === 'repair' && na(mis).href === '#proposal-h')
  check('a provisional-only result leads to a fresh check', na(prov).kind === 'fresh_check')
  check('a timing-only result leads to timed practice', na(slow).kind === 'timed_practice')
  check('untested scope leads to a further paper', na([], { furtherPaper: true }).kind === 'further_paper')
  check('nothing to act on says so, honestly', na([]).kind === 'continue')
  check('a repair outranks a fresh check', na([...prov, ...mis]).kind === 'repair')
}

console.log('\nSWOT: verified relationships only\n')
{
  const outcomes: OutcomeStatus[] = [
    { outcomeId: 'w1', readingId: 'A', subjectId: 's', title: 'weak', verdict: 'known_gap', band: 'repair', correctHere: 0, askedHere: 2 },
    { outcomeId: 's1', readingId: 'S', subjectId: 's', title: 'strong', verdict: 'secure', band: 'secure', correctHere: 3, askedHere: 3 },
  ]
  const name = (id: string) => `Reading ${id}`
  const edges: ReadingEdge[] = [
    { from: 'A', to: 'B', kind: 'prerequisite', basis: 'sequence', rationale: null },
    { from: 'A', to: 'C', kind: 'prerequisite', basis: 'concept_link', rationale: 'C is built on A.' },
    { from: 'S', to: 'D', kind: 'applied_in', basis: 'concept_link', rationale: 'D applies S.' },
    { from: 'S', to: 'E', kind: 'prerequisite', basis: 'sequence', rationale: null },
  ]
  const sw = buildSwot({ outcomes, edges, readingName: name })
  check('a sequence-only link is never a threat', !sw.threats.some(x => x.readingId === 'B'))
  check('a verified dependency is a threat, with its rationale', sw.threats.some(x => x.readingId === 'C' && /built on A/.test(x.support)))
  check('a verified application is an opportunity, not evidence of knowledge', sw.opportunities.some(x => x.readingId === 'D' && /not evidence/.test(x.support)))
  check('a sequence-only link is navigation and says it implies nothing', !sw.opportunities.some(x => x.readingId === 'E') && sw.navigation.some(x => x.readingId === 'E' && /does not mean it depends/.test(x.support)))
}

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed) process.exit(1)
