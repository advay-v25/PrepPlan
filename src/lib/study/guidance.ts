/**
 * Study-method guidance (pure). One place that turns the signal a student's own work produced into a practical way to act on it,
 * using THEIR materials. Every recommendation names: the curriculum scope, why now, the activity, what completion means and what to
 * log or verify afterwards. It keeps three things apart that are easy to blur: what was OBSERVED (a miss, a slow answer), a POSSIBLE
 * EXPLANATION (a hypothesis, said as one) and what the student SAID about their own certainty.
 *
 * It never teaches content and never invents a source location: `resource` is a category unless the curriculum itself names the
 * reading (then it points at that reading).
 */
export type GuidanceSignal = 'fragile_correct' | 'misconception' | 'slow_correct' | 'missed_session' | 'untested'

export type GuidanceInput = {
  signal: GuidanceSignal
  /** The curriculum scope in the student's terms: an outcome or reading title. */
  scope: string
  /** A verified curriculum reference when one exists (e.g. "Reading 28"). Otherwise a resource category is named instead. */
  reading?: { label: string; href: string } | null
  /** What the evidence recorded, in plain words ("answered wrongly while sure"). Observed, not interpreted. */
  observed?: string | null
  /** The distractor's recorded diagnosis, offered as a POSSIBLE explanation only. */
  possibleCause?: string | null
  /** How many questions this rests on. */
  observations?: number
  /** Minutes the missed session was meant to take (recovery only). */
  minutes?: number
}

export type Guidance = {
  scope: string
  /** Why this matters now, with its evidential strength stated. */
  why: string
  /** What to do, with the student's own materials. */
  activity: string
  completion: string
  /** What to log or verify afterwards. */
  verify: string
  /** A verified curriculum reference, or the category of resource to use. */
  resource: { kind: 'curriculum_reference'; label: string; href: string } | { kind: 'category'; label: string }
}

const support = (n?: number) => (n === undefined ? '' : n === 1 ? ' This rests on one question, so treat it as a hint.' : ` This rests on ${n} questions.`)

export function studyGuidance(i: GuidanceInput): Guidance {
  const resource: Guidance['resource'] = i.reading
    ? { kind: 'curriculum_reference', label: i.reading.label, href: i.reading.href }
    : { kind: 'category', label: 'your course notes or the curriculum text you already use' }
  const base = { scope: i.scope, resource }
  switch (i.signal) {
    case 'fragile_correct':
      return { ...base,
        why: `You answered this correctly but said you were not sure. That is provisional evidence, not a gap.${support(i.observations)}`,
        activity: 'Close the notes and write the rule or method from memory, then check it against your notes. Do one worked example without looking, then mark where you hesitated.',
        completion: 'You can state the rule and finish one example unaided.',
        verify: 'Take a fresh check on this outcome. Log whether the hesitation went away; a fresh correct, confident answer is what turns this into evidence.' }
    case 'misconception':
      return { ...base,
        why: `You answered wrongly while sure${i.observed ? ` (${i.observed})` : ''}. That pattern can mean a misconception rather than a slip.${i.possibleCause ? ` A possible explanation, not a finding: ${i.possibleCause}.` : ''}${support(i.observations)}`,
        activity: 'In your own notes, put the two cases side by side: the one you chose and the one that was right. Write one sentence on what differs, then redo one example of each from your materials.',
        completion: 'You can say why the two cases differ and work one example of each correctly.',
        verify: 'Re-check with different questions after the repair. If the same error appears again, log it; a repeat is stronger evidence than the first miss.' }
    case 'slow_correct':
      return { ...base,
        why: `You were correct but slower than the usual pace for this kind of question. That is a possible timing issue, separate from understanding.${support(i.observations)}`,
        activity: 'Do a short timed set on this scope: apply the method under a time limit, then review only the questions where time ran short and note which step cost the time.',
        completion: 'You finished the set inside the time and know which step to speed up.',
        verify: 'Log the time per question. Timed practice is practice: it does not change your understanding signal or close a repair.' }
    case 'missed_session':
      return { ...base,
        why: 'The session did not happen. A missed session is not a wrong answer and says nothing about what you understand.',
        activity: `Pick the next free slot${i.minutes ? ` of about ${i.minutes} minutes` : ''} and do the first part of the same scope, in your own materials, before adding anything new.`,
        completion: 'You studied this scope for the planned time, or marked what you covered.',
        verify: 'Mark the task done or partly done so the plan and your test scope stay accurate.' }
    default:
      return { ...base,
        why: 'This scope has not been tested yet, so there is no evidence either way.',
        activity: 'Study it from your own materials, then say what you covered when you log it.',
        completion: 'You covered the scope and confirmed which outcomes it included.',
        verify: 'Once it is complete and confirmed, a paper can test it.' }
  }
}

/** One compact paragraph for a task's description. */
export const guidanceText = (g: Guidance) => `${g.activity} Done when: ${g.completion} Afterwards: ${g.verify}`
