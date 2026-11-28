/**
 * The one catch-up and recovery status (pure). Home, Calendar, the Roadmap and Coach read this; none recomputes it.
 *
 * It keeps four things apart: ACCEPTED work (the plan), COMMITMENTS (the time the student can give), ACTUAL minutes (logged completion) and the GAP
 * between them. The gap is the unfinished accepted work that is still wanted, counted ONCE per continuation chain, so work carried across weeks is
 * never counted twice and finishing it (logged completion) is what closes it. Added hours describe a proposal; completed work describes execution.
 *
 * Whether it can still be caught up is decided on usable time (catchUp.ts), never on weekly hours added up.
 * A week is a shortfall only when its records PROVE it fell short of accepted work: an empty accepted week, a week whose tasks were never answered
 * (incomplete) and a week the student marked as a planned break are never shortfalls. Their unfinished work is still owed.
 *
 * The escalation numbers are planning assumptions kept in RECOVERY below; missing two weeks alone never triggers recovery.
 */
import type { CatchUpFit } from './catchUp'

export const RECOVERY = {
  /** A closed week counts as a shortfall when even the most generous reading of the records puts delivery below this share. */
  shortfallBelow: 0.6,
  /** The most recent closed weeks looked at (whatever their quality), and how many must be genuine shortfalls before formal recovery is offered. */
  window: 4,
  repeatedShortfalls: 3,
  /** Owed minutes below this are not a gap worth naming. */
  minOwedMinutes: 30,
  /** Weeks that must remain after the carried work clears, for mocks and their follow-up. */
  reserveWeeks: 2,
} as const

export type PathKey = 'steady' | 'protect_core' | 'next_sitting'
export type RecoveryPath = {
  key: PathKey; label: string
  /** Total extra hours the path asks for, and the minutes a week it needs beyond the accepted workload. */
  hoursRequired: number; perWeekMinutes: number; weeksToClear: number | null; feasible: boolean
  moved: string[]; deferred: string[]
  effect: { revision: string; mocks: string; timeline: string }
  /** `draft`: takes effect through Weekly Review once accepted. `settings`: needs the student to change their exam first. */
  via: 'draft' | 'settings'
}
export type RecoveryLevel = 'on_track' | 'catching_up' | 'recovery_offered' | 'recovery_chosen'
export type RecoveryInput = {
  /** Closed weeks, newest first. */
  weeks: { executionHigh: number | null; quality: string; plannedBreak?: boolean }[]
  /** Unfinished, wanted, accepted workload, one entry per continuation chain. */
  owedMinutes: number; owedItems: number; owedWaitingMinutes: number
  /** Of the owed minutes, how many rest on PrepPlan's own estimate rather than the accepted plan or the student's figure; and minutes already logged on that work. */
  owedEstimatedMinutes?: number; loggedOnOwedMinutes?: number
  /** Revision minutes a week in the accepted plan: the part a recovery path may defer. */
  revisionMinutesPerWeek: number
  /** Whether what is owed fits the usable time before the mock runway; null when it could not be measured (`fitMissing` says why). */
  fit: CatchUpFit | null
  fitMissing?: 'no_exam' | 'no_roadmap' | 'unreadable'
  weeksLeft: number | null
  chosen: PathKey | null
}
export type RecoveryStatus = {
  level: RecoveryLevel; headline: string; why: string[]
  numbers: { owedEstimatedMinutes: number; loggedOnOwedMinutes: number; owedMinutes: number; owedItems: number; owedWaitingMinutes: number; shortfallWeeks: number; weeksConsidered: number; extraHours: number; weeksToClear: number | null; weeksLeft: number | null
    /** Usable minutes before the mock runway, what cannot be placed there, and the unaccepted demands counted against it. */
    usableMinutes: number | null; unplacedMinutes: number; provisionalMinutes: number
    /** Unaccepted new first-pass study forecast, and how much of it would wait. */
    newStudyMinutes: number; newStudyWaitingMinutes: number }
  /** What would have to give for the unaccepted work to fit as well. A forecast: nothing here is scheduled, missed or recorded. */
  tradeoff: { summary: string; waits: { title: string; minutes: number }[] } | null
  paths: RecoveryPath[]
  chosen: PathKey | null
  rule: string
}
const hours = (m: number) => Math.round((m / 60) * 10) / 10
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

const MISSING = {
  no_exam: 'Set an exam date to see whether what is owed fits your study time before mocks.',
  no_roadmap: 'Build your Roadmap to see whether what is owed fits your study time before mocks.',
  unreadable: 'PrepPlan could not read your Roadmap just now, so whether what is owed fits was not checked. Reload to try again.',
} as const

/** What would wait if the work you have not accepted yet is added to what is owed; null when it all fits or nothing was forecast. */
function tradeoffOf(fit: CatchUpFit | null): RecoveryStatus['tradeoff'] {
  const f = fit?.forecast
  if (!fit || !f) return null
  const study = f.newStudy.waiting.reduce((n, x) => n + x.minutes, 0), other = f.revisionWaiting + f.paperWaiting
  if (!study && !other) return null
  const named = f.newStudy.waiting.slice(0, 3).map(w => `${w.title} (${w.minutes} min)`).join(', ')
  const more = f.newStudy.waiting.length > 3 ? ` and ${f.newStudy.waiting.length - 3} more` : ''
  const parts = [study ? `${hours(study)} h of new study: ${named}${more}` : null, f.revisionWaiting ? `${hours(f.revisionWaiting)} h of revision` : null, f.paperWaiting ? `${hours(f.paperWaiting)} h of weekly papers` : null].filter(Boolean).join('; ')
  const freed = study - f.newStudyWaitingWithoutRevision
  const choice = [`add about ${hours(study + other)} h of study time${fit.until ? ` by ${fit.until}` : ''}`, freed > 0 && !fit.revisionHeld ? `pause revision, which makes room for ${hours(freed)} h of the new study` : null].filter(Boolean).join(', or ')
  const lead = fit.all.fits ? 'What is owed fits, but the whole Roadmap does not' : 'Beyond what is owed, more of the Roadmap would wait'
  return { summary: `${lead}. Would wait: ${parts}. To keep it, ${choice}. This is a forecast: nothing has been moved or marked missed.`, waits: [...f.newStudy.waiting, ...(f.revisionWaiting ? [{ title: 'Revision', minutes: f.revisionWaiting }] : []), ...(f.paperWaiting ? [{ title: 'Weekly papers', minutes: f.paperWaiting }] : [])] }
}

/** What the usable-time check found, in the student's terms. */
function fitLines(fit: CatchUpFit | null, missing: RecoveryInput['fitMissing']): string[] {
  if (!fit) return [MISSING[missing ?? 'no_exam']]
  const lines = [fit.all.fits
    ? `Your usable study time before the ${RECOVERY.reserveWeeks} weeks kept for mocks is ${hours(fit.usableMinutes)} h, after commitments, booked mocks and accepted work. What is owed fits by week ${fit.all.weeksToClear || 1}.`
    : `Your usable study time before the ${RECOVERY.reserveWeeks} weeks kept for mocks is ${hours(fit.usableMinutes)} h, after commitments, booked mocks and accepted work. ${hours(fit.all.unplacedMinutes)} h of what is owed does not fit it.`]
  const oneSitting = fit.all.unplaced.find(x => /one sitting/.test(x.reason))
  if (oneSitting) lines.push(`“${oneSitting.title}” cannot be placed: ${oneSitting.reason}`)
  const provisional = fit.provisional.revision + fit.provisional.paper
  if (fit.revisionHeld) lines.push('Revision waits until what is owed clears, as you chose in recovery.')
  if (provisional) {
    const kinds = [fit.provisional.revision ? `revision ${hours(fit.provisional.revision)} h` : null, fit.provisional.paper ? `weekly papers ${hours(fit.provisional.paper)} h` : null].filter(Boolean).join(' and ')
    lines.push(`Provisional demands are counted first, though you have not accepted them: ${kinds}. ${fit.all.fits ? 'It still fits.' : fit.withoutProvisional.fits ? 'Without them it would fit.' : 'It would not fit even without them.'}`)
  }
  const study = fit.forecast?.newStudy
  if (fit.studyFrom) lines.push(`Your accepted mock-led week holds broad new study until ${fit.studyFrom}; what the Roadmap schedules from then is forecast, not accepted.`)
  const tradeoff = tradeoffOf(fit)
  if (tradeoff) lines.push(tradeoff.summary)
  else if (study?.minutes) lines.push(`New first-pass study the Roadmap still schedules (${hours(study.minutes)} h, not accepted yet, at planning estimates) fits too.`)
  if (fit.notCounted?.minutes) lines.push(`Not counted: ${hours(fit.notCounted.minutes)} h of new study. ${fit.notCounted.reason}`)
  return lines
}

export function recoveryStatus(i: RecoveryInput): RecoveryStatus {
  const recent = i.weeks.slice(0, RECOVERY.window)
  const shortfallWeeks = recent.filter(w => w.quality === 'usable' && !w.plannedBreak && w.executionHigh !== null && w.executionHigh < RECOVERY.shortfallBelow).length
  const breaks = recent.filter(w => w.plannedBreak).length
  const fit = i.fit
  const weeksToClear = fit?.all.weeksToClear ?? null
  const usableWeeks = i.weeksLeft === null ? null : Math.max(0, i.weeksLeft - RECOVERY.reserveWeeks)
  const provisionalMinutes = fit ? fit.provisional.revision + fit.provisional.paper : 0
  const sustained = shortfallWeeks >= RECOVERY.repeatedShortfalls
  const cannotClear = i.owedMinutes >= RECOVERY.minOwedMinutes && fit !== null && !fit.all.fits
  const owed = i.owedMinutes >= RECOVERY.minOwedMinutes
  const numbers = { owedEstimatedMinutes: i.owedEstimatedMinutes ?? 0, loggedOnOwedMinutes: i.loggedOnOwedMinutes ?? 0, owedMinutes: i.owedMinutes, owedItems: i.owedItems, owedWaitingMinutes: i.owedWaitingMinutes, shortfallWeeks, weeksConsidered: recent.length, extraHours: hours(i.owedMinutes), weeksToClear, weeksLeft: i.weeksLeft, usableMinutes: fit?.usableMinutes ?? null, unplacedMinutes: fit?.all.unplacedMinutes ?? 0, provisionalMinutes,
    newStudyMinutes: fit?.forecast?.newStudy.minutes ?? 0, newStudyWaitingMinutes: fit?.forecast?.newStudy.waiting.reduce((n, x) => n + x.minutes, 0) ?? 0 }
  const rule = `Formal recovery is offered when ${RECOVERY.repeatedShortfalls} of the last ${RECOVERY.window} weeks delivered under ${Math.round(RECOVERY.shortfallBelow * 100)}% of the accepted workload, or when the carried work cannot clear and still leave ${RECOVERY.reserveWeeks} weeks for mocks and their follow-up. Missing two weeks alone does not trigger it; catching up on the same roadmap comes first.`

  const base = { numbers, rule, tradeoff: owed ? tradeoffOf(fit) : null }
  if (!owed) return { ...base, level: 'on_track', headline: 'On track', why: ['No accepted work is waiting to be caught up.'], paths: [], chosen: null }

  const why = [
    `${plural(i.owedItems, 'piece')} of accepted work (${hours(i.owedMinutes)} h still owed) ${i.owedItems === 1 ? 'is' : 'are'} unfinished and still wanted, counted once even if carried across weeks.`
      + (numbers.loggedOnOwedMinutes ? ` ${numbers.loggedOnOwedMinutes} min already logged on it stay${numbers.loggedOnOwedMinutes === 1 ? 's' : ''} recorded and ${numbers.loggedOnOwedMinutes === 1 ? 'is' : 'are'} not counted as owed.` : '')
      + (numbers.owedEstimatedMinutes ? ` ${numbers.owedEstimatedMinutes} min of what is owed is PrepPlan’s estimate; you can state your own in Weekly Review.` : ''),
    ...fitLines(fit, i.fitMissing),
  ]
  if (!(sustained || cannotClear)) return { ...base, level: 'catching_up', headline: base.tradeoff ? 'Catching up fits, with a trade-off ahead' : 'Catching up on the same roadmap', why, paths: [], chosen: null }

  const reasons = [sustained ? `${shortfallWeeks} of the last ${recent.length} weeks${breaks ? ` (${plural(breaks, 'planned break')} not counted)` : ''} delivered under ${Math.round(RECOVERY.shortfallBelow * 100)}% of the accepted workload.` : null,
    cannotClear ? `${hours(fit!.all.unplacedMinutes)} h of what is owed cannot be placed in your usable time before the ${RECOVERY.reserveWeeks} weeks kept for mocks.` : null].filter(Boolean) as string[]
  const weeksForSteady = Math.max(1, usableWeeks ?? 1)
  const steadyPerWeek = Math.ceil(i.owedMinutes / weeksForSteady)
  const core = fit?.withoutRevision
  const coreWeeks = core?.weeksToClear ?? null
  const paths: RecoveryPath[] = [
    { key: 'steady', label: 'Keep the roadmap and add time', hoursRequired: hours(i.owedMinutes), perWeekMinutes: steadyPerWeek, weeksToClear: weeksForSteady,
      feasible: Boolean(fit?.all.fits), moved: [], deferred: [],
      effect: { revision: 'Revision continues as planned.', mocks: 'Mocks stay where the Roadmap puts them.', timeline: 'The exam date does not move.' }, via: 'draft' },
    { key: 'protect_core', label: 'Protect core coverage first', hoursRequired: hours(i.owedMinutes), perWeekMinutes: coreWeeks ? Math.ceil(i.owedMinutes / coreWeeks) : 0, weeksToClear: coreWeeks,
      feasible: Boolean(core?.fits),
      moved: ['Carried work goes first in every week until it clears.'], deferred: [`Revision (about ${hours(i.revisionMinutesPerWeek)} h a week) and optional work wait until it clears.`],
      effect: { revision: 'Revision waits until the carried work clears, then resumes.', mocks: 'A mock waits for the carried work unless the time left is too short to wait.', timeline: 'The exam date does not move.' }, via: 'draft' },
    { key: 'next_sitting', label: 'Aim for the next sitting', hoursRequired: 0, perWeekMinutes: 0, weeksToClear: null, feasible: true,
      moved: ['The whole roadmap moves later with your exam date.'], deferred: [],
      effect: { revision: 'The plan is rebuilt for the new date; nothing is deferred.', mocks: 'Mocks move later with the plan.', timeline: 'You change your exam date first, then approve the rebuilt plan.' }, via: 'settings' },
  ]
  if (i.chosen) return { ...base, level: 'recovery_chosen', headline: `Recovery: ${paths.find(p => p.key === i.chosen)?.label ?? 'chosen'}`, why: [...reasons, ...why], paths, chosen: i.chosen }
  return { ...base, level: 'recovery_offered', headline: 'This roadmap is hard to sustain as it stands', why: [...reasons, ...why], paths, chosen: null }
}
