/**
 * The Roadmap's one recommendation for moving from broad revision to assessment-led (mock) work (pure).
 *
 * Four SEPARATE facts feed it and are never merged into a readiness score or pass forecast: coverage, scored evidence, execution and time.
 * "Ready for mocks" is NOT "ready for exam day"; that milestone has no automatic verdict or numerical cutoff here.
 *
 *  - Coverage is not a cutoff. More broad revision is recommended when the planner can name specific work worth finishing and place it whole before a
 *    preferred two-week runway for mock prep, in the time that is really usable (runwayForecast). When no named piece can be finished there, mocks start
 *    with the open areas named.
 *  - Evidence never blocks. Untested areas are gaps a mock can help sample; having no valid scored evidence lowers confidence, and says so.
 *  - Open repairs coexist with mock prep: the tracker's recorded findings say what to look at before the first mock and what fits afterwards.
 *  - Time decides. The mock, the debrief and the follow-up (45 and 60 minutes by default, editable by the student) are checked against the real gaps,
 *    sitting limit and exam date; a debrief or follow-up longer than a sitting is split, never silently shortened.
 * Nothing here writes: the proposal goes through Weekly Review and the existing approval rules.
 */
import { MOCK_MINUTES } from '../tests/limits'
import { forecastBeforeRunway, type Forecast, type ForecastDay, type ForecastRules, type ForecastWeek, type PlacedWork, type Reserved, type WorkItem } from './runwayForecast'

export const TRANSITION = {
  /** Weeks to keep for the mock, its debrief and its follow-up. A preference: when less is left the recommendation says what that costs. */
  runwayWeeks: 2,
  /** Default planning estimates, not measurements. The student edits them in the mock-prep proposal. */
  debriefMinutes: 45,
  followUpMinutes: 60,
  /** What an edited estimate may be. */
  minEstimate: 15,
  maxEstimate: 240,
} as const

export type MockEstimates = { debrief: number; followUp: number }
export const DEFAULT_ESTIMATES: MockEstimates = { debrief: TRANSITION.debriefMinutes, followUp: TRANSITION.followUpMinutes }
/** A student's edited estimates, or null when they are not whole minutes in range. */
export function parseEstimates(raw: unknown): MockEstimates | null {
  const r = raw as Partial<MockEstimates> | null
  const ok = (v: unknown) => Number.isInteger(v) && (v as number) >= TRANSITION.minEstimate && (v as number) <= TRANSITION.maxEstimate
  return r && ok(r.debrief) && ok(r.followUp) ? { debrief: r.debrief!, followUp: r.followUp! } : null
}

export type { Forecast, ForecastDay, ForecastRules, ForecastWeek, PlacedWork, Reserved, WorkItem }

export type GapKind = 'uncovered' | 'untested' | 'repair'
export type OpenGap = { kind: GapKind; name: string; href: string; count: number; when: 'before_mock' | 'after_mock' }
export type Verdict = 'ready' | 'more_revision' | 'start_with_gaps'

export type TransitionInput = {
  daysToExam: number | null
  /** Outcomes in the exam scope, those not yet covered, and those covered with no valid scored evidence. */
  total: number
  uncovered: number
  untestedCovered: number
  /** Outcomes with any valid scored evidence, and those whose recorded evidence says repair. */
  evidenced: number
  repair: number
  /** Named areas, already ordered by importance (the tracker's findings); `when` is set by the rule below. */
  gaps: Omit<OpenGap, 'when'>[]
  /** First-pass (broad) work still to do, named and in the planner's order. */
  work: WorkItem[]
  /** Study days from the proposed week up to the runway with their real free gaps, the other work that needs that time first, and the planner's rules. */
  runway: { days: ForecastDay[]; reserved: Reserved[]; rules: ForecastRules }
  /** The weekly study time the student stated, added up only to explain the difference from usable time. */
  weeklyMinutes: number | null
  /** The student's own estimates, when they edited them. */
  estimates?: MockEstimates
  /** The largest single free gap in the proposed week, and the total free minutes there, after accepted work and commitments. */
  largestGapMinutes: number
  freeMinutes: number
  maxSittingMinutes: number | null
  /** Whether PrepPlan's own bank can serve a mock now; null when unknown. */
  bankCanServe: boolean | null
  /** The student accepted a recovery path that protects core coverage first. */
  recoveryHold?: boolean
}

export type ProposalLine = { kind: 'mock' | 'debrief' | 'follow_up'; label: string; minutes: number }
export type MockTransition = {
  available: true
  verdict: Verdict
  headline: string
  why: string[]
  gaps: OpenGap[]
  confidence: { level: 'normal' | 'lower'; note: string | null }
  /** The named work the planner can finish before the runway, and what it cannot. */
  broadRevision: { weeksRoom: number; placed: PlacedWork[]; waiting: WorkItem[]; placedMinutes: number; waitingMinutes: number; weeks: ForecastWeek[]; usableMinutes: number; nominalMinutes: number | null; reservedMinutes: number; reservedUnplaced: number }
  estimates: MockEstimates
  facts: { uncovered: number; untestedCovered: number; repair: number; evidenced: number; weeksLeft: number }
  proposal: { adds: ProposalLine[]; keepsBroadRevision: boolean; waits: { title: string; reason: string }[] }
  costOfWaiting: string | null
  /** Offered when PrepPlan's bank cannot serve a mock: the report stays the student's own. */
  externalRoute: string | null
  feasibility: { fits: boolean; /** The proposed week has one opening that holds the mock itself. */ mockOpening: boolean; needMinutes: number; haveMinutes: number; note: string }
  /** The actual trade-off, in the student's terms. */
  tradeoff: string
} | { available: false; reason: string }

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`
const hrs = (m: number) => `${Math.round((m / 60) * 10) / 10} h`

export function mockTransition(i: TransitionInput): MockTransition {
  if (i.daysToExam === null) return { available: false, reason: 'Set an exam date to see when mocks should start.' }
  if (i.daysToExam < 0) return { available: false, reason: 'Your exam date has passed.' }
  if (i.total === 0) return { available: false, reason: 'No outcomes are in your plan yet.' }

  const weeksLeft = Math.floor(i.daysToExam / 7)
  const room = Math.max(0, weeksLeft - TRANSITION.runwayWeeks)
  const work = i.work.filter(w => w.minutes > 0)
  const fit = forecastBeforeRunway(room > 0 ? i.runway.days : [], room > 0 ? i.runway.reserved : [], work, i.runway.rules)
  const total = (l: WorkItem[]) => l.reduce((n, w) => n + w.minutes, 0)
  const verdict: Verdict = !work.length ? 'ready' : fit.placed.length ? 'more_revision' : 'start_with_gaps'
  const usableMinutes = fit.weeks.reduce((n, w) => n + w.usableMinutes, 0), nominal = i.weeklyMinutes === null ? null : i.weeklyMinutes * room
  const broad = { weeksRoom: room, placed: fit.placed, waiting: fit.waiting, placedMinutes: total(fit.placed), waitingMinutes: total(fit.waiting), weeks: fit.weeks, usableMinutes, nominalMinutes: nominal, reservedMinutes: fit.reservedMinutes, reservedUnplaced: fit.reservedUnplaced }
  // Said whenever the added-up weekly time promises noticeably more than can actually be used.
  const difference = room > 0 && nominal !== null && nominal > usableMinutes
    ? ` Your weekly study time adds up to ${hrs(nominal)} before the runway, but after commitments, booked and accepted work${fit.reservedMinutes ? `, ${hrs(fit.reservedMinutes)} already owed to other work` : ''} and your ${i.runway.rules.maxSitting}-minute sittings, ${hrs(usableMinutes)} is usable.` : ''

  // The mock keeps its own clock. The debrief and follow-up take the student's estimates in full; placement splits them to the sitting limit.
  const estimates = i.estimates ?? DEFAULT_ESTIMATES
  const need = MOCK_MINUTES + estimates.debrief + estimates.followUp
  const mockOpening = i.largestGapMinutes >= MOCK_MINUTES
  const fits = mockOpening && i.freeMinutes >= need
  const feasibility = {
    fits, mockOpening, needMinutes: need, haveMinutes: i.freeMinutes,
    note: fits ? `The proposed week has a ${MOCK_MINUTES}-minute opening for the mock and ${Math.round(i.freeMinutes)} free minutes for the ${need} the mock, debrief and follow-up need.`
      : !mockOpening ? `No single opening in the proposed week holds a ${MOCK_MINUTES}-minute mock; the clock is not split. Add a window for it in Weekly Review, or free one in Calendar.`
      : `The proposed week has ${Math.round(i.freeMinutes)} free minutes; the mock, debrief and follow-up need ${need}. Weekly Review shows what fits and what waits.`,
  }

  // Where each named area belongs: broad revision and findings come before the mock only while there is room; otherwise they stay visible and follow it.
  const beforeMock = verdict === 'more_revision'
  const gaps: OpenGap[] = i.gaps.map(g => ({ ...g, when: g.kind === 'untested' ? 'after_mock' : beforeMock ? 'before_mock' : 'after_mock' }))

  const lower = i.evidenced === 0
  const confidence = { level: lower ? 'lower' as const : 'normal' as const,
    note: lower ? 'You have no valid scored evidence yet, so this rests on the coverage you reported. Treat it as a first estimate: a mock or a scored paper is how you get evidence, and the advice is firmer once you have some.' : null }
  const externalRoute = i.bankCanServe === false
    ? 'PrepPlan cannot serve a mock from its own questions right now. Take an external mock and record it in Calendar; that report stays your own, labelled self-reported, and is not question evidence.' : null
  const facts = { uncovered: i.uncovered, untestedCovered: i.untestedCovered, repair: i.repair, evidenced: i.evidenced, weeksLeft }
  const areas = i.gaps.filter(g => g.kind === 'uncovered').slice(0, 3).map(g => g.name)
  const findings = i.repair > 0 ? ` ${plural(i.repair, 'outcome')} ${i.repair === 1 ? 'has' : 'have'} a recorded finding from your scored work.` : ''
  const untested = i.untestedCovered > 0 ? ` ${plural(i.untestedCovered, 'covered outcome')} ${i.untestedCovered === 1 ? 'has' : 'have'} no scored evidence yet; a mock helps sample them.` : ''
  // Always proposed when a mock is recommended: what cannot be placed is shown as waiting by the draft, and an added window can take it.
  const adds: ProposalLine[] = [
    { kind: 'mock', label: 'Mock sitting', minutes: MOCK_MINUTES },
    { kind: 'debrief', label: 'Debrief the mock', minutes: estimates.debrief },
    { kind: 'follow_up', label: 'Follow up on what it found', minutes: estimates.followUp },
  ]
  const common = { available: true as const, verdict, gaps, confidence, broadRevision: broad, facts, feasibility, externalRoute, estimates }
  const named = (l: WorkItem[], n = 3) => `${l.slice(0, n).map(w => w.name).join(', ')}${l.length > n ? ` and ${l.length - n} more` : ''}`

  if (verdict === 'ready') return { ...common, costOfWaiting: null,
    headline: 'Ready for mocks',
    why: [`No area of your plan is left uncovered and ${weeksLeft} week${weeksLeft === 1 ? '' : 's'} remain, so there is room for a mock, its debrief and the follow-up.${findings}${untested}`],
    tradeoff: `Starting now keeps ${TRANSITION.runwayWeeks} weeks for the mock and what it finds. Recorded findings can run alongside; the follow-up time after the mock starts with them.`,
    proposal: { adds, keepsBroadRevision: false, waits: fits ? [] : [{ title: 'Part of the mock sequence', reason: feasibility.note }] } }

  if (verdict === 'more_revision') {
    const after = fit.waiting.length
    return { ...common, costOfWaiting: null,
      headline: 'More broad revision first',
      why: [`${fit.placed.length === 1 ? 'One piece' : `${fit.placed.length} pieces`} of broad revision can be finished before the ${TRANSITION.runwayWeeks}-week runway for mock prep: ${named(fit.placed)} (${hrs(broad.placedMinutes)} across the ${room} week${room === 1 ? '' : 's'} before it).`
        + (after ? ` ${named(fit.waiting)} (${hrs(broad.waitingMinutes)}) will not be finished by then and continue${after === 1 ? 's' : ''} after the mock.` : ' Nothing broad is left over.') + difference + (fit.placed.some(w => w.forecast) ? ' Later weeks are a forecast; nothing in them is scheduled yet.' : '') + findings,
        ...(i.recoveryHold ? ['You chose to protect core coverage first, so the mock waits while that clears.'] : [])],
      tradeoff: `Waiting finishes ${named(fit.placed, 2)} first. The cost is that the first mock comes later, leaving ${TRANSITION.runwayWeeks} weeks to act on what it finds.`,
      proposal: { adds: [], keepsBroadRevision: true, waits: [{ title: 'Mock sitting', reason: `It waits while ${named(fit.placed, 2)} ${fit.placed.length === 1 ? 'is' : 'are'} finished.` }] } }
  }

  return { ...common,
    headline: 'Start mocks now, with gaps open',
    why: [`Still uncovered: ${areas.length ? areas.join(', ') : named(work)}. ${room === 0 ? `Only ${weeksLeft} week${weeksLeft === 1 ? '' : 's'} remain, which is no more than the ${TRANSITION.runwayWeeks}-week runway a mock, its debrief and its follow-up need.`
      : `None of the remaining pieces can be finished in the usable time of the ${room} week${room === 1 ? '' : 's'} before the ${TRANSITION.runwayWeeks}-week runway.`}${difference}${findings}${untested}`],
    costOfWaiting: `Waiting would leave too little time for a mock, its debrief and the follow-up. A mock now shows which open areas matter, so the remaining ${weeksLeft} week${weeksLeft === 1 ? '' : 's'} go to those.`,
    tradeoff: `${named(work)} stay${work.length === 1 ? 's' : ''} open and ${work.length === 1 ? 'is' : 'are'} worked on after the mock, in priority order. Revision of material that tested well waits so the time goes to the mock and the open areas.`,
    proposal: { adds, keepsBroadRevision: true,
      waits: [{ title: 'Revision of material that tested well', reason: 'It waits so the time goes to the open areas and the mock.' }, ...(fits ? [] : [{ title: 'Part of the mock sequence', reason: feasibility.note }])] } }
}
