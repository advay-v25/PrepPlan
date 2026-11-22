import { observationVerdict, type Level, type ObsVerdict } from '../curriculum/confidence'
import { timingClass, readAnswer, type TimingClass, type Reading } from './attemptTiming'
import { studyGuidance, type Guidance } from '../study/guidance'

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
/** `concept_link` = a curated, verified relationship (it carries a written rationale). `sequence` = reading order only: navigation, never a prerequisite or a prediction. */
export type ReadingEdge = { from: string; to: string; kind: 'prerequisite' | 'reinforces' | 'applied_in'; basis: 'concept_link' | 'sequence'; rationale?: string | null }

export type SwotItem = { text: string; outcomeId?: string; readingId?: string; basis: 'evidence' | 'inferred'; support: string }
export type Swot = { strengths: SwotItem[]; weaknesses: SwotItem[]; opportunities: SwotItem[]; threats: SwotItem[]; observedSuccesses: SwotItem[]; toVerify: SwotItem[]; navigation: SwotItem[] }

export function buildSwot(input: { outcomes: OutcomeStatus[]; edges: ReadingEdge[]; readingName: (id: string) => string }): Swot {
  const swot: Swot = { strengths: [], weaknesses: [], opportunities: [], threats: [], observedSuccesses: [], toVerify: [], navigation: [] }
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
  const why = (e: ReadingEdge) => (e.rationale ? ` ${e.rationale}` : '')
  for (const e of input.edges) {
    if (e.basis === 'sequence') {
      // Reading order helps navigation only. It cannot establish a prerequisite or predict a weakness.
      if (strongReadings.has(e.from) && !strongReadings.has(e.to) && !weakReadings.has(e.to)) {
        const key = `n:${e.from}>${e.to}`; if (seen.has(key)) continue; seen.add(key)
        swot.navigation.push({ text: input.readingName(e.to), readingId: e.to, basis: 'inferred', support: `Comes after ${input.readingName(e.from)} in the curriculum order. This only helps you find it; it does not mean it depends on it.` })
      }
      continue
    }
    // Threats: readings that depend on a demonstrated weakness through a verified curriculum link (not new wrong answers).
    if (weakReadings.has(e.from) && !weakReadings.has(e.to) && e.kind !== 'reinforces') {
      const key = `t:${e.from}>${e.to}`; if (seen.has(key)) continue; seen.add(key)
      swot.threats.push({ text: input.readingName(e.to), readingId: e.to, basis: 'inferred',
        support: `It ${e.kind === 'applied_in' ? 'applies' : 'builds on'} ${input.readingName(e.from)}, where a weakness showed.${why(e)} Worth watching; you have not been tested on it here.` })
    }
    // Opportunities: related applications of something demonstrated, to check next (competence is not assumed).
    if (strongReadings.has(e.from) && !strongReadings.has(e.to) && !weakReadings.has(e.to)) {
      const key = `o:${e.from}>${e.to}`; if (seen.has(key)) continue; seen.add(key)
      swot.opportunities.push({ text: input.readingName(e.to), readingId: e.to, basis: 'inferred',
        support: `${input.readingName(e.from)} held up, and ${input.readingName(e.to)} ${e.kind === 'reinforces' ? 'reinforces it' : e.kind === 'applied_in' ? 'applies it' : 'builds on it'}.${why(e)} A place to check next, not evidence that you already know it.` })
    }
  }
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

// ---------------------------------------------------------------------------------------------
// Findings and the next action
// ---------------------------------------------------------------------------------------------

export type FindingKind = 'misconception' | 'provisional' | 'timing' | 'omitted' | 'interrupted'
export type FindingAction = 'repair' | 'fresh_check' | 'timed_practice' | 'pending' | 'none'
export type Finding = {
  kind: FindingKind
  title: string
  /** What the pattern does and does not show. */
  interpretation: string
  /** How many questions this finding rests on. One observation is stated as one observation. */
  observations: number
  outcomeIds: string[]
  action: FindingAction
  /** What to do about it, in plain words. */
  response: string
  /** Practical study method for the student's own materials; observed, possible and self-reported kept apart. */
  guidance?: Guidance
  /** Timing finding only: an explicit reading scope for timed practice, and whether the shared decision allows it now. */
  practice?: { readingId: string; outcomeIds: string[]; state: string; deliverable: number; minutes: number; message: string | null } | null
}

const support = (n: number) => `Based on ${n} question${n === 1 ? '' : 's'}${n === 1 ? ' — a second would confirm or clear it' : ''}.`

/**
 * The four patterns, each with its own meaning and response (pure):
 *  - correct but uncertain  → provisional evidence; a fresh check;
 *  - incorrect and confident → possible misconception, grounded in the chosen distractor's recorded diagnosis;
 *  - repeatedly correct but slow → a possible timing issue, separate from concept repair;
 *  - unanswered / interrupted → recorded as omissions or interruptions; the conceptual cause stays unknown.
 */
export function buildFindings(input: {
  tagged: Tagged[]
  /** Distractor evidence per item (the diagnosis of the option the student chose), when the item has one. */
  distractor: (itemId: string) => { label: string | null; description: string | null } | null
  outcomeTitle: (id: string) => string
  omitted: { itemId: string; outcomeId: string | null }[]
}): Finding[] {
  const out: Finding[] = []
  const group = (rows: Tagged[]) => { const m = new Map<string, Tagged[]>(); for (const r of rows) { const k = r.outcomeId ?? '(unmapped)'; m.set(k, [...(m.get(k) ?? []), r]) } return m }

  for (const [oid, rows] of group(input.tagged.filter(t => t.tags.includes('confident_mistake')))) {
    const ev = rows.map(r => input.distractor(r.itemId)).find(d => d && (d.description || d.label))
    out.push({
      kind: 'misconception', title: oid === '(unmapped)' ? 'A confident mistake on an unmapped question' : input.outcomeTitle(oid), outcomeIds: oid === '(unmapped)' ? [] : [oid], observations: rows.length,
      interpretation: `Possible misconception: you were sure and wrong. ${ev ? `The option you chose points to ${ev.label ?? 'a specific error'}${ev.description ? ` — ${ev.description}` : ''}. ` : ''}${support(rows.length)}`,
      action: 'repair', response: 'Preview targeted repair work, then re-check with different questions.',
      guidance: studyGuidance({ signal: 'misconception', scope: oid === '(unmapped)' ? 'this question’s topic' : input.outcomeTitle(oid), observed: 'sure, and wrong', possibleCause: ev?.description ?? null, observations: rows.length }),
    })
  }
  for (const [oid, rows] of group(input.tagged.filter(t => t.tags.includes('correct_guess')))) {
    out.push({
      kind: 'provisional', title: oid === '(unmapped)' ? 'Correct but unsure' : input.outcomeTitle(oid), outcomeIds: oid === '(unmapped)' ? [] : [oid], observations: rows.length,
      interpretation: `Correct but uncertain: provisional evidence, not counted as mastery. ${support(rows.length)}`,
      action: 'fresh_check', response: 'Check it again with fresh questions you have not seen.',
      guidance: studyGuidance({ signal: 'fragile_correct', scope: oid === '(unmapped)' ? 'this question’s topic' : input.outcomeTitle(oid), observations: rows.length }),
    })
  }
  const slow = input.tagged.filter(t => t.tags.includes('slow_correct'))
  const slowByOutcome = [...group(slow)].filter(([, r]) => r.length >= 2)
  if (slow.length >= 3 || slowByOutcome.length > 0) {
    out.push({
      kind: 'timing', title: 'Correct, but slow', outcomeIds: [...new Set(slow.flatMap(t => t.outcomeId ? [t.outcomeId] : []))], observations: slow.length,
      interpretation: `Repeatedly correct but slow: a possible timing issue, not a concept gap. Slow time is judged against each question's own type. ${support(slow.length)}`,
      action: 'timed_practice', response: 'Practise these under a time limit, separately from concept repair.',
      guidance: studyGuidance({ signal: 'slow_correct', scope: 'the questions you answered correctly but slowly', observations: slow.length }),
    })
  }
  if (input.omitted.length > 0) {
    out.push({
      kind: 'omitted', title: 'Not answered', outcomeIds: [...new Set(input.omitted.flatMap(o => o.outcomeId ? [o.outcomeId] : []))], observations: input.omitted.length,
      interpretation: `${input.omitted.length} question${input.omitted.length === 1 ? ' was' : 's were'} left unanswered, so there is no confidence for ${input.omitted.length === 1 ? 'it' : 'them'}. The omission is recorded; why it happened is unknown, and it is not counted as a wrong answer.`,
      action: 'pending', response: 'These outcomes stay untested until a later paper.',
    })
  }
  const interrupted = input.tagged.filter(t => t.tags.includes('interrupted'))
  if (interrupted.length > 0) {
    out.push({
      kind: 'interrupted', title: 'Interrupted time', outcomeIds: [], observations: interrupted.length,
      interpretation: `Time was interrupted on ${interrupted.length} question${interrupted.length === 1 ? '' : 's'}. Interrupted time is not held against you and does not change what the answer shows.`,
      action: 'none', response: 'No action needed.',
    })
  }
  return out
}

export type NextAction = { kind: 'repair' | 'fresh_check' | 'timed_practice' | 'further_paper' | 'continue'; title: string; why: string; cta: string; href: string }

/** The single most useful next step, in order of value. Detailed analysis sits behind it. */
export function chooseNextAction(input: { findings: Finding[]; repairCount: number; furtherPaper: boolean; hasRepairOpen: boolean }): NextAction {
  const f = (k: FindingKind) => input.findings.find(x => x.kind === k)
  const mis = input.findings.filter(x => x.kind === 'misconception')
  if (input.repairCount > 0 || mis.length > 0) {
    const n = Math.max(input.repairCount, mis.length)
    return { kind: 'repair', title: `Plan repair work for ${n} area${n === 1 ? '' : 's'}`, why: 'These are genuine gaps or confident mistakes. Preview the work, the days it would take and what it would displace, then confirm only if it fits.', cta: 'Preview repair work', href: '#proposal-h' }
  }
  if (f('provisional')) return { kind: 'fresh_check', title: 'Check the uncertain answers again', why: 'You were right but unsure, which is provisional evidence. A fresh check turns it into evidence or shows a gap.', cta: 'See what to re-check', href: '#findings-h' }
  if (f('timing')) return { kind: 'timed_practice', title: 'Add some timed practice', why: 'You were correct but slow on several questions. That is a speed question, separate from understanding.', cta: 'See the timing finding', href: '#findings-h' }
  if (input.furtherPaper) return { kind: 'further_paper', title: 'Cover the rest of this week’s scope', why: 'Some confirmed outcomes were not asked in this paper. A further paper uses different questions.', cta: 'See what is untested', href: '#scope-h2' }
  return { kind: 'continue', title: 'Nothing urgent — continue your plan', why: 'No gap or confident mistake showed in this paper. Keep to your Calendar and widen the scope of the next paper rather than re-testing what held.', cta: 'Open Calendar', href: '/app/calendar' }
}
