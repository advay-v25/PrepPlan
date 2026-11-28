/** The Roadmap's mock-transition recommendation (pure): named work before the runway, editable estimates, split sittings, and facts kept apart. */
import { mockTransition, parseEstimates, TRANSITION, type TransitionInput, type WorkItem } from '../src/lib/exam/mockTransition'
import { forecastBeforeRunway, type ForecastDay } from '../src/lib/exam/runwayForecast'
import { placeMockWeek, sittingsOf, type DayRoom } from '../src/lib/exam/mockWeekPlacement'
import { MOCK_MINUTES } from '../src/lib/tests/limits'

let passed = 0, failed = 0
const check = (n: string, ok: boolean, d = '') => { ok ? (passed++, console.log(`  ✓ ${n}`)) : (failed++, console.log(`  ✗ ${n}${d ? ` — ${d}` : ''}`)) }
const w = (name: string, minutes: number): WorkItem => ({ name, minutes, href: `/app/curriculum/t/${name}` })
const rules = { maxSitting: 45, minSitting: 15, dailyNewMinutes: 510 }
/** `weeks` × six study days, each with the given free ranges. */
const study = (weeks: number, ranges: [number, number][] = [[1080, 1260]]): ForecastDay[] => Array.from({ length: weeks * 6 }, (_, i) => ({ date: new Date(Date.UTC(2027, 0, 4 + Math.floor(i / 6) * 7 + (i % 6))).toISOString().slice(0, 10), week: Math.floor(i / 6) + 1, gaps: ranges.map(([start, end]) => ({ start, end })) }))
const runway = (days: ForecastDay[] = study(18), reserved: TransitionInput['runway']['reserved'] = []) => ({ days, reserved, rules })
const base: TransitionInput = { daysToExam: 84, total: 100, uncovered: 0, untestedCovered: 20, evidenced: 40, repair: 0, gaps: [], work: [], runway: runway(), weeklyMinutes: 600, largestGapMinutes: 180, freeMinutes: 400, maxSittingMinutes: 90, bankCanServe: true }
const gap = { kind: 'repair' as const, name: 'Time value of money', href: '/app/curriculum/quant/r1', count: 1 }
const area = { kind: 'uncovered' as const, name: 'Derivatives', href: '/app/curriculum/deriv/r2', count: 8 }
type T = Extract<ReturnType<typeof mockTransition>, { available: true }>
const get = (i: TransitionInput) => mockTransition(i) as T
const minutes = (t: T) => t.proposal.adds.map(a => `${a.kind}:${a.minutes}`).join()

// Forecasting what can really be finished before the runway.
let f = forecastBeforeRunway(study(2, [[1080, 1140]]), [], [w('A', 500), w('B', 900), w('C', 100)], rules)
check('work is placed whole in order; one that cannot be finished claims nothing and the next is tried', f.placed.map(x => `${x.name}@${x.week}`).join() === 'A@2,C@2' && f.waiting.map(x => x.name).join() === 'B')
check('only weeks after the proposed one are forecasts', f.weeks[0].forecast === false && f.weeks[1].forecast === true && f.placed[0].forecast === true)
check('one long gap holds several sittings of the limit', forecastBeforeRunway(study(1, [[1080, 1260]]).slice(0, 1), [], [w('A', 180)], rules).placed.length === 1)
f = forecastBeforeRunway(study(4, [[0, 10], [100, 110], [200, 212]]), [], [w('A', 60)], rules)
check('fragments shorter than a sitting are not capacity, however many there are', f.placed.length === 0 && f.weeks.every(x => x.usableMinutes === 0))
check('new learning is capped per day', forecastBeforeRunway(study(1).slice(0, 2), [], [w('A', 130)], { ...rules, dailyNewMinutes: 60 }).placed.length === 0 && forecastBeforeRunway(study(1).slice(0, 3), [], [w('A', 130)], { ...rules, dailyNewMinutes: 60 }).placed.length === 1)
f = forecastBeforeRunway(study(1, [[1080, 1140]]), [{ title: 'owed', minutes: 330 }], [w('A', 60)], rules)
check('other planned work takes its time first', f.placed.length === 0 && f.reservedMinutes === 330 && f.weeks[0].usableMinutes === 30)
check('a booked mock’s debrief waits for the days after it and is counted when it cannot be placed', forecastBeforeRunway(study(1), [{ title: 'debrief', minutes: 45, notBefore: '2028-01-01' }], [], rules).reservedUnplaced === 45)
check('no days places nothing', forecastBeforeRunway([], [], [w('A', 30)], rules).placed.length === 0)

const clean = get(base)
check('nothing uncovered: ready', clean.verdict === 'ready')
check('ready: mock, debrief (45) and follow-up (60) by default', minutes(clean) === `mock:${MOCK_MINUTES},debrief:45,follow_up:60`)
check('ready: normal confidence, no cost of waiting', clean.confidence.level === 'normal' && clean.costOfWaiting === null && !clean.proposal.keepsBroadRevision)
check('the sitting limit never shortens an estimate: the full minutes stay on the card', minutes(get({ ...base, maxSittingMinutes: 45 })) === `mock:${MOCK_MINUTES},debrief:45,follow_up:60`)
check('edited estimates are used and change what is needed', (() => { const t = get({ ...base, estimates: { debrief: 90, followUp: 120 } }); return minutes(t) === `mock:${MOCK_MINUTES},debrief:90,follow_up:120` && t.feasibility.needMinutes === MOCK_MINUTES + 210 })())
check('estimates are validated: whole minutes in range only', parseEstimates({ debrief: 45, followUp: 60 }) !== null && [{ debrief: 10, followUp: 60 }, { debrief: 45.5, followUp: 60 }, { debrief: 45, followUp: 999 }, {}, null].every(x => parseEstimates(x) === null))
check('an open repair coexists with mock prep', (() => { const t = get({ ...base, repair: 2, gaps: [gap] }); return t.verdict === 'ready' && t.gaps[0].when === 'after_mock' && /recorded finding/.test(t.why[0]) })())

const more = get({ ...base, daysToExam: 140, uncovered: 30, work: [w('Derivatives', 600), w('Swaps', 300)], repair: 2, gaps: [gap, area] })
check('more revision: names the specific work it can finish before the runway', more.verdict === 'more_revision' && /Derivatives, Swaps/.test(more.why[0]) && more.broadRevision.placed.length === 2 && /Nothing broad is left over/.test(more.why[0]))
check('more revision: nothing is added, areas are timed before the mock, and the trade-off names the work', more.proposal.adds.length === 0 && more.proposal.keepsBroadRevision && more.gaps.every(g => g.when === 'before_mock') && /Derivatives/.test(more.tradeoff))
const sliver = get({ ...base, daysToExam: 28, runway: runway(study(2, [[1080, 1100]])), weeklyMinutes: 120, uncovered: 90, work: [w('Huge', 5000), w('Small', 60)], gaps: [area] })
check('no half-fit cutoff: one specific finishable piece is enough, and the rest is named as continuing after the mock', sliver.verdict === 'more_revision' && /Small/.test(sliver.why[0]) && /Huge .* continues after the mock/.test(sliver.why[0]) && !/forecast/.test(sliver.why[0]))
check('work that finishes in a later week is called a forecast', /Later weeks are a forecast/.test(get({ ...base, daysToExam: 42, runway: runway(study(4, [[1080, 1100]])), uncovered: 30, work: [w('Long', 200)], gaps: [area] }).why[0]))
// The case the weekly total hides: plenty of hours on paper, none of them usable.
const hidden = get({ ...base, daysToExam: 42, weeklyMinutes: 1200, runway: runway(study(4, [[0, 12], [100, 112], [200, 212]])), uncovered: 30, work: [w('Derivatives', 300)], gaps: [area] })
check('weekly total is sufficient but usable time is not: start mocks, and say both figures', hidden.verdict === 'start_with_gaps' && hidden.broadRevision.nominalMinutes! >= 300 && hidden.broadRevision.usableMinutes === 0 && /adds up to 80 h .* 0 h is usable/.test(hidden.why[0]))
check('the same total with usable time recommends more revision', get({ ...base, daysToExam: 42, weeklyMinutes: 1200, runway: runway(study(4)), uncovered: 30, work: [w('Derivatives', 300)], gaps: [area] }).verdict === 'more_revision')
const noRoom = get({ ...base, daysToExam: 14, uncovered: 30, work: [w('Derivatives', 60)], gaps: [area] })
check('inside the runway: start mocks with the open areas named', noRoom.verdict === 'start_with_gaps' && /Derivatives/.test(noRoom.why[0]) && /too little time/.test(noRoom.costOfWaiting ?? ''))
const nothingFits = get({ ...base, daysToExam: 35, runway: runway(study(3, [[1080, 1100]])), weeklyMinutes: 120, uncovered: 30, work: [w('Huge', 5000)], gaps: [area] })
check('room but nothing finishable: start, saying why and what stays open', nothingFits.verdict === 'start_with_gaps' && /None of the remaining pieces/.test(nothingFits.why[0]) && /Huge/.test(nothingFits.tradeoff))
check('time pressure: mock sequence proposed, gaps visible after it, tested material waits', noRoom.proposal.adds.length === 3 && noRoom.gaps.every(g => g.when === 'after_mock') && noRoom.proposal.waits.some(x => /tested well/.test(x.title)))

const none = get({ ...base, evidenced: 0 })
check('no scored evidence does not block: lower confidence with a clear explanation', none.verdict === 'ready' && none.confidence.level === 'lower' && /first estimate/.test(none.confidence.note ?? ''))
check('untested areas are gaps a mock can sample', /helps sample/.test(get({ ...base, untestedCovered: 90 }).why[0]))
check('the bank cannot serve a mock: the external route is offered as self-reported', /self-reported/.test(get({ ...base, bankCanServe: false }).externalRoute ?? '') && clean.externalRoute === null)
check('a week that cannot hold the whole sequence still proposes it and says what is short', (() => { const t = get({ ...base, largestGapMinutes: 100 }); return t.proposal.adds.length === 3 && !t.feasibility.fits && /not split/.test(t.feasibility.note) })())
check('a recovery hold keeps the mock waiting while there is room', get({ ...base, uncovered: 5, work: [w('Derivatives', 60)], recoveryHold: true }).verdict === 'more_revision')
check('student text never mentions the founder or provisional rules', [clean, more, noRoom, sliver].every(t => !/founder|not fixed|provisional/i.test(JSON.stringify(t))))
check('no exam date, and a passed date', !mockTransition({ ...base, daysToExam: null }).available && !mockTransition({ ...base, daysToExam: -1 }).available)

// Placement inside one week.
const adds = [{ kind: 'mock' as const, label: 'Mock sitting', minutes: 135 }, { kind: 'debrief' as const, label: 'Debrief the mock', minutes: 45 }, { kind: 'follow_up' as const, label: 'Follow up on what it found', minutes: 60 }]
const day = (date: string, ...g: [number, number][]): DayRoom => ({ date, usable: true, gaps: g.map(([start, end]) => ({ start, end })) })
const open = (d: string) => day(d, [540, 780])
const at = (l: { date: string; minutes: number }[]) => l.map(x => `${x.date.slice(8)}:${x.minutes}`).join()
check('sittings: split to the limit, minutes preserved', sittingsOf(60, 45).join() === '30,30' && sittingsOf(45, 45).join() === '45' && sittingsOf(100, 45).reduce((a, b) => a + b, 0) === 100 && sittingsOf(100, null).join() === '100')
let r = placeMockWeek([open('2027-01-04'), open('2027-01-05'), open('2027-01-06')], adds, 45, 540)
check('placement: mock first day; debrief next; a 60-minute follow-up splits into two sittings on a later day', r.mock?.date === '2027-01-04' && at(r.debrief) === '05:45' && at(r.followUp) === '06:30,06:30' && r.waits.length === 0)
r = placeMockWeek([open('2027-01-04'), open('2027-01-05')], adds, null, 540)
check('placement: with one later day the follow-up shares the debrief day, never earlier', at(r.debrief) === '05:45' && at(r.followUp) === '05:60')
r = placeMockWeek([open('2027-01-04'), day('2027-01-05', [600, 700])], adds, 45, 540)
check('placement: what fits is placed and the exact remaining minutes wait', at(r.debrief) === '05:45' && at(r.followUp) === '05:30' && r.waits.length === 1 && r.waits[0].minutes === 30 && r.waits[0].kind === 'follow_up')
r = placeMockWeek([day('2027-01-04', [540, 600], [700, 760]), day('2027-01-05', [540, 600])], adds, null, 540)
check('placement: two short gaps do not make a 135-minute mock; the whole sequence waits with its minutes', r.mock === null && /not split/.test(r.waits[0].reason) && r.waits.map(x => x.minutes).join() === '135,45,60')
r = placeMockWeek([open('2027-01-04'), { ...open('2027-01-05'), usable: false }], adds, null, 540)
check('placement: a non-study day is never used', r.mock?.date === '2027-01-04' && r.debrief.length === 0 && r.waits.length === 2)
r = placeMockWeek([day('2027-01-04', [0, 300]), open('2027-01-05'), open('2027-01-06')], adds, null, 540)
check('placement: the mock starts inside the gap even when the usual hour is outside it', r.mock !== null && r.mock.start + 135 <= 300)
check('defaults are 45 and 60', TRANSITION.debriefMinutes === 45 && TRANSITION.followUpMinutes === 60)

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
