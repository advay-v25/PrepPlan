/** Pure tests: canonical completed scope, weighted allocation, and the 90-question ceiling. */
import { buildCompletedScope, type BlockRow, type OutcomeRef, type ReadingRef, type ScopeInput } from '../src/lib/tests/completedScope'
import { allocateWeighted, apportion, targetQuestionCount, type SubjectWeight } from '../src/lib/tests/weightedBlueprint'
import { acceptProgress, expectedSeconds, timingClass, readAnswer } from '../src/lib/tests/attemptTiming'
import { MAX_ASSESSMENT_QUESTIONS, MOCK_QUESTIONS, MOCK_MINUTES, clampQuestions, estimatedMinutes } from '../src/lib/tests/limits'

let passed = 0, failed = 0
const check = (n: string, ok: boolean, d = '') => { ok ? (passed++, console.log(`  ✓ ${n}`)) : (failed++, console.log(`  ✗ ${n}${d ? ` — ${d}` : ''}`)) }

// Fixture: 3 subjects; readings with pages; 4 outcomes per reading.
const subjects: SubjectWeight[] = [{ id: 'fsa', min: 11, max: 14 }, { id: 'quant', min: 6, max: 9 }, { id: 'econ', min: 6, max: 9 }, { id: 'eth', min: 15, max: 20 }]
const readingDefs: [string, string, number][] = [['r1', 'fsa', 40], ['r2', 'fsa', 20], ['r3', 'quant', 30], ['r4', 'econ', 10], ['r5', 'econ', 50]]
const readings = new Map<string, ReadingRef>(readingDefs.map(([id, s, p], i) => [id, { id, subjectId: s, readingNo: i + 1, title: id, pageCount: p, structurePending: false }]))
const outcomes = new Map<string, OutcomeRef>()
for (const [rid, sid] of readingDefs.map(d => [d[0], d[1]])) for (const c of 'abcd') outcomes.set(`${rid}-${c}`, { id: `${rid}-${c}`, readingId: rid, subjectId: sid, code: c, title: `${rid}${c}` })
const blk = (id: string, o: Partial<BlockRow> = {}): BlockRow => ({ id, title: id, taskType: 'study', execution: 'completed', localDate: '2026-09-15', outcomeId: null, readingId: null, origin: 'planner', ...o })
const base = (blocks: BlockRow[], extra: Partial<ScopeInput> = {}): ScopeInput => ({
  cycle: { id: 'c1', startsAt: '2026-09-14', endsAt: '2026-09-20' }, today: '2026-09-18', blocks, confirmations: new Map(), classItems: [],
  outcomes, readings, priorOutcomes: new Set(), priorReadings: new Set(), ...extra,
})

console.log('\nCompleted-scope contract\n')
{
  const planned = ['r1-a', 'r1-b', 'r2-a', 'r3-a', 'r3-b', 'r4-a', 'r5-a', 'r5-b'].map((o, i) => blk(`b${i}`, { outcomeId: o, execution: i < 5 ? 'completed' : 'not_started', localDate: i < 5 ? '2026-09-15' : '2026-09-19' }))
  const s = buildCompletedScope(base(planned))
  check('planned A-Z, completed A-M: only the completed part is scope', s.targets.map(t => t.outcomeId).join() === 'r1-a,r1-b,r2-a,r3-a,r3-b')
  check('not-yet-due blocks are neither scope nor "missed"', s.excluded.length === 0)
}
{
  const s = buildCompletedScope(base([blk('m', { outcomeId: 'r1-a', execution: 'skipped' }), blk('p', { outcomeId: 'r2-a', execution: 'deferred' }), blk('n', { outcomeId: 'r3-a', execution: 'not_started', localDate: '2026-09-15' })]))
  check('missed, postponed and overdue-undone blocks never enter scope', s.targets.length === 0)
  check('each is excluded with its own reason', ['missed', 'postponed', 'not_completed'].every(r => s.excluded.some(e => e.reason === r)))
}
{
  const s = buildCompletedScope(base([blk('e', { outcomeId: 'r5-b', origin: 'student' }), blk('qs-key-r4-a', { outcomeId: 'r4-a', origin: 'student' })]))
  check('an extra topic completed through Calendar joins scope', s.targets.length === 2)
  check('a quick-study block is recorded as a quick source', s.targets.find(t => t.outcomeId === 'r4-a')!.sources[0].type === 'quick')
}
{
  const s = buildCompletedScope(base([]))
  check('a class that was scheduled but not attended adds nothing', s.targets.length === 0)
  const s2 = buildCompletedScope(base([], { classItems: [{ sessionId: 's1', classDate: '2026-09-15', kind: 'covered', outcomeId: 'r1-a', extent: 'part', studiedInClass: false }] }))
  check('a class item logged as only PART of an outcome is NOT testable scope: no portion can be verified, so it stays visibly pending', s2.targets.length === 0 && s2.pendingPortions.length === 1 && s2.pendingPortions[0].outcomeId === 'r1-a')
  const s2b = buildCompletedScope(base([], { classItems: [{ sessionId: 's1', classDate: '2026-09-15', kind: 'covered', outcomeId: 'r1-a', extent: 'full', studiedInClass: false }] }))
  check('attended class coverage of the whole outcome does enter scope', s2b.targets.length === 1 && s2b.targets[0].weight === 1 && s2b.pendingPortions.length === 0)
  const part = { sessionId: 's1', classDate: '2026-09-15', kind: 'covered' as const, outcomeId: 'r1-b', extent: 'part' as const, studiedInClass: false }
  const s3 = buildCompletedScope(base([blk('cons', { outcomeId: 'r1-b', taskType: 'class_consolidation' })], { classItems: [part], classBlockSessions: new Map([['cons', 's1']]) }))
  check('completing the class\'s own consolidation of the part does not make the whole outcome testable', s3.targets.length === 0 && s3.pendingPortions.length === 1)
  const s4 = buildCompletedScope(base([blk('own', { outcomeId: 'r1-b' })], { classItems: [part] }))
  check('a study task for the whole outcome (not the class consolidation) confirms it, and the pending portion clears', s4.targets.length === 1 && s4.pendingPortions.length === 0)
  const s5 = buildCompletedScope(base([], { classItems: [part, { ...part, sessionId: 's2', classDate: '2026-09-17', extent: 'continued' }] }))
  check('a later class merely CONTINUING it is progress: still pending, never a target', s5.targets.length === 0 && s5.pendingPortions.length === 2)
  const s5b = buildCompletedScope(base([], { classItems: [{ ...part, extent: 'continued' }] }))
  check('a lone "continued" log (no earlier log) is pending, not testable', s5b.targets.length === 0 && s5b.pendingPortions.length === 1 && s5b.pendingPortions[0].extent === 'continued')
  const s5c = buildCompletedScope(base([], { classItems: [part, { ...part, sessionId: 's2', extent: 'continued' }, { ...part, sessionId: 's3', extent: 'continued' }] }))
  check('repeated continued logs stay pending', s5c.targets.length === 0 && s5c.pendingPortions.length === 3)
  const s5d = buildCompletedScope(base([], { classItems: [part, { ...part, sessionId: 's2', extent: 'continued' }, { ...part, sessionId: 's4', extent: 'full' }] }))
  check('an explicit "All of it" log confirms the whole outcome and clears every pending portion', s5d.targets.length === 1 && s5d.targets[0].weight === 1 && s5d.pendingPortions.length === 0)
  // Next-week successor: the class lives in an earlier cycle; the lineage map still ties the successor to it.
  const old = { ...part, inCycle: false }
  const succ = buildCompletedScope(base([blk('succ', { outcomeId: 'r1-b', taskType: 'class_consolidation' })], { classItems: [old], classBlockSessions: new Map([['succ', 's1']]) }))
  check('a completed next-week continuation of the part consolidation is NOT whole coverage, and the old portion stays visible', succ.targets.length === 0 && succ.pendingPortions.length === 1 && succ.pendingPortions[0].classDate === '2026-09-15' && succ.unresolved.some(u => u.blockId === 'succ' && u.reason === 'class_part'))
  const rv = buildCompletedScope(base([blk('succ', { outcomeId: 'r1-b', taskType: 'review' })], { classItems: [old], classBlockSessions: new Map([['succ', 's1']]) }))
  check('a part consolidation changed from study to review is still not whole coverage', rv.targets.length === 0)
  const sp = buildCompletedScope(base([blk('sp', { outcomeId: 'r1-b', scopePending: true })], { classItems: [old], classBlockSessions: new Map([['sp', 's1']]) }))
  check('a split sitting of the part consolidation never completes the outcome', sp.targets.length === 0)
  const conf = buildCompletedScope(base([blk('succ', { outcomeId: 'r1-b', taskType: 'class_consolidation' })], { classItems: [old], classBlockSessions: new Map([['succ', 's1']]), confirmations: new Map([['succ', ['r1-b']]]) }))
  check('the student explicitly confirming the whole outcome on that task makes it eligible and clears pending', conf.targets.length === 1 && conf.pendingPortions.length === 0 && conf.unresolved.length === 0)
  const sep = buildCompletedScope(base([blk('sep', { outcomeId: 'r1-b' })], { classItems: [old], classBlockSessions: new Map([['succ', 's1']]) }))
  check('a separate task for the whole outcome still confirms it (a finished outcome inside a larger task stays valid)', sep.targets.length === 1 && sep.pendingPortions.length === 0)
  const pw = buildCompletedScope(base([], { classItems: [old], priorWhole: new Set(['r1-b']) }))
  check('whole coverage confirmed in an earlier week clears the old portion', pw.pendingPortions.length === 0 && pw.targets.length === 0)
  check('the scope revision changes when a portion becomes whole', s5d.revision !== s5.revision)
  check('pending portions change the scope revision (a reserved paper cannot silently outlive the change)', s3.revision !== buildCompletedScope(base([], { classItems: [] })).revision)
}
{
  const s = buildCompletedScope(base([blk('t', { outcomeId: 'r1-a' })], { classItems: [{ sessionId: 's1', classDate: '2026-09-15', kind: 'covered', outcomeId: 'r1-a', extent: 'full', studiedInClass: false }] }))
  check('the same outcome from a block AND a class is ONE target', s.targets.length === 1 && s.targets[0].sources.length === 2)
  check('its weight is the strongest source, so questions never multiply', s.targets[0].weight === 1)
}
{
  const s = buildCompletedScope(base([blk('rl', { readingId: 'r3' }), blk('pt', { readingId: 'r1', execution: 'partial' })]))
  check('a reading-level block is unresolved, never guessed into outcomes', s.targets.length === 0 && s.unresolved.some(u => u.blockId === 'rl' && u.reason === 'reading_level'))
  check('a partial block is unresolved until a portion is confirmed', s.unresolved.some(u => u.blockId === 'pt' && u.reason === 'partial'))
  const confirmed = buildCompletedScope(base([blk('rl', { readingId: 'r3' }), blk('pt', { readingId: 'r1', execution: 'partial' })], { confirmations: new Map([['rl', ['r3-a', 'r3-b']], ['pt', ['r1-c']]]) }))
  check('confirmed outcomes enter scope; partial ones at half weight', confirmed.targets.map(t => `${t.outcomeId}:${t.weight}`).sort().join() === 'r1-c:0.5,r3-a:1,r3-b:1' && confirmed.unresolved.length === 0)
}
{
  const s = buildCompletedScope(base([blk('a', { outcomeId: 'r1-a' }), blk('b', { outcomeId: 'r2-a' }), blk('c', { outcomeId: 'r3-a', taskType: 'review' }), blk('d', { outcomeId: 'r4-a' })], { priorOutcomes: new Set(['r1-a']), priorReadings: new Set(['r2']) }))
  const kind = (o: string) => s.targets.find(t => t.outcomeId === o)!.kind
  check('new vs revision comes from history: prior outcome or prior reading = revision', kind('r1-a') === 'revision' && kind('r2-a') === 'revision')
  check('a review block is revision even with no history', kind('r3-a') === 'revision')
  check('untouched, non-review work is new', kind('r4-a') === 'new')
}
{
  const s = buildCompletedScope(base([blk('pp', { outcomeId: 'r1-a', taskType: 'diagnostic' }), blk('rp', { outcomeId: 'r1-b', taskType: 'repair' }), blk('ad', { taskType: 'admin' })]))
  check('the paper, repair work and admin are not learning scope', s.targets.length === 0)
}
{
  const eth: ReadingRef = { id: 'r9', subjectId: 'eth', readingNo: 9, title: 'r9', pageCount: 12, structurePending: true }
  const s = buildCompletedScope(base([blk('e', { readingId: 'r9' })], { readings: new Map([...readings, ['r9', eth]]) }))
  check('a structure-pending (Ethics) reading is excluded with its reason, not tested', s.targets.length === 0 && s.excluded[0]?.reason === 'structure_pending')
}
{
  const a = buildCompletedScope(base([blk('a', { outcomeId: 'r1-a' })])), b = buildCompletedScope(base([blk('a', { outcomeId: 'r1-a' })]))
  const c = buildCompletedScope(base([blk('a', { outcomeId: 'r1-a' }), blk('z', { outcomeId: 'r2-a' })]))
  check('the scope revision is stable for the same scope and changes when it changes', a.revision === b.revision && a.revision !== c.revision)
}

console.log('\nLimits\n')
check('the ceiling is 90 and a mock is 90 questions in 135 minutes', MAX_ASSESSMENT_QUESTIONS === 90 && MOCK_QUESTIONS === 90 && MOCK_MINUTES === 135)
check('clampQuestions never exceeds 90 or goes negative', clampQuestions(500) === 90 && clampQuestions(-3) === 0 && clampQuestions(37.9) === 37)
check('time estimate uses the 90-second reference', estimatedMinutes(60) === 90 && estimatedMinutes(90) === 135)

console.log('\nWeighted allocation\n')
const scopeOf = (defs: { o: string; kind?: 'new' | 'revision'; w?: number }[]) => {
  const targets = defs.map(d => { const oc = outcomes.get(d.o)!; return { outcomeId: d.o, readingId: oc.readingId, subjectId: oc.subjectId, kind: d.kind ?? 'new', weight: d.w ?? 1, sources: [] as any[] } })
  const rmap = new Map<string, any>()
  for (const t of targets) { const r = rmap.get(t.readingId) ?? { readingId: t.readingId, subjectId: t.subjectId, pageCount: readings.get(t.readingId)!.pageCount, outcomeIds: [], newCount: 0, revisionCount: 0 }; r.outcomeIds.push(t.outcomeId); rmap.set(t.readingId, r) }
  return { targets, readings: [...rmap.values()] }
}
const all = (rid: string) => 'abcd'.split('').map(c => ({ o: `${rid}-${c}` }))
{
  const bp = allocateWeighted({ scope: scopeOf([...all('r1'), ...all('r3'), ...all('r4')]), subjects, kinds: ['new', 'revision'] })
  const subj = (s: string) => bp.perSubject.find(x => x.subjectId === s)!.questions
  check('the allocation never exceeds the ceiling', bp.totalQuestions <= 90 && bp.totalQuestions > 0)
  check('every eligible reading gets at least one question (breadth floor)', ['r1', 'r3', 'r4'].every(r => (bp.perReading.find(x => x.readingId === r)?.questions ?? 0) >= 1))
  check('the higher-weight subject gets more questions than a lower-weight one', subj('fsa') > subj('quant') && subj('fsa') > subj('econ'))
  check('smaller completed scope is not erased by the heavy subject', subj('quant') >= 1 && subj('econ') >= 1)
  check('nothing is allocated outside completed scope', bp.perOutcome.every(o => ['r1', 'r3', 'r4'].includes(o.readingId)))
  check('questions total = the sum over outcomes, readings and subjects', bp.totalQuestions === bp.perOutcome.reduce((s, o) => s + o.questions, 0) && bp.totalQuestions === bp.perSubject.reduce((s, x) => s + x.questions, 0))
}
{
  const bp = allocateWeighted({ scope: scopeOf([...all('r4'), ...all('r5')]), subjects, kinds: ['new'] })
  const q = (r: string) => bp.perReading.find(x => x.readingId === r)!.questions
  check('same subject, same reading size: pages never reduce a reading and break only an odd extra question', q('r5') >= q('r4'))
  const sized = allocateWeighted({ scope: scopeOf([...all('r4'), { o: 'r5-a' }, { o: 'r5-b' }]), subjects, kinds: ['new'] })
  check('reading size (eligible outcomes) outranks page count', sized.perReading.find(x => x.readingId === 'r4')!.questions > sized.perReading.find(x => x.readingId === 'r5')!.questions)
  const every = allocateWeighted({ scope: scopeOf([...all('r1'), ...all('r3'), ...all('r4')]), subjects, kinds: ['new'] })
  check('breadth before depth: when the paper can afford it every eligible outcome is asked once', every.rollingCoverage.length === 0 && every.perOutcome.length === 12)
  const tie = allocateWeighted({ scope: scopeOf([...all('r3'), ...all('r4')]), subjects, kinds: ['new'] })
  const s = (id: string) => tie.perSubject.find(x => x.subjectId === id)!.questions
  check('two subjects of equal weight: the one with more completed pages gets the extra question', s('quant') >= s('econ') ? true : false, JSON.stringify(tie.perSubject))
}
{
  const small = allocateWeighted({ scope: scopeOf(all('r1')), subjects, kinds: ['new'] })
  const big = allocateWeighted({ scope: scopeOf([...all('r1'), ...all('r2'), ...all('r3'), ...all('r4'), ...all('r5')]), subjects, kinds: ['new'] })
  check('paper size scales with completed scope', small.totalQuestions < big.totalQuestions)
  check('a routine weekly paper stays within the soft ceiling', big.totalQuestions <= 60)
  check('size is adaptive, not automatically the maximum', small.totalQuestions < 30)
  check('targetQuestionCount is 0 for no scope and never above 90', targetQuestionCount(0, 0) === 0 && targetQuestionCount(500, 90, 10_000) <= 90)
}
{
  const bp = allocateWeighted({ scope: scopeOf([...all('r1'), ...all('r2')]), subjects, kinds: ['new'], minutesBudget: 6 })
  check('when questions are fewer than readings the best-ranked readings are sampled and the rest are named', bp.totalQuestions <= 4 && bp.rollingCoverage.length > 0)
}
{
  const bp = allocateWeighted({ scope: scopeOf(all('r1')), subjects, kinds: ['new'], minutesBudget: 3 })
  check('unsampled outcomes become a visible rolling-coverage obligation, not "verified"', bp.rollingCoverage.length > 0 && bp.rollingCoverage.every(o => !bp.perOutcome.some(x => x.outcomeId === o)))
}
{
  const mixed = allocateWeighted({ scope: scopeOf([{ o: 'r1-a' }, { o: 'r1-b' }, { o: 'r3-a', kind: 'revision' }, { o: 'r3-b', kind: 'revision' }]), subjects, kinds: ['new', 'revision'] })
  check('a mixed paper has identifiable new and revisionary sections', mixed.sections.some(s => s.kind === 'new') && mixed.sections.some(s => s.kind === 'revision'))
  const onlyNew = allocateWeighted({ scope: scopeOf([{ o: 'r1-a' }, { o: 'r3-a', kind: 'revision' }]), subjects, kinds: ['new'] })
  check('a diagnostic paper never tests revision scope, and vice versa', onlyNew.perOutcome.every(o => o.kind === 'new'))
}
{
  const carried = allocateWeighted({ scope: scopeOf([...all('r1'), ...all('r3')]), subjects, kinds: ['revision', 'new'], carriedOutcomeIds: ['r5-a', 'r5-b', 'r5-c', 'r5-d', 'r2-a'] })
  const cq = carried.perOutcome.filter(o => o.kind === 'carried').reduce((s, o) => s + o.questions, 0)
  check('prior weak outcomes are a limited, explicit section (<=15%)', cq > 0 && cq <= Math.ceil(carried.totalQuestions * 0.15) + 1 && carried.sections.some(s => s.kind === 'carried'))
}
{
  const bank = new Map([['r1', 2], ['r3', 50]])
  const bp = allocateWeighted({ scope: scopeOf([...all('r1'), ...all('r3')]), subjects, kinds: ['new'], bankCountByReading: bank })
  check('a thin bank names the reading and the gap', bp.bankShortfalls.some(s => s.readingId === 'r1' && s.available === 2 && s.wanted > 2) && !bp.bankShortfalls.some(s => s.readingId === 'r3'))
}
{
  const a = apportion(10, [{ key: 'a', weight: 1 }, { key: 'b', weight: 1 }, { key: 'c', weight: 1 }])
  check('apportionment is exact and deterministic', [...a.values()].reduce((s, n) => s + n, 0) === 10 && JSON.stringify([...a]) === JSON.stringify([...apportion(10, [{ key: 'a', weight: 1 }, { key: 'b', weight: 1 }, { key: 'c', weight: 1 }])]))
  check('nothing to test yields an empty blueprint with a reason', allocateWeighted({ scope: { targets: [], readings: [] }, subjects, kinds: ['new'] }).policy.note.length > 10)
}

console.log('\nTiming and interpretation\n')
{
  check('active time cannot grow faster than the wall clock', acceptProgress({ activeSeconds: 10, interruptedSeconds: 0 }, { activeSeconds: 500, interruptedSeconds: 0 }, 20).activeSeconds <= 10 + 20 + 3)
  check('active time never goes backwards', acceptProgress({ activeSeconds: 30, interruptedSeconds: 4 }, { activeSeconds: 5, interruptedSeconds: 0 }, 60).activeSeconds === 30)
  check('interrupted time is kept and monotonic', acceptProgress({ activeSeconds: 0, interruptedSeconds: 12 }, { activeSeconds: 0, interruptedSeconds: 3 }, 60).interruptedSeconds === 12)
  check('garbage input is treated as zero', acceptProgress({ activeSeconds: 5, interruptedSeconds: 0 }, { activeSeconds: NaN, interruptedSeconds: -4 }, 10).activeSeconds === 5)
  check('a question is judged against its own type, not a flat 90 seconds', expectedSeconds('calculation') > expectedSeconds('application') && expectedSeconds('recall') < 90)
  check('a slow calculation is not called slow at 100 seconds', timingClass(100, 0, 'calculation') === 'reasonable')
  check('the same 100 seconds on a recall question is not quick either', timingClass(100, 0, 'recall') !== 'quick')
  check('very long active time on one question reads as slow', timingClass(400, 0, 'application') === 'slow')
  check('an interrupted question is labelled, not judged', timingClass(20, 60, 'application') === 'untimed_or_interrupted')
  check('right + sure is stronger evidence; right + guessing is only possible recognition', readAnswer(true, 'high') === 'stronger_evidence' && readAnswer(true, 'low') === 'possible_recognition')
  check('wrong + sure is a confident misconception; wrong + guessing is a gap', readAnswer(false, 'high') === 'confident_misconception' && readAnswer(false, 'low') === 'knowledge_gap')
  check('medium confidence is unsettled either way', readAnswer(true, 'medium') === 'unsettled' && readAnswer(false, 'medium') === 'unsettled')
}
{
  const bp = allocateWeighted({ scope: scopeOf([...all('r1'), ...all('r3'), ...all('r4')]), subjects, kinds: ['new'], totalOverride: 500 })
  check('a forced size is still clamped to the 90-question ceiling', bp.totalQuestions <= 90 && bp.totalQuestions > 0)
  // A scope larger than any paper: 40 readings x 4 outcomes = 160 completed outcomes. The ceiling holds, the remainder is NAMED (never dropped or called verified),
  // and nothing from outside the scope is used to fill the paper.
  const bigReadings = Array.from({ length: 40 }, (_, k) => `big${k}`)
  for (const rid of bigReadings) { readings.set(rid, { id: rid, subjectId: 'fsa', readingNo: 100, title: rid, pageCount: 10, structurePending: false }); for (const c of 'abcd') outcomes.set(`${rid}-${c}`, { id: `${rid}-${c}`, readingId: rid, subjectId: 'fsa', code: c, title: `${rid}${c}` }) }
  const bigScope = scopeOf(bigReadings.flatMap(all))
  const big = allocateWeighted({ scope: bigScope, subjects, kinds: ['new'], totalOverride: 500 })
  check('160 completed outcomes: the paper stops at 90 and the rest is a named remainder', big.totalQuestions === 90 && big.rollingCoverage.length === 160 - big.perOutcome.length && big.rollingCoverage.length >= 70)
  check('every asked outcome is inside the completed scope; the remainder and the asked set never overlap', big.perOutcome.every(o => bigScope.targets.some(t => t.outcomeId === o.outcomeId)) && big.rollingCoverage.every(o => !big.perOutcome.some(x => x.outcomeId === o)))
  const mock = allocateWeighted({ scope: scopeOf([...all('r1'), ...all('r2'), ...all('r3'), ...all('r4'), ...all('r5')]), subjects, kinds: ['new'], totalOverride: 90 })
  check('a mock allocates exactly 90 across the syllabus, weighted by subject', mock.totalQuestions === 90 && mock.perSubject.find(x => x.subjectId === 'fsa')!.questions > mock.perSubject.find(x => x.subjectId === 'econ')!.questions)
}

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed) process.exit(1)
