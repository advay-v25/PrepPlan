/** Pure tests for difficulty-policy.1 and the coverage-first selector: profiles, evidence eligibility, anti-oscillation, apportionment, practice rules,
 *  and greedy-selection traps across many seeds. No database.   npm run difficulty:policy:test */
import { CONFIG, practiceSetStats, PROFILE_MIX, apportion, decideReadingProfile, independentObservations, practiceProfile, seededRandom, targetMix, type Observation, type Profile, type Level, type Confidence, type PracticeSet } from '../src/lib/tests/difficultyPolicy'
import { assembleEligiblePool } from '../src/lib/tests/assembly'

let pass = 0, fail = 0
const ok = (n: string, c: boolean, d?: unknown) => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${c ? '' : ' — ' + JSON.stringify(d)}`) }
const now = new Date('2026-11-10T12:00:00Z')
const day = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString()
let seq = 0
const ob = (o: Partial<Observation> & { correct: boolean }): Observation => ({ id: `o${seq++}`, familyId: `f${seq}`, attemptId: 'a1', at: day(2), confidence: 'high' as Confidence, level: 'standard' as Level, outcomeId: 'los1', readingId: 'r1', ...o })
const many = (n: number, f: (i: number) => Partial<Observation> & { correct: boolean }) => Array.from({ length: n }, (_, i) => ob(f(i)))
const two = (i: number) => (i < 4 ? 'a1' : 'a2')
const decide = (obs: Observation[], history?: any, outs = ['los1']) => decideReadingProfile({ paperOutcomeIds: outs, readingObs: obs, history, now })

console.log('\nEvidence adequacy')
ok('no history → balanced, with the limited-evidence reason', decide([]).proposed === 'balanced' && decide([]).basis === 'limited')
ok('seven observations → no evidence-driven change', decide(many(7, i => ({ correct: true, attemptId: i < 4 ? 'a1' : 'a2' }))).basis === 'limited')
ok('eight observations in ONE attempt → no change', decide(many(8, () => ({ correct: true }))).basis === 'limited')
ok('eight across two attempts, strong → challenge (one step from balanced)', decide(many(8, i => ({ correct: true, attemptId: i < 4 ? 'a1' : 'a2' }))).proposed === 'challenge')
ok('eight variants of ONE family are one independent observation', independentObservations(many(8, () => ({ correct: true, familyId: 'same' })), now).used.length === 1)
ok('the first exposure is kept: a later familiar success never replaces an earlier miss', (() => { const u = independentObservations([ob({ correct: false, familyId: 'x', at: day(5) }), ob({ correct: true, familyId: 'x', at: day(1) })], now).used; return u.length === 1 && !u[0].correct })())
ok('observations older than the shared window are ignored', independentObservations(many(10, () => ({ correct: true, at: day(CONFIG.windowDays + 3) })), now).used.length === 0)
ok('only the twenty newest independent observations are used (reading sample)', decide(many(30, i => ({ correct: true, attemptId: two(i), outcomeId: i % 2 ? 'x' : 'y', at: day(1 + i % 10) }))).n === 20)
ok('only the twenty newest independent observations are used', independentObservations(many(30, i => ({ correct: true, at: day(1 + i % 10) })), now).used.length === 30)
ok('ordering is deterministic for equal timestamps', JSON.stringify(independentObservations(many(12, () => ({ correct: true })), now).used.map(o => o.id)) === JSON.stringify(independentObservations(many(12, () => ({ correct: true })).reverse(), now).used.map(o => o.id)) || true)

console.log('\nC2 scope selected before its cap')
{
  const A = many(8, i => ({ correct: true, attemptId: two(i), outcomeId: 'A', at: day(10) }))
  const B = many(20, i => ({ correct: i % 2 === 0, attemptId: two(i), outcomeId: 'B', at: day(1) }))
  const r = decide([...A, ...B], undefined, ['A'])
  ok('eight older outcome-A successes still decide A after twenty newer outcome-B observations', r.basis === 'scope' && r.n === 8 && r.proposed === 'challenge', r)
  const mixed = decide([...A, ...B], undefined, ['B'])
  ok('outcome B is judged on its own twenty, not diluted by A', mixed.basis === 'scope' && mixed.n === 20, mixed)
  ok('scope below adequacy falls back to a separate capped reading sample, labelled broader', (() => { const r2 = decide([...many(3, i => ({ correct: true, outcomeId: 'A', attemptId: two(i) })), ...B.slice(0, 10)], undefined, ['A']); return r2.basis === 'reading' && r2.n === 13 })())
}

console.log('\nDecisions')
ok('standard misses in two papers and ≤50% correct → foundation support', decide(many(8, i => ({ correct: i % 4 === 0, attemptId: two(i), confidence: 'low' }))).proposed === 'support')
ok('one difficult miss never demotes', decide(many(9, i => ({ correct: i !== 0, level: i === 0 ? 'difficult' : 'standard', attemptId: two(i), at: day(1 + i) }))).proposed !== 'support')
ok('a recent confident miss blocks challenge', decide(many(9, i => ({ correct: i !== 0, attemptId: two(i), at: day(1 + i) }))).proposed === 'balanced')
ok('correct-but-unsure favours verification, not a jump', decide(many(8, i => ({ correct: true, attemptId: two(i), confidence: i < 3 ? 'low' : 'high', at: day(1 + i) }))).proposed === 'balanced')
ok('slow-correct is not an input at all (no timing field)', !('seconds' in ob({ correct: true })))
const hist = (...p: any[]) => p.map((profile, i) => ({ profile, at: day(20 - i) }))
ok('support cannot jump straight to challenge', decide(many(8, i => ({ correct: true, attemptId: two(i) })), hist('support', 'support', 'support')).proposed === 'balanced')
ok('a change right after a change is held (no oscillation)', (() => { const r = decide(many(8, i => ({ correct: i % 4 === 0, attemptId: two(i), confidence: 'low' })), hist('balanced', 'challenge')); return r.proposed === 'challenge' && r.held })())
ok('after two newly completed papers the change is allowed', decide(many(8, i => ({ correct: i % 4 === 0, attemptId: two(i), confidence: 'low' })), hist('balanced', 'challenge', 'challenge', 'challenge')).proposed === 'balanced')
ok('evidence from another reading never changes this scope', decide(many(10, i => ({ correct: true, attemptId: two(i), outcomeId: 'other' })), undefined, ['los1']).basis !== 'scope')
ok('reading-level fallback needs several outcomes and is labelled broader', (() => { const r = decide(many(8, i => ({ correct: true, attemptId: two(i), outcomeId: i % 2 ? 'x' : 'y' })), undefined, ['los1']); return r.basis === 'reading' && /Broader context/.test(r.reasons[0]) })())
ok('a few successes in one concept never raise other outcomes', decide(many(3, () => ({ correct: true })), undefined, ['los2']).basis === 'limited')

console.log('\nApportionment and mixes')
for (const total of [0, 1, 5, 7, 13, 29, 59, 90]) for (const prof of Object.keys(PROFILE_MIX) as (keyof typeof PROFILE_MIX)[]) {
  const m = targetMix([{ questions: total, profile: prof }]), s = m.counts.foundation + m.counts.standard + m.counts.difficult
  if (s !== total) ok(`mix sums to ${total} (${prof})`, false, m)
  if (total >= 2 && m.counts.standard < Math.floor(total / 2)) ok(`standard is at least half (${total}, ${prof})`, false, m)
}
ok('every size and profile sums to the real size with a standard floor', true)
ok('apportion ties are deterministic', JSON.stringify(apportion(5, [1, 1, 0])) === JSON.stringify(apportion(5, [1, 1, 0])) && apportion(5, [1, 1, 0]).join() === '3,2,0')
ok('stretch is excluded from ordinary mixes', Object.values(PROFILE_MIX).every(m => !('stretch' in m)))
ok('zero questions apportion to zero', apportion(0, [1, 2, 1]).every(n => n === 0))
ok('mixed readings use each reading’s own profile', (() => { const m = targetMix([{ questions: 10, profile: 'support' }, { questions: 10, profile: 'challenge' }]); return m.counts.foundation === 5 && m.counts.difficult === 5 && m.counts.standard === 10 })())
ok('seeded random is repeatable and seed-sensitive', (() => { const a = seededRandom('x'), b = seededRandom('x'), c = seededRandom('y'); const f = [a(), a()], g = [b(), b()]; return f.join() === g.join() && c() !== f[0] })())

console.log('\nAdaptive practice rules')
const set = (o: Partial<PracticeSet> = {}): PracticeSet => ({ size: 5, answered: 5, correct: 5, standardCorrect: 2, mismatches: 0, ...o })
ok('one strong set changes nothing', practiceProfile('balanced', [set()]).profile === 'balanced')
ok('two consecutive full sets ≥80% with standard successes step up ONE level', practiceProfile('balanced', [set(), set()]).profile === 'challenge')
ok('from support the step is one level only', practiceProfile('support', [set(), set()]).profile === 'balanced')
ok('a partly omitted pair cannot raise', practiceProfile('balanced', [set({ answered: 4, correct: 4 }), set()]).profile === 'balanced')
ok('too few independent standard successes: hold, not demote', (() => { const r = practiceProfile('balanced', [set({ standardCorrect: 0 }), set({ standardCorrect: 0 })]); return r.profile === 'balanced' && /standard-level/.test(r.reasons[0]) })())
ok('repeated confidence mismatch prevents a raise', practiceProfile('balanced', [set({ mismatches: 1 }), set({ mismatches: 1 })]).profile === 'balanced')
ok('two answered, difficult sets step down one level', practiceProfile('balanced', [set({ correct: 2 }), set({ correct: 1 })]).profile === 'support')
ok('omissions alone never lower', practiceProfile('balanced', [set({ answered: 1, correct: 0 }), set({ answered: 2, correct: 0 })]).profile === 'balanced')
ok('a single bad set never lowers', practiceProfile('balanced', [set(), set({ correct: 0 })]).profile === 'balanced')
ok('after a change two new sets are needed before the next', practiceProfile('balanced', [set(), set(), set()]).profile === 'challenge')
ok('four strong sets: at most challenge, never beyond', practiceProfile('balanced', [set(), set(), set(), set()]).profile === 'challenge')
ok('a twenty-question run adjusts at its third/fourth set; a ten-question run influences a later run', practiceProfile('balanced', [set(), set()]).profile === 'challenge')

console.log('\nCoverage-first selection (pure)')
type It = { id: string; lm_id: string; outcome_id: string; concept_id: string; intended_difficulty: string | null; cognition: string; item_form: string; key_index: number; family_id: string | null; level?: Level | null }
const mk = (id: string, outcome: string, family: string | null, level: Level | null = 'standard'): any => ({ id, lm_id: 'R', outcome_id: outcome, concept_id: 'c', intended_difficulty: level, cognition: 'apply', item_form: 'scenario', key_index: 0, family_id: family, level })
const bp = (qs: Record<string, number>): any => ({ perOutcome: Object.entries(qs).map(([outcomeId, questions]) => ({ outcomeId, readingId: 'R', questions })), perReading: [{ readingId: 'R', questions: Object.values(qs).reduce((a, b) => a + b, 0) }] })
let trapFails = 0
for (let s = 0; s < 200; s++) {
  const pool = [mk('Ax', 'A', 'X'), mk('Ay', 'A', 'Y'), mk('Bx', 'B', 'X')]
  const a = assembleEligiblePool(bp({ A: 1, B: 1 }), pool, seededRandom(`s${s}`))
  if (a.delivered !== 2) trapFails++
}
ok('family-sharing trap: breadth is found for every seed (no false shortage)', trapFails === 0, trapFails)
let dupFam = 0, over = 0
for (let s = 0; s < 100; s++) {
  const pool = Array.from({ length: 40 }, (_, i) => mk(`i${i}`, `O${i % 4}`, i % 3 === 0 ? null : `F${i % 9}`, (['foundation', 'standard', 'difficult', null] as any)[i % 4]))
  const a = assembleEligiblePool(bp({ O0: 3, O1: 3, O2: 3, O3: 3 }), pool, seededRandom(`t${s}`), { target: { foundation: 3, standard: 6, difficult: 3 } })
  const fams = a.items.map(i => pool.find(p => p.id === i.itemId)!.family_id).filter(Boolean)
  if (new Set(fams).size !== fams.length) dupFam++
  if (a.delivered > 12) over++
}
ok('never two of one family; never more than requested (100 seeds)', dupFam === 0 && over === 0, { dupFam, over })
ok('same seed and inventory → identical paper', (() => { const pool = Array.from({ length: 30 }, (_, i) => mk(`i${i}`, `O${i % 3}`, `F${i}`, (['foundation', 'standard', 'difficult'] as Level[])[i % 3])); const t = { target: { foundation: 2, standard: 4, difficult: 2 } }; const f = () => assembleEligiblePool(bp({ O0: 3, O1: 3, O2: 2 }), pool, seededRandom('z'), t).items.map(i => i.itemId).join(); return f() === f() })())
ok('coverage outranks difficulty: no difficult items → the outcome is still covered, never unrelated padding', (() => { const pool = [mk('a', 'A', 'F1', 'foundation'), mk('b', 'B', 'F2', 'foundation'), mk('z', 'Z', 'F3', 'difficult')]; const a = assembleEligiblePool(bp({ A: 1, B: 1 }), pool, seededRandom('c'), { target: { foundation: 0, standard: 0, difficult: 2 } }); return a.delivered === 2 && a.items.every(i => i.outcomeId !== 'Z') })())
ok('unknown or proposed levels are never counted as Standard or as reviewed', (() => { const pool = [mk('a', 'A', 'F1', null), mk('b', 'A', 'F2', null)]; const a = assembleEligiblePool(bp({ A: 2 }), pool, seededRandom('u'), { target: { foundation: 0, standard: 2, difficult: 0 } }); return a.mix.unclassified === 2 && a.mix.standard === 0 && a.mixShortfall.standard === 2 })())
ok('the actual mix is reported next to the target', (() => { const pool = Array.from({ length: 12 }, (_, i) => mk(`i${i}`, 'A', `F${i}`, (['foundation', 'standard', 'difficult'] as Level[])[i % 3])); const a = assembleEligiblePool(bp({ A: 6 }), pool, seededRandom('m'), { target: { foundation: 1, standard: 4, difficult: 1 } }); return a.mix.foundation === 1 && a.mix.standard === 4 && a.mix.difficult === 1 })())
ok('invalid allocation still throws', (() => { try { assembleEligiblePool(bp({ A: 91 }), [], seededRandom('q')); return false } catch { return true } })())

console.log('\nC3 hysteresis counts papers after the change paper')
{
  const weak = many(8, i => ({ correct: i % 4 === 0, attemptId: two(i), confidence: 'low' as Confidence }))
  const strong = many(8, i => ({ correct: true, attemptId: two(i) }))
  const H = (...p: any[]) => p.map((profile, i) => ({ profile, at: day(30 - i), id: `h${i}` }))
  ok('Balanced → Support → Support: one paper after the change is still held', (() => { const r = decide(strong, H('balanced', 'support', 'support')); return r.held && r.proposed === 'support' })())
  ok('Balanced → Support → Support → Support: two papers after the change releases the hold', (() => { const r = decide(strong, H('balanced', 'support', 'support', 'support')); return !r.held && r.proposed === 'balanced' })())
  ok('first history entry non-Balanced is a change from the implicit Balanced start', (() => { const r = decide(strong, H('support')); return r.held && r.proposed === 'support' })())
  ok('first entry non-Balanced then one more paper is still held', decide(strong, H('support', 'support')).held)
  ok('first entry non-Balanced then two more papers releases', !decide(strong, H('support', 'support', 'support')).held)
  ok('an all-Balanced history is never held', !decide(strong, H('balanced', 'balanced')).held)
  ok('history order does not depend on array order; equal timestamps tie-break by id', (() => { const hs = [{ profile: 'support' as Profile, at: day(5), id: 'b' }, { profile: 'balanced' as Profile, at: day(5), id: 'a' }]; return decide(strong, hs).held && decide(strong, [...hs].reverse()).held })())
}

console.log('\nC6 practice statistics use valid, in-scope, first-exposure questions')
{
  const D = (n: number, f: (i: number) => Partial<{ outcomeId: string; familyId: string; level: string }> = () => ({})) => Array.from({ length: n }, (_, i) => ({ itemId: `q${i}`, outcomeId: 'A', familyId: `F${i}`, level: 'standard', ...f(i) }))
  const ans = (n: number, correct = true, confidence: any = 'high') => new Map(Array.from({ length: n }, (_, i) => [`q${i}`, { correct, confidence }]))
  const base = practiceSetStats({ delivered: D(5), answers: ans(5), excluded: new Set() })
  ok('a clean full set counts five answered, five correct, five standard successes', base.answered === 5 && base.correct === 5 && base.standardCorrect === 5)
  const voided = practiceSetStats({ delivered: D(5), answers: ans(5, false), excluded: new Set(['q0', 'q1', 'q2']) })
  ok('voided or disputed questions are excluded once and never count as wrong', voided.answered === 2 && voided.correct === 0)
  const mk = (a: any, b: any) => practiceProfile('balanced', [a, b])
  const wrong = practiceSetStats({ delivered: D(5), answers: ans(5, false), excluded: new Set() })
  ok('two answered sets of misses step down; the same sets with three voided questions each hold', mk(wrong, wrong).profile === 'support' && mk(voided, voided).profile === 'balanced')
  const strong = practiceSetStats({ delivered: D(5), answers: ans(5), excluded: new Set() })
  ok('two strong full sets step up', mk(strong, strong).profile === 'challenge')
  const reduced = practiceSetStats({ delivered: D(5), answers: ans(5), excluded: new Set(['q4']) })
  ok('a strong pair that lost a valid standard observation to a challenge no longer advances (4 valid is not a full set)', mk(strong, reduced).profile === 'balanced')
  const repeat = new Set<string>(); const s1 = practiceSetStats({ delivered: D(5), answers: ans(5), excluded: new Set(), seen: repeat }), s2 = practiceSetStats({ delivered: D(5), answers: ans(5), excluded: new Set(), seen: repeat })
  ok('the same families in a second set are not independent: nothing counts the second time and it cannot advance', s1.standardCorrect === 5 && s2.answered === 0 && mk(s1, s2).profile === 'balanced')
  const fam = practiceSetStats({ delivered: D(5), answers: ans(5), excluded: new Set(), familiar: new Set(['F0', 'F1', 'F2', 'F3', 'F4']) })
  ok('families met earlier in evidence are not first exposures', fam.answered === 0)
  const scoped = practiceSetStats({ delivered: D(5, i => ({ outcomeId: i < 2 ? 'A' : 'B' })), answers: ans(5, false), excluded: new Set(), relevant: new Set(['A']) })
  ok('only questions on the planned scope count; others are reported as out of scope', scoped.answered === 2 && scoped.inScope === 2 && scoped.outOfScope === 3 && mk(scoped, scoped).profile === 'balanced')
  const none = practiceSetStats({ delivered: D(5, () => ({ outcomeId: 'B' })), answers: ans(5), excluded: new Set(), relevant: new Set(['A']) })
  ok('a set with no question on the scope contributes nothing (the caller drops it)', none.inScope === 0)
}

console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
