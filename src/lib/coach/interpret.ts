import type { CoachIntent } from './actions'

/**
 * Deterministic interpretation of a student's message. The ORIGINAL text is never changed; a separate normalised copy is read.
 * Recognises negation ("I haven't missed today"), hypotheticals, corrections and mixed requests (planning part + a teaching part).
 * Numbers, dates and ids are never "corrected". A bounded model interpreter, when added, has to return this same shape and is
 * validated against it; it cannot return an endpoint, an owner or a change.
 */
export const INTERPRETER_VERSION = 'coach-interpret-2026-11-16.1'

/** Word-level app-term fixes only. Digits and ids are left alone by construction (the keys are letters). */
const WORD_FIXES: Record<string, string> = {
  msised: 'missed', mised: 'missed', missd: 'missed', mised_: 'missed',
  tday: 'today', todya: 'today', '2day': 'today', tdy: 'today',
  tmrw: 'tomorrow', tmrrw: 'tomorrow', tommorow: 'tomorrow', tomorow: 'tomorrow', tmr: 'tomorrow',
  calender: 'calendar', calandar: 'calendar', calendr: 'calendar',
  repln: 'replan', replam: 'replan', pls: 'please', plz: 'please', abt: 'about', wk: 'week', wat: 'what', shud: 'should',
  u: 'you', ur: 'your', cant: "can't", dont: "don't", didnt: "didn't", havent: "haven't", wont: "won't", isnt: "isn't", whats: "what's", doesnt: "doesn't",
  // class-logging wording: unambiguous in this domain, so a typo of "attended" or "class" still reads as a class report
  attnded: 'attended', atended: 'attended', attened: 'attended', attendd: 'attended', atnded: 'attended', clas: 'class', clss: 'class', cls: 'class', clases: 'classes',
  yestrday: 'yesterday', yesterdy: 'yesterday', yday: 'yesterday', yestarday: 'yesterday',
  studdy: 'study', studing: 'studying', revison: 'revision', schedual: 'schedule', schedul: 'schedule',
}

export function normalise(message: string): string {
  const s = message.normalize('NFKC').replace(/[‘’ʼ`]/g, "'").replace(/[“”]/g, '"').toLowerCase().replace(/\s+/g, ' ').trim()
  // Identifier-like tokens (hyphens, underscores, digits) are never corrected: "task-tdy" stays exactly as typed.
  return s.replace(/[a-z0-9_'-]+/g, w => /[-_]/.test(w) ? w : (WORD_FIXES[w] ?? w))
}

const NEGATOR = /\b(?:not|never|no|haven't|have not|hasn't|didn't|did not|don't|do not|isn't|wasn't|without)\b/
const HYPOTHETICAL = /\b(?:if|in case|what if|suppose|should i ever|in future)\b/

/** A trigger is negated or hypothetical when the same clause, before it, carries a negator or an "if". */
function qualified(m: string, index: number): 'negated' | 'hypothetical' | null {
  const clause = m.slice(0, index).split(/[;.,?!]/).pop() ?? ''
  const near = clause.split(' ').slice(-5).join(' ')
  if (NEGATOR.test(near)) return 'negated'
  if (HYPOTHETICAL.test(clause)) return 'hypothetical'
  return null
}

const MISSED = /\bmiss(?:ed)? (?:today|everything|the day|it|all (?:my )?(?:study|tasks|blocks)|my (?:study|blocks?|tasks?|sessions?))\b|\b(?:bad day|rough day|couldn'?t study|could not study|no energy|exhausted|fell apart|day (?:was|went) (?:bad|wrong)|(?:today|the day) (?:went|was|is|has been) (?:badly|bad|terrible|awful|rough)|(?:am|was|feel(?:ing)?) sick)\b|\bnahi (?:padh|study)|\bmiss ho gaya\b/g

/** Only statements about what the student did or wants done can be negated; a question ("I don't know what to study") keeps its meaning. */
const REPORTS: CoachIntent[] = ['day_was_bad', 'move_block', 'log_class', 'log_learning', 'exam', 'availability']

type Rule = { intent: CoachIntent; re: RegExp }
/** Order is priority for the PRIMARY intent; every matched intent is still reported. */
const RULES: Rule[] = [
  { intent: 'move_block', re: /\b(?:move|push|postpone|reschedule|shift|defer|delay)\b.{0,40}\b(?:it|this|that|block|task|session|one|study)\b|\b(?:move|push|postpone|reschedule|shift|defer|delay)\b.{0,20}\b(?:to|until|till) (?:tomorrow|next week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/ },
  { intent: 'today', re: /\bwhat (?:should|do|can) i (?:do|study|work on) today\b|\bwhat'?s (?:on )?(?:for )?today\b|\btoday'?s (?:plan|task)\b|\bwhat (?:do|should) i do now\b|\baaj kya\b/ },
  { intent: 'mock', re: /\b(?:mocks?|checkpoint|practice exam|trial exam)\b/ },
  { intent: 'availability', re: /\b(?:availability|my hours|work(?:ing)? (?:hours|shifts?)|new job|less time|more time|schedule (?:has )?changed|can'?t study on|no longer (?:free|available)|travel(?:l?ing)?|trip)\b|\bi (?:now )?work (?:on )?(?:mon|tue|wed|thu|fri|sat|sun)/ },
  { intent: 'log_class', re: /\b(?:log|record|add|had|attended)\b.{0,25}\b(?:class|lecture|session with)\b|\b(?:class|lecture)\b.{0,25}\b(?:moved|changed|rescheduled|cancel(?:l?ed)?|today|yesterday)\b/ },
  { intent: 'log_learning', re: /\b(?:log|record|add)\b.{0,25}\b(?:studying|study|learning|reading|self.?study)\b|\bi (?:studied|read|covered|finished)\b/ },
  { intent: 'exam', re: /\b(?:when is (?:my |the )?exam|exam date|exam target|booked (?:my )?exam|i (?:sat|took|wrote) (?:the )?exam|exam (?:window|moved|postponed)|reschedule (?:the |my )?exam)\b/ },
  { intent: 'lighter', re: /\bi(?:'m| am) (?:so |way |really |far )?behind\b|\b(?:fell|falling|got) behind\b|\bcatch(?:ing)? up\b|\bget back on track\b|\brecovery (?:plan|path|options?)\b|\b(?:lighter|smaller|shorter|fewer|less work)\b.*\bweek\b|\bweek\b.*\b(?:lighter|smaller|shorter)\b/ },
  { intent: 'slow', re: /\b(?:slow|too long|run out of time|running out of time|timing|speed)\b/ },
  { intent: 'result', re: /\b(?:my|the|this|that|latest|last) (?:result|score|paper)s?\b/ },
  { intent: 'struggling', re: /\b(?:keep (?:getting|missing)|struggl|still wrong|don'?t (?:get|understand)|can'?t get|weak(?:est)? (?:area|topic)|why do i (?:keep|always))\b/ },
  { intent: 'redo', re: /\b(?:redo|try again|another go|re-?test|retake|check (?:it|this) again)\b/ },
  { intent: 'next', re: /\bwhat should i (?:study|do|focus|work on)\b|\bwhat(?:'s| is)? next\b|\bnext step\b|\bkya padh|\b(?:need|want|make|build|give me) (?:a |my )?(?:revision |study )?(?:plan|schedule|routine)\b/ },
]

/**
 * A STATEMENT about where preparation stands ("I finished the syllabus and revised it once", "first pass done", "I haven't finished revision"). It is context for
 * planning, not a request to teach, not a request to log a sitting and never an edit: coverage and revision status are changed only in their own editor.
 */
const PREP_CONTEXT = /\b(?:(?:finished|completed|done with|covered|wrapped up) (?:all of |all |the |my )*(?:whole |entire |full )?(?:syllabus|curriculum|first pass|readings|chapters|topics)|first pass (?:is |was |has been )?(?:done|complete|finished|over)|(?:gone|been|went|worked|read|worked) (?:right )?through (?:all of |all |every |each |the whole |the entire |the full )?(?:reading|readings|chapter|chapters|topic|topics|syllabus|curriculum)|(?:revisited|revised|reviewed|gone over|covered) (?:everything|it all|all of it|every (?:reading|topic|chapter))|(?:finished|completed|done with) (?:my |the )?(?:first )?revision|revis(?:ed|ion) (?:it |everything |all of it )?(?:once|twice|thrice|\d+ times|is done|done|complete|finished)|(?:revised|reviewed) (?:it |everything |all of it )?(?:once|twice|\d+ times))\b/
export const LOG_VERB = /\b(?:log|record|add|enter|note down)\b/

/** What a student can legitimately ask about how to study: methods and app use, not curriculum content. */
const PLAN_OBJECT = /\b(?:organi[sz]e|plan|revis(?:e|ion)|study|studying|prioriti[sz]e|schedule|manage|approach|structure|track|use (?:the )?(?:calendar|app|roadmap|tests?|coach|curriculum|notes)|calendar|roadmap|spaced|retrieval|rotation)\b/
const OWN_STATE = /\b(?:my|this|the|our) (?:week|plan|schedule|calendar|result|score|paper|task|block|proposal|repair|revision|mock|session|draft|progress)\b|\bwhy (?:is|did|was|has) (?:my|the|this)\b/
const NEG_TEACH = /(?:don'?t|do not|no need to|not asking you to|not here to|stop trying to|instead of|rather than)\b[^.;?!]{0,40}$/

/**
 * A request to TEACH curriculum content. "Teach me how to use Calendar", "teach me how to organise my revision" and
 * "explain why my week is lighter" are planning/app help; "teach me derivatives" and "explain the WACC formula" are not.
 */
const CALC_REQUEST = /\b(?:how (?:do|can|should|would) (?:i|we|you) (?:calculate|compute|derive|solve|price|value|discount|find the)|how (?:to|is) (?:calculate|compute|derive|solve|price|value)\w*|what(?:'s| is) the (?:formula|equation|answer) (?:for|to|of)|(?:calculate|compute|work out) (?:the |this |my )?(?:duration|wacc|npv|irr|yield|ytm|convexity|beta|ratio|value|price|return)\b)/

/** Study-method / app-use wording ("how to organise my revision"). A model exclusion that is plainly this is dropped, never refused. */
export const isMethodHelp = (m: string) => PLAN_OBJECT.test(m) && !/\b(?:calculate|compute|derive|solve|price|value|discount|find the)\b/.test(m)

export function teachingComponent(m: string): boolean {
  if (CALC_REQUEST.test(m) && !NEG_TEACH.test(m.slice(0, CALC_REQUEST.exec(m)!.index))) return true
  const re = /\b(teach me|teach us|tutor me|explain|solve|walk me through|derive|show me how to (?:calculate|solve|derive))\b/g
  for (let x = re.exec(m); x; x = re.exec(m)) {
    if (NEG_TEACH.test(m.slice(0, x.index + x[0].length))) continue
    const rest = m.slice(x.index + x[0].length).split(/[;.?!]/)[0].trim()
    if (!rest) continue
    if (x[1] === 'explain' || x[1] === 'walk me through') { if (OWN_STATE.test(rest) || /^(?:why|how) (?:my|the|this|do i|should i|to use)\b/.test(rest) || /\b(?:to use|how roadmap|how (?:the )?(?:app|calendar|coach|tests?) )/.test(rest)) continue }
    const how = /^how (?:to|do i|can i|should i)\s+(.*)$/.exec(rest)
    if (how) { if (PLAN_OBJECT.test(how[1]) && !/\b(?:calculate|compute|derive|solve|price|value|discount|find the)\b/.test(how[1])) continue; return true }
    if (/^(?:me )?(?:to )?(?:organi[sz]e|plan|revise|prioriti[sz]e|schedule)\b/.test(rest)) continue
    if (/^(?:the )?(?:app|calendar|roadmap|coach|tests?)\b/.test(rest)) continue
    return true
  }
  return false
}

export type Interpretation = {
  version: string
  normalised: string
  /** Matched planning intents, primary first. Never contains 'teach' or 'free'. */
  intents: CoachIntent[]
  primary: CoachIntent
  /** The message also asks to be taught curriculum content: that part is declined, the rest is answered. */
  teaching: boolean
  /** Intents the student negated ("I haven't missed today") or posed as a hypothetical. They must not drive an action. */
  negated: CoachIntent[]
  /** True when the student corrects an earlier reading ("no, I didn't miss it"). */
  correction: boolean
  /** Model-reported exclusions our own grammar did NOT confirm. They are kept (never silently dropped) but never refuse planning help: the reply says what was left unanswered and offers the planning reading. */
  exclusions?: { kind: 'teaching' | 'other'; span: string | null }[]
  /** The message states where their preparation stands. Acknowledged and used for planning; never recorded as a coverage or revision edit. */
  preparation?: boolean
  /** A date word the student gave (kept as text; the planner decides the actual placement). */
  when: string | null
}

export function interpret(message: string): Interpretation {
  const m = normalise(message)
  const hits = new Map<CoachIntent, number>()
  const negated: CoachIntent[] = []
  const consider = (intent: CoachIntent, re: RegExp) => {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')
    for (let x = g.exec(m); x; x = g.exec(m)) {
      if (REPORTS.includes(intent) && qualified(m, x.index)) { if (!negated.includes(intent)) negated.push(intent); continue }
      if (!hits.has(intent)) hits.set(intent, x.index)
    }
  }
  consider('day_was_bad', MISSED)
  for (const r of RULES) consider(r.intent, r.re)
  // The day belongs to the requested action. A reason ("because I am busy today", "today is full") is not the target.
  const requested = m.replace(/\b(?:because|since|cos|coz|as)\b[^;.?!]*/g, ' ').replace(/\b(?:i am|i'm|im|am) (?:busy|booked|away|working|out)(?: (?:today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday))?\b/g, ' ')
    .replace(/\b(?:today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:'s)? (?:is|was|looks) (?:busy|full|packed|hectic|booked)\b/g, ' ')
  const MON = 'jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec'
  const DAY = `(next (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|tomorrow|today|next week|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\\d{4}-\\d{2}-\\d{2}|\\d{1,2}(?:st|nd|rd|th)? (?:${MON})[a-z]*|(?:${MON})[a-z]* \\d{1,2}(?:st|nd|rd|th)?)`
  const notDay = new RegExp(`\\bnot ${DAY}\\b`).exec(requested)?.[1]
  const dayWords = [...requested.matchAll(new RegExp(`\\b${DAY}(?!'s (?:block|task|session))\\b`, 'g'))].map(d => d[1]).filter(d => d !== notDay)
  const dated = /\bmove\b[^;.?!]*\b(?:friday|monday|tuesday|wednesday|thursday|saturday|sunday)'s\b/.test(requested) && /\binstead\b/.test(requested)
  // An exact clock time ("at 7pm", "19:00", "7:30 am"). A bare number is never read as a time.
  const tm = /\b(?:at |@ ?)?(\d{1,2})(?::([0-5]\d))?\s?(am|pm)\b|\b(?:at )?([01]?\d|2[0-3]):([0-5]\d)\b/.exec(requested.replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' '))
  let clockTime: string | null = null
  if (tm) {
    let h = tm[1] !== undefined ? Number(tm[1]) : Number(tm[4]); const mi = tm[1] !== undefined ? Number(tm[2] ?? 0) : Number(tm[5])
    if (tm[3]) { if (h < 1 || h > 12) h = -1; else h = (h % 12) + (tm[3] === 'pm' ? 12 : 0) }
    if (h >= 0 && h < 24) clockTime = `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`
  }
  const day: string | null = dated ? null : (dayWords.pop() ?? (/\bkal\b/.test(requested) ? 'kal' : null))
  const when: string | null = clockTime ? `${day ?? ''}@${clockTime}` : day
  // A first-person completion statement about the whole syllabus or revision is context, not a "log my study" request.
  const preparation = PREP_CONTEXT.test(m)
  if (preparation && !LOG_VERB.test(m)) { hits.delete('log_learning'); const k = negated.indexOf('log_learning'); if (k >= 0) negated.splice(k, 1) }
  const ordered = [...hits.keys()]
  const priority: CoachIntent[] = ['day_was_bad', ...RULES.map(r => r.intent)]
  ordered.sort((a, b) => priority.indexOf(a) - priority.indexOf(b))
  const teaching = teachingComponent(m)
  const correction = negated.includes('day_was_bad') && /^(?:no|nope|nah)\b|\bi (?:haven't|didn't|did not|have not)\b/.test(m)
  let primary: CoachIntent = ordered[0] ?? (teaching ? 'teach' : preparation ? 'next' : 'free')
  if (!ordered.length && correction) primary = 'today'
  return { version: INTERPRETER_VERSION, normalised: m, intents: ordered, primary, teaching, negated, correction, preparation, when }
}
