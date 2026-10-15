/**
 * What the Coach may propose, decided by code, not by the model.
 *
 * The model writes the explanation. It never chooses an action: that keeps every change small,
 * checkable and confirmable, and lets a test prove what a given situation produces. Each proposal
 * is executed only after the student confirms it, and only through the same services the Calendar
 * uses.
 */

export type CoachIntent = 'struggling' | 'day_was_bad' | 'redo' | 'next' | 'free'

export function classifyIntent(message: string): CoachIntent {
  const m = message.toLowerCase()
  if (/\b(bad day|rough day|missed (?:today|everything)|couldn'?t study|could not study|no energy|sick|exhausted|day (?:was|went) (?:bad|wrong)|fell apart)\b/.test(m)) return 'day_was_bad'
  if (/\b(keep (?:getting|missing)|struggl|still wrong|don'?t (?:get|understand)|can'?t get|weak(?:est)? (?:area|topic)|why do i (?:keep|always))\b/.test(m)) return 'struggling'
  if (/\b(redo|try again|another go|re-?test|retake|check (?:it|this) again)\b/.test(m)) return 'redo'
  if (/\b(what should i (?:study|do|focus)|what next|next step)\b/.test(m)) return 'next'
  return 'free'
}

export type OpenTask = { id: string; title: string; revision: number; durationMinutes: number }
export type RepairTarget = { outcomeId: string; name: string; readingId: string; subjectId: string; readingLabel: string }

export type CoachSituation = {
  intent: CoachIntent
  today: string
  todayOpen: OpenTask[]
  repairs: RepairTarget[]
  cycle: { start: string; end: string } | null
  /** Planned minutes per date in the active cycle (skipped work excluded). */
  load: Record<string, number>
  paper: 'start' | 'resume' | 'confirm_scope' | 'none' | string
  closing: boolean
}

export type Proposal =
  | { kind: 'defer_today'; title: string; reasoning: string; changes: { tasks: { id: string; title: string; revision: number }[] } }
  | { kind: 'recheck_block'; title: string; reasoning: string; changes: { outcomeId: string; outcomeName: string; readingId: string; date: string; durationMinutes: number } }

export type CoachLink = { label: string; href: string }

export const RECHECK_MINUTES = 30
/** A day already carrying this much is not asked to take more from the Coach. */
export const FULL_DAY_MINUTES = 240
const MAX_DEFER = 6

const addDays = (d: string, n: number) => new Date(new Date(`${d}T12:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10)

/** The lightest day after today, inside the cycle, that still has room. */
export function pickRecheckDate(s: Pick<CoachSituation, 'today' | 'cycle' | 'load'>): string | null {
  if (!s.cycle) return null
  let best: { date: string; load: number } | null = null
  for (let d = addDays(s.today, 1); d <= s.cycle.end; d = addDays(d, 1)) {
    const load = s.load[d] ?? 0
    if (load >= FULL_DAY_MINUTES) continue
    if (!best || load < best.load) best = { date: d, load }
  }
  return best?.date ?? null
}

export function planProposals(s: CoachSituation): { proposals: Proposal[]; notes: string[] } {
  const proposals: Proposal[] = []
  const notes: string[] = []

  if (s.intent === 'day_was_bad') {
    if (s.todayOpen.length === 0) notes.push('Nothing is left open today, so there is nothing to move.')
    else {
      const tasks = s.todayOpen.slice(0, MAX_DEFER).map(t => ({ id: t.id, title: t.title, revision: t.revision }))
      proposals.push({
        kind: 'defer_today',
        title: `Move ${tasks.length} open task${tasks.length === 1 ? '' : 's'} off today`,
        reasoning: 'Marks them deferred and lets the week spread them over the days that still have room. Nothing is deleted, and you can undo each one from Calendar.',
        changes: { tasks },
      })
    }
  }

  if (s.intent === 'struggling' || s.intent === 'redo') {
    const target = s.repairs[0]
    if (!target) notes.push('No outcome currently shows as a repair, so there is no specific re-check to propose.')
    else {
      const date = pickRecheckDate(s)
      if (!date) notes.push('There is no day left in this week with room for another block, so I am not adding one. The review at the end of the week can carry it over.')
      else {
        proposals.push({
          kind: 'recheck_block',
          title: `Add a ${RECHECK_MINUTES}-minute re-check on ${target.name}`,
          reasoning: `Your results mark this outcome as needing repair. Work it from your own materials, then the paper re-tests it. I picked ${date} because it is the lightest remaining day.`,
          changes: { outcomeId: target.outcomeId, outcomeName: target.name, readingId: target.readingId, date, durationMinutes: RECHECK_MINUTES },
        })
      }
    }
  }
  return { proposals, notes }
}

/** Links carry no change; they simply take the student to the place the answer lives. */
export function planLinks(s: CoachSituation): CoachLink[] {
  const links: CoachLink[] = []
  if (s.closing) links.push({ label: 'Review the week', href: '/app/review-week' })
  if (s.paper === 'resume') links.push({ label: 'Resume your paper', href: '/app/tests' })
  else if (s.paper === 'start' || s.paper === 'confirm_scope') links.push({ label: 'Go to this week’s paper', href: '/app/tests' })
  const r = s.repairs[0]
  if (r && (s.intent === 'struggling' || s.intent === 'redo' || s.intent === 'next')) links.push({ label: `Open ${r.readingLabel}`, href: `/app/curriculum/${r.subjectId}/${r.readingId}` })
  if (s.intent === 'day_was_bad' || s.intent === 'next') links.push({ label: 'Open the week', href: '/app/calendar' })
  return links.slice(0, 3)
}

/**
 * A reply that needs no model. Used for the quick intents and as the fallback when generation is
 * unavailable. It states only what the evidence shows, and says so when it shows little.
 */
export function deterministicReply(s: CoachSituation, band: string, notes: string[], proposals: Proposal[]): string {
  const parts: string[] = []
  if (s.intent === 'day_was_bad') {
    parts.push('A bad day is not a wrong answer, and it does not count against your understanding.')
  } else if (s.intent === 'struggling' || s.intent === 'redo') {
    const r = s.repairs[0]
    parts.push(r
      ? `The clearest weak point in your results is “${r.name}” (${r.readingLabel}). Re-read it from your own materials, then let a paper re-test it — a re-check is what tells us whether it held.`
      : 'Your results do not yet single out one weak outcome. A scored paper is what would show it.')
  } else {
    parts.push(band === 'Insufficient evidence'
      ? 'There is not enough scored evidence yet to say what is strong or weak, so the next useful step is the one that produces evidence: this week’s paper.'
      : `Your current evidence reads “${band}”. Work the repair outcomes first, then new material.`)
  }
  if (proposals.length) parts.push('I have suggested a change below. Nothing happens until you confirm it.')
  for (const n of notes) parts.push(n)
  return parts.join(' ')
}
