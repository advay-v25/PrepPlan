import { observationVerdict, type Level, type ObsVerdict } from '../curriculum/confidence'
import { timingClass, readAnswer, type TimingClass, type Reading } from './attemptTiming'

/**
 * Result analysis (pure). Turns one scored attempt into an honest account of what it showed:
 * accuracy with its uncertainty, confidence and timing patterns, per-reading and per-subject
 * breakdowns, and an evidence-led SWOT. Nothing here reads the database, and nothing here
 * predicts the exam.
 *
 * Rules that keep it honest:
 *  - a group's label is never stronger than its sample allows (too few questions => "too few to judge");
 *  - one wrong answer never labels a whole subject weak, and one right answer is an "observed success",
 *    not a strength;
 *  - "opportunities" and "threats" are inferences from the curriculum's own dependency links and are
 *    labelled as such — they are never new wrong answers and never assumed competence.
 */

export type RespRow = {
  itemId: string; correct: boolean; level: Level | null
  activeSeconds: number | null; interruptedSeconds: number; changedCount: number; flagged: boolean
}
export type ItemMeta = {
  readingId: string | null; subjectId: string | null; outcomeId: string | null
  conceptId: string | null; conceptName: string | null
  difficulty: string | null; form: string | null; cognition: string | null
  errorCode: string | null
}

export type Judgement = 'too_few' | 'unclear' | 'strong' | 'weak'
export type Cell = {
  id: string; questions: number; correct: number; accuracy: number
  interval: [number, number]; judgement: Judgement; certainty: 'very limited' | 'limited' | 'moderate'
  difficultyMix: Record<string, number>; formMix: Record<string, number>; cognitionMix: Record<string, number>
}

/** Wilson score interval; z=1.28 is an 80% interval. */
export function wilson(correct: number, n: number, z = 1.28): [number, number] {
  if (n === 0) return [0, 1]
  const p = correct / n, z2 = z * z
  const denom = 1 + z2 / n
  const centre = (p + z2 / (2 * n)) / denom
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom
  return [Math.max(0, centre - half), Math.min(1, centre + half)]
}

export function judge(correct: number, n: number): { judgement: Judgement; certainty: Cell['certainty']; interval: [number, number] } {
  const interval = wilson(correct, n)
  const certainty = n < 3 ? 'very limited' : n < 6 ? 'limited' : 'moderate'
  if (n < 4) return { judgement: 'too_few', certainty, interval }
  if (interval[1] < 0.5) return { judgement: 'weak', certainty, interval }
  if (interval[0] > 0.7) return { judgement: 'strong', certainty, interval }
  return { judgement: 'unclear', certainty, interval }
}

export type Tagged = RespRow & ItemMeta & {
  timing: TimingClass; reading: Reading | null; verdict: ObsVerdict
  tags: ('correct_guess' | 'slow_correct' | 'confident_mistake' | 'repeated_misconception' | 'changed_answer' | 'interrupted')[]
}

export type Analysis = {
  overall: {
    answered: number; correct: number; scorePercent: number | null; interval: [number, number] | null
    confidence: Record<'low' | 'medium' | 'high' | 'none', { n: number; correct: number }>
    activeMinutes: number; interruptedMinutes: number; changedAnswers: number; flagged: number
  }
  patterns: { correctGuesses: number; slowCorrect: number; confidentMistakes: number; repeatedMisconceptions: number }
  byReading: Cell[]
  bySubject: Cell[]
  byOutcome: Cell[]
  errorTypes: { code: string; count: number }[]
  tagged: Tagged[]
}

function cell(id: string, rows: Tagged[]): Cell {
  const n = rows.length, c = rows.filter(r => r.correct).length
  const mix = (key: (r: Tagged) => string | null) => { const m: Record<string, number> = {}; for (const r of rows) { const k = key(r) ?? 'unset'; m[k] = (m[k] ?? 0) + 1 } return m }
  return { id, questions: n, correct: c, accuracy: n ? c / n : 0, ...judge(c, n), difficultyMix: mix(r => r.difficulty), formMix: mix(r => r.form), cognitionMix: mix(r => r.cognition) }
}

export function analyseAttempt(rows: RespRow[], meta: Map<string, ItemMeta>): Analysis {
  const empty: ItemMeta = { readingId: null, subjectId: null, outcomeId: null, conceptId: null, conceptName: null, difficulty: null, form: null, cognition: null, errorCode: null }

  // Repeated misconception: the same outcome (or the same error type) missed more than once here.
  const wrong = rows.filter(r => !r.correct)
  const wrongByOutcome = new Map<string, number>(), wrongByError = new Map<string, number>()
  for (const r of wrong) {
    const m = meta.get(r.itemId) ?? empty
    if (m.outcomeId) wrongByOutcome.set(m.outcomeId, (wrongByOutcome.get(m.outcomeId) ?? 0) + 1)
    if (m.errorCode) wrongByError.set(m.errorCode, (wrongByError.get(m.errorCode) ?? 0) + 1)
  }

  const tagged: Tagged[] = rows.map(r => {
    const m = meta.get(r.itemId) ?? empty
    const timing = timingClass(r.activeSeconds, r.interruptedSeconds, m.cognition ?? m.form)
    const verdict = observationVerdict(r.correct, r.level)
    const tags: Tagged['tags'] = []
    if (r.correct && r.level === 'low') tags.push('correct_guess')
    if (r.correct && timing === 'slow') tags.push('slow_correct')
    if (!r.correct && r.level === 'high') tags.push('confident_mistake')
    if (!r.correct && ((m.outcomeId && (wrongByOutcome.get(m.outcomeId) ?? 0) > 1) || (m.errorCode && (wrongByError.get(m.errorCode) ?? 0) > 1))) tags.push('repeated_misconception')
    if (r.changedCount > 0) tags.push('changed_answer')
    if (timing === 'untimed_or_interrupted' && r.interruptedSeconds > 0) tags.push('interrupted')
    return { ...r, ...m, timing, verdict, reading: r.level ? readAnswer(r.correct, r.level) : null, tags }
  })

  const group = (key: (t: Tagged) => string | null) => {
    const m = new Map<string, Tagged[]>()
    for (const t of tagged) { const k = key(t); if (k) m.set(k, [...(m.get(k) ?? []), t]) }
    return [...m].map(([id, rs]) => cell(id, rs)).sort((a, b) => a.id.localeCompare(b.id))
  }

  const conf = { low: { n: 0, correct: 0 }, medium: { n: 0, correct: 0 }, high: { n: 0, correct: 0 }, none: { n: 0, correct: 0 } }
  for (const t of tagged) { const k = t.level ?? 'none'; conf[k].n++; if (t.correct) conf[k].correct++ }
  const errs = new Map<string, number>()
  for (const t of tagged) if (!t.correct && t.errorCode) errs.set(t.errorCode, (errs.get(t.errorCode) ?? 0) + 1)

  const answered = tagged.length, correct = tagged.filter(t => t.correct).length
  const sum = (f: (t: Tagged) => number | null) => tagged.reduce((s, t) => s + (f(t) ?? 0), 0)
  return {
    overall: {
      answered, correct, scorePercent: answered ? Math.round((correct / answered) * 100) : null, interval: answered ? wilson(correct, answered) : null,
      confidence: conf, activeMinutes: Math.round(sum(t => t.activeSeconds) / 60), interruptedMinutes: Math.round(sum(t => t.interruptedSeconds) / 60),
      changedAnswers: tagged.filter(t => t.changedCount > 0).length, flagged: tagged.filter(t => t.flagged).length,
    },
    patterns: {
      correctGuesses: tagged.filter(t => t.tags.includes('correct_guess')).length, slowCorrect: tagged.filter(t => t.tags.includes('slow_correct')).length,
      confidentMistakes: tagged.filter(t => t.tags.includes('confident_mistake')).length, repeatedMisconceptions: new Set(tagged.filter(t => t.tags.includes('repeated_misconception')).map(t => t.outcomeId ?? t.errorCode)).size,
    },
    byReading: group(t => t.readingId), bySubject: group(t => t.subjectId), byOutcome: group(t => t.outcomeId),
    errorTypes: [...errs].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count),
    tagged,
  }
}

// ---------------------------------------------------------------------------------------------
// SWOT
// ---------------------------------------------------------------------------------------------

export type OutcomeStatus = { outcomeId: string; readingId: string; subjectId: string; title: string; verdict: ObsVerdict | 'none'; band: string; correctHere: number; askedHere: number }
export type ReadingEdge = { from: string; to: string; kind: 'prerequisite' | 'reinforces' | 'applied_in'; basis: 'concept_link' | 'sequence' }

export type SwotItem = { text: string; outcomeId?: string; readingId?: string; basis: 'evidence' | 'inferred'; support: string }
export type Swot = { strengths: SwotItem[]; weaknesses: SwotItem[]; opportunities: SwotItem[]; threats: SwotItem[]; observedSuccesses: SwotItem[]; toVerify: SwotItem[] }

export function buildSwot(input: { outcomes: OutcomeStatus[]; edges: ReadingEdge[]; readingName: (id: string) => string }): Swot {
  const swot: Swot = { strengths: [], weaknesses: [], opportunities: [], threats: [], observedSuccesses: [], toVerify: [] }
  const tested = input.outcomes.filter(o => o.askedHere > 0)

  for (const o of tested) {
    if (o.verdict === 'secure') swot.strengths.push({ text: o.title, outcomeId: o.outcomeId, readingId: o.readingId, basis: 'evidence', support: 'Confident and correct on repeated, recent questions.' })
    else if (o.verdict === 'concept_miss') swot.weaknesses.push({ text: o.title, outcomeId: o.outcomeId, readingId: o.readingId, basis: 'evidence', support: 'You were sure and wrong — a likely misconception.' })
    else if (o.verdict === 'known_gap') swot.weaknesses.push({ text: o.title, outcomeId: o.outcomeId, readingId: o.readingId, basis: 'evidence', support: 'You suspected the gap and the answer confirmed it.' })
    else if (o.verdict === 'guess') swot.toVerify.push({ text: o.title, outcomeId: o.outcomeId, readingId: o.readingId, basis: 'evidence', support: 'Right, but only a guess — not counted as mastery.' })
    if (o.correctHere > 0 && o.verdict !== 'secure' && o.verdict !== 'concept_miss' && o.verdict !== 'known_gap') {
      swot.observedSuccesses.push({ text: o.title, outcomeId: o.outcomeId, readingId: o.readingId, basis: 'evidence', support: `${o.correctHere} of ${o.askedHere} correct here — an observation, not yet a strength.` })
    }
  }

  const weakReadings = new Set(swot.weaknesses.map(w => w.readingId!).filter(Boolean))
  const strongReadings = new Set(swot.strengths.map(s => s.readingId!).filter(Boolean))
  const seen = new Set<string>()
  // Threats: readings that build on a demonstrated weakness (inferred; not new wrong answers).
  for (const e of input.edges) {
    if (weakReadings.has(e.from) && !weakReadings.has(e.to)) {
      const key = `t:${e.from}>${e.to}`; if (seen.has(key)) continue; seen.add(key)
      swot.threats.push({ text: input.readingName(e.to), readingId: e.to, basis: 'inferred',
        support: `${e.basis === 'concept_link' ? 'It builds on' : 'It follows'} ${input.readingName(e.from)}, where a weakness showed. Inferred from the curriculum's own ${e.basis === 'concept_link' ? 'dependency link' : 'reading order'}; you have not been tested on it here.` })
    }
    // Opportunities: readings that build on something demonstrated (inferred; competence is not assumed).
    if (strongReadings.has(e.from) && !strongReadings.has(e.to) && !weakReadings.has(e.to)) {
      const key = `o:${e.from}>${e.to}`; if (seen.has(key)) continue; seen.add(key)
      swot.opportunities.push({ text: input.readingName(e.to), readingId: e.to, basis: 'inferred',
        support: `${input.readingName(e.from)} held up, and ${input.readingName(e.to)} ${e.basis === 'concept_link' ? 'builds on it' : 'comes next'}. This is a place to try next, not evidence that you already know it.` })
    }
  }
  // Concept links first: they are stronger evidence of dependency than reading order.
  const rank = (i: SwotItem) => (i.support.includes('dependency link') || i.support.includes('builds on it') ? 0 : 1)
  swot.threats.sort((a, b) => rank(a) - rank(b)); swot.opportunities.sort((a, b) => rank(a) - rank(b))
  return swot
}

// ---------------------------------------------------------------------------------------------
// Repair priority
// ---------------------------------------------------------------------------------------------

export type RepairCandidate = { outcomeId: string; readingId: string; title: string; verdict: ObsVerdict | 'none'; repeated: boolean; unseenAvailable: number }
export type RepairItem = { outcomeId: string; readingId: string; title: string; priority: number; reason: string; method: string; retest: { questions: number; independent: true; available: number; note: string } }

const METHOD: Record<string, string> = {
  concept_miss: 'Relearn the rule from your own materials, write a one-page error note, then work fresh questions.',
  known_gap: 'Study the outcome, then close-book recall before any new questions.',
  guess: 'Closed-book recall first, then fresh questions; explain why each wrong option fails.',
}

/** Confident misses first, then repeated gaps, then plain gaps, then guesses. */
export function prioritiseRepairs(cands: RepairCandidate[]): RepairItem[] {
  const score = (c: RepairCandidate) => (c.verdict === 'concept_miss' ? 0 : c.verdict === 'known_gap' ? 2 : c.verdict === 'guess' ? 4 : 9) - (c.repeated ? 1 : 0)
  return cands.filter(c => ['concept_miss', 'known_gap', 'guess'].includes(c.verdict)).sort((a, b) => score(a) - score(b) || a.outcomeId.localeCompare(b.outcomeId)).map((c, i) => {
    const questions = c.verdict === 'guess' ? 2 : 3
    return {
      outcomeId: c.outcomeId, readingId: c.readingId, title: c.title, priority: i + 1,
      reason: c.verdict === 'concept_miss' ? `A confident miss${c.repeated ? ', repeated' : ''} — the highest-priority kind.` : c.verdict === 'known_gap' ? `A gap you suspected${c.repeated ? ' and missed more than once' : ''}.` : 'Right by guess — needs independent verification.',
      method: METHOD[c.verdict] ?? METHOD.known_gap,
      retest: {
        questions: Math.min(questions, Math.max(c.unseenAvailable, 0)) || questions, independent: true, available: c.unseenAvailable,
        note: c.unseenAvailable >= questions ? 'Different, unseen questions after the repair.' : c.unseenAvailable > 0 ? `Only ${c.unseenAvailable} unseen question${c.unseenAvailable === 1 ? '' : 's'} exist for this outcome yet, so the re-check will be short.` : 'The bank has no unseen question for this outcome yet — the re-check waits for more items rather than reusing one you have seen.',
      },
    }
  })
}
