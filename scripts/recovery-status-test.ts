/** Catch-up and formal recovery status (pure): owed work counted once, the escalation rule, and the three paths. */
import { recoveryStatus, RECOVERY, type RecoveryInput } from '../src/lib/planning/recovery/status'
import { catchUpFit, type CatchUpFit } from '../src/lib/planning/recovery/catchUp'
import type { ForecastDay } from '../src/lib/exam/runwayForecast'
import { firstPassDemand, forecastStudy, spokenFor, type ReadingTask } from '../src/lib/planning/recovery/firstPass'
import { remainingMinutes, resolveDispositions } from '../src/lib/planning/weeklyReview/dispositions'
let passed = 0, failed = 0
const check = (n: string, ok: boolean, d = '') => { ok ? (passed++, console.log(`  ✓ ${n}`)) : (failed++, console.log(`  ✗ ${n}${d ? ` — ${d}` : ''}`)) }
const wk = (high: number) => ({ executionHigh: high, quality: 'usable' })
const result = (fits: boolean, week = 1, unplaced = 0) => ({ fits, weeksToClear: fits ? week : null, unplacedMinutes: unplaced, unplaced: unplaced ? [{ title: 'Left over', minutes: unplaced, reason: 'No usable opening is left for it.' }] : [] })
const fit = (all = result(true), over: Partial<CatchUpFit> = {}): CatchUpFit => ({ usableMinutes: 3000, weeks: 12, provisional: { revision: 0, paper: 0 }, all, withoutProvisional: all, withoutRevision: all, ...over })
const base: RecoveryInput = { weeks: [wk(0.9)], owedMinutes: 0, owedItems: 0, owedWaitingMinutes: 0, revisionMinutesPerWeek: 120, fit: fit(), weeksLeft: 14, chosen: null }

check('nothing owed: on track, no paths', recoveryStatus(base).level === 'on_track' && recoveryStatus(base).paths.length === 0)
check('a gap under the threshold is not named', recoveryStatus({ ...base, owedMinutes: RECOVERY.minOwedMinutes - 1 }).level === 'on_track')
const one = recoveryStatus({ ...base, weeks: [wk(0.2)], owedMinutes: 300, owedItems: 6 })
check('one missed week: catching up on the same roadmap, no recovery offered', one.level === 'catching_up' && one.paths.length === 0 && one.numbers.weeksToClear === 1 && one.numbers.extraHours === 5)
const two = recoveryStatus({ ...base, weeks: [wk(0), wk(0)], owedMinutes: 600, owedItems: 12 })
check('two missed weeks alone do not trigger recovery', two.level === 'catching_up' && two.numbers.shortfallWeeks === 2)
const sustained = recoveryStatus({ ...base, weeks: [wk(0.1), wk(0.3), wk(0.2), wk(0.9)], owedMinutes: 600, owedItems: 12 })
check('repeated shortfalls offer formal recovery with three paths', sustained.level === 'recovery_offered' && sustained.paths.map(p => p.key).join() === 'steady,protect_core,next_sitting')
check('each path states hours, what moves or waits, and effect on revision, mocks and timeline', sustained.paths.every(p => p.effect.revision && p.effect.mocks && p.effect.timeline) && sustained.paths[1].deferred.length > 0 && sustained.paths[0].hoursRequired === 10)
const cannot = recoveryStatus({ ...base, owedMinutes: 2400, owedItems: 30, weeksLeft: 5, fit: fit(result(false, 0, 900)) })
check('owed work that does not fit usable time offers recovery even without repeated shortfalls', cannot.level === 'recovery_offered' && /15 h of what is owed cannot be placed/.test(cannot.why[0]) && !cannot.paths[0].feasible)
const dated = recoveryStatus({ ...base, owedMinutes: 300, fit: null, weeksLeft: null })
check('no exam horizon: whether it fits is not invented', dated.level === 'catching_up' && dated.numbers.weeksToClear === null && /Set an exam date/.test(dated.why.join(' ')))
const provisional = recoveryStatus({ ...base, owedMinutes: 300, fit: fit(result(false, 0, 120), { provisional: { revision: 240, paper: 60 }, withoutProvisional: result(true, 2) }) })
check('provisional demands are shown as such, with whether they make the difference', /Provisional demands are counted first, though you have not accepted them: revision 4 h and weekly papers 1 h\. Without them it would fit\./.test(provisional.why.join(' ')) && provisional.numbers.provisionalMinutes === 300)
const chosen = recoveryStatus({ ...base, weeks: [wk(0.1), wk(0.3), wk(0.2)], owedMinutes: 600, owedItems: 12, chosen: 'protect_core' })
check('a chosen path is reported as chosen on every surface', chosen.level === 'recovery_chosen' && chosen.chosen === 'protect_core' && /Protect core/.test(chosen.headline))
check('incomplete (unreported) weeks are not shortfalls', recoveryStatus({ ...base, weeks: [{ executionHigh: 0, quality: 'incomplete' }, wk(0), wk(0)], owedMinutes: 300 }).numbers.shortfallWeeks === 2)
check('an empty accepted week is not a shortfall', recoveryStatus({ ...base, weeks: [{ executionHigh: null, quality: 'empty' }, wk(0), wk(0)], owedMinutes: 300 }).level === 'catching_up')
check('a planned break is not a shortfall, and is named when recovery is offered', recoveryStatus({ ...base, weeks: [{ ...wk(0), plannedBreak: true }, wk(0), wk(0)], owedMinutes: 300 }).level === 'catching_up' && /1 planned break not counted/.test(recoveryStatus({ ...base, weeks: [{ ...wk(0), plannedBreak: true }, wk(0), wk(0), wk(0)], owedMinutes: 300 }).why[0]))
check('only the last four weeks count: an older shortfall does not reach in past newer unreported weeks', recoveryStatus({ ...base, weeks: [{ executionHigh: 1, quality: 'incomplete' }, wk(0), wk(0), { executionHigh: 0, quality: 'empty' }, wk(0)], owedMinutes: 300 }).level === 'catching_up')
const partial = recoveryStatus({ ...base, owedMinutes: 25 + 25, owedItems: 2, loggedOnOwedMinutes: 20, owedEstimatedMinutes: 25 })
check('logged minutes and owed minutes are separate, and an estimate is labelled', partial.numbers.owedMinutes === 50 && partial.numbers.loggedOnOwedMinutes === 20 && /20 min already logged/.test(partial.why[0]) && /25 min of what is owed is PrepPlan’s estimate/.test(partial.why[0]))
check('the student text explains the trigger and does not mention the founder', /two weeks alone/.test(one.rule) && !/founder|provisional|not fixed/i.test(one.rule))
// The 20-minute partial plus 25-minute continuation case: one 45-minute task, 20 logged.
check('remaining is planned minus logged, never a percentage', remainingMinutes(45, 20) === 25 && remainingMinutes(45, 0) === 45 && remainingMinutes(45, 50) === 15)
const task = { id: 't', title: 'Study', taskType: 'study', execution: 'partial', durationMinutes: 45, isProtected: false, loggedMinutes: 20 }
const guess = resolveDispositions([task], { t: { happened: 'partial', next: 'continue' } }).actions[0].continuation!
check('unknown remainder: 25 minutes carried, labelled as the planner’s estimate', guess.minutes === 25 && guess.provisional === true)
const stated = resolveDispositions([task], { t: { happened: 'partial', next: 'continue', estimateMinutes: 30 } }).actions[0].continuation!
check('the student’s confirmed remainder wins and is not labelled an estimate', stated.minutes === 30 && stated.provisional === false)

// Usable time, not weekly hours.
const days = (weeks: number, ranges: [number, number][]): ForecastDay[] => Array.from({ length: weeks * 7 }, (_, i) => ({ date: new Date(Date.UTC(2027, 0, 4 + i)).toISOString().slice(0, 10), week: Math.floor(i / 7) + 1, gaps: ranges.map(([start, end]) => ({ start, end })) }))
const none = { weeks: [], revisionPerWeek: 0, paperMinutes: 0 }
const piece = (minutes: number, taskType = 'study', title = 'Owed') => ({ title, minutes, taskType })
// The same 14 stated hours a week: one student's are open, the other's are cut into ten-minute fragments by commitments.
const open = catchUpFit(days(4, [[1080, 1200]]), [], [piece(600)], none, 45)
const fragmented = catchUpFit(days(4, Array.from({ length: 12 }, (_, i): [number, number] => [i * 60, i * 60 + 10])), [], [piece(600)], none, 45)
check('same minutes a day, usable slots: it fits', open.all.fits && open.all.weeksToClear === 1 && open.usableMinutes === 4 * 7 * 120)
check('same minutes a day, no usable slot: nothing fits', !fragmented.all.fits && fragmented.all.unplacedMinutes === 600 && fragmented.usableMinutes === 0)
check('and the two students get different recommendations', recoveryStatus({ ...base, owedMinutes: 600, fit: open }).level === 'catching_up' && recoveryStatus({ ...base, owedMinutes: 600, fit: fragmented }).level === 'recovery_offered')
check('a check longer than a sitting cannot be placed however much time there is, and says why', (() => { const f = catchUpFit(days(4, [[600, 900]]), [], [piece(60, 'verification', 'Re-check')], none, 45); return !f.all.fits && /one sitting of 60 minutes, longer than your 45-minute/.test(f.all.unplaced[0].reason) })())
check('a check within the limit needs one gap that holds it', !catchUpFit(days(1, [[0, 20], [100, 120]]), [], [piece(30, 'repair')], none, 45).all.fits && catchUpFit(days(1, [[0, 30]]), [], [piece(30, 'repair')], none, 45).all.fits)
check('booked work takes its time first', !catchUpFit(days(1, [[0, 60]]), [{ title: 'debrief', minutes: 420 }], [piece(15)], none, 45).all.fits)
const prov = catchUpFit(days(1, [[0, 60]]), [], [piece(300)], { weeks: ['2027-01-04'], revisionPerWeek: 120, paperMinutes: 60 }, 45)
check('provisional revision and a paper on a study day compete, and are reported separately', !prov.all.fits && prov.withoutProvisional.fits && prov.provisional.revision === 120 && prov.provisional.paper === 60)
check('a paper day that is not a study day costs nothing', catchUpFit(days(1, [[0, 60]]).slice(0, 6), [], [piece(60)], { weeks: ['2027-01-04'], revisionPerWeek: 0, paperMinutes: 60 }, 45).provisional.paper === 0)
check('each owed piece is placed once', catchUpFit(days(1, [[0, 60]]), [], [piece(210), piece(210)], none, 45).all.unplacedMinutes === 0)

// Unaccepted first-pass study: named, counted once, last in line, and never the reason recovery is offered.
const study = (...minutes: number[]) => ({ items: minutes.map((m, i) => ({ title: `Reading ${'ABCDEF'[i]}`, readingId: `r${i}`, minutes: m })), dailyMinutes: 510 })
const week = days(1, [[1080, 1140]])   // 7 h of usable time
const roomy = recoveryStatus({ ...base, owedMinutes: 120, owedItems: 1, fit: catchUpFit(week, [], [piece(120)], none, 45, study(90, 120)) })
check('first-pass study that fits is said to fit, with no trade-off', roomy.level === 'catching_up' && roomy.tradeoff === null && roomy.numbers.newStudyMinutes === 210 && roomy.numbers.newStudyWaitingMinutes === 0 && /still schedules \(3\.5 h, not accepted yet.*fits too/.test(roomy.why.join(' ')))
const tightFit = catchUpFit(week, [], [piece(120)], none, 45, study(200, 150, 60))
const tight = recoveryStatus({ ...base, owedMinutes: 120, owedItems: 1, fit: tightFit })
check('the same owed work with more first-pass study changes the recommendation, not the level', tight.level === 'catching_up' && tight.headline !== roomy.headline && /trade-off/.test(tight.headline) && tightFit.all.fits)
check('it names what would wait and the minutes', tight.numbers.newStudyWaitingMinutes === 112 && /Would wait: 1\.9 h of new study: Reading B \(52 min\), Reading C \(60 min\)/.test(tight.tradeoff!.summary) && /add about 1\.9 h of study time by 2027-01-10/.test(tight.tradeoff!.summary))
check('whether the owed work fits is the same with or without new study', JSON.stringify(tightFit.all) === JSON.stringify(catchUpFit(week, [], [piece(120)], none, 45).all))
check('a reading never overtakes the one ahead of it', (() => { const f = catchUpFit(days(1, [[0, 20]]), [], [], none, 45, study(200, 10)); return f.forecast!.newStudy.waiting.map(w => w.minutes).join() === '60,10' })())
check('the daily limit on new learning applies', catchUpFit(days(1, [[0, 600]]).slice(0, 1), [], [], none, 180, { ...study(600), dailyMinutes: 200 }).forecast!.newStudy.placed === 200)
check('a fragmented day holds study only in openings worth a sitting', catchUpFit(days(1, [[0, 10], [100, 130], [200, 212]]).slice(0, 1), [], [], none, 45, study(120)).forecast!.newStudy.placed === 30)
const revised = catchUpFit(week, [], [piece(300)], { weeks: ['2027-01-04'], revisionPerWeek: 90, paperMinutes: 0 }, 45, study(60))
check('when revision takes the room, pausing it is offered as the other choice', /or pause revision, which makes room for/.test(recoveryStatus({ ...base, owedMinutes: 300, fit: revised }).tradeoff!.summary))
const held = catchUpFit(week, [], [piece(300)], { weeks: ['2027-01-04'], revisionPerWeek: 90, paperMinutes: 0 }, 45, study(60), true)
check('a protect-core path holds revision until the owed work clears; the offer rule is unchanged', held.forecast!.revisionPlaced === 0 && held.forecast!.revisionWaiting === 0 && held.forecast!.newStudy.placed === 60 && JSON.stringify(held.all) === JSON.stringify(revised.all))
const led = recoveryStatus({ ...base, owedMinutes: 120, fit: catchUpFit(week, [], [piece(120)], none, 45, { items: [], dailyMinutes: 510, notCounted: { minutes: 600, reason: 'It waits behind the mock-led week you accepted.' } }) })
check('mock-led: displaced first-pass study is left out and said to be', led.tradeoff === null && led.numbers.newStudyMinutes === 0 && /Not counted: 10 h of new study\. It waits behind the mock-led week/.test(led.why.join(' ')))
check('new study alone never offers recovery', recoveryStatus({ ...base, owedMinutes: 120, fit: catchUpFit(week, [], [piece(120)], none, 45, study(180, 180, 180, 180)) }).level === 'catching_up')
check('missing data is named, not guessed', /Build your Roadmap/.test(recoveryStatus({ ...base, owedMinutes: 300, fit: null, fitMissing: 'no_roadmap' }).why.join(' ')) && /could not read your Roadmap/.test(recoveryStatus({ ...base, owedMinutes: 300, fit: null, fitMissing: 'unreadable' }).why.join(' ')))

const task2 = (id: string, execution: string, minutes: number, continuedFromId: string | null = null, readingId = 'a'): ReadingTask => ({ id, readingId, taskType: 'study', execution, minutes, continuedFromId })
check('a carried chain is counted once: logged on the earlier link, the remainder on the newest', spokenFor([task2('1', 'partial', 90), task2('2', 'not_started', 60, '1')], new Map([['1', 30]])).get('a') === 90)
check('accepted, completed, skipped and carried study are each taken off; other task types are not', spokenFor([task2('1', 'completed', 40), task2('2', 'skipped', 20), task2('3', 'not_started', 30), { ...task2('4', 'completed', 99), taskType: 'review' }], new Map(), [{ readingId: 'a', minutes: 10 }]).get('a') === 100)
const mod = (id: string, coverage = 'not_started') => ({ id, topic: 't', name: id.toUpperCase(), effortBand: 2, difficulty: 3, sequence: 1, coverage }) as never
const road = { sequencedModuleIds: ['a', 'b', 'c', 'd'], phases: [{ phase: 'first_pass', startDate: '2027-01-04', endDate: '2027-02-28' }, { phase: 'consolidation', startDate: '2027-03-01', endDate: '2027-03-28' }, { phase: 'final', startDate: '2027-03-29', endDate: '2027-05-30' }], milestones: [{ phase: 'first_pass', moduleIds: ['a', 'b'] }, { phase: 'consolidation', moduleIds: ['b', 'c'] }, { phase: 'final', moduleIds: ['d'] }] } as never
const demand = (from: string, end: string, spoken = new Map<string, number>()) => firstPassDemand({ roadmap: road, modules: [mod('d'), mod('c'), mod('b'), mod('a')], from, end, minutesPerEffortUnit: 60, spoken })
check('demand follows the open phases and their order, never final preparation', demand('2027-01-04', '2027-04-30').map(d => `${d.readingId}:${d.minutes}:${d.notBefore ?? ''}`).join() === 'a:120:,b:120:,c:120:2027-03-01')
check('a window before a later phase leaves that phase out; a finished phase is not demanded', demand('2027-01-04', '2027-02-01').map(d => d.readingId).join() === 'a,b' && demand('2027-03-02', '2027-04-30').map(d => d.readingId).join() === 'b,c')
check('minutes already spoken for come off, and a covered reading is not demanded', demand('2027-01-04', '2027-02-01', new Map([['a', 120], ['b', 50]])).map(d => `${d.readingId}:${d.minutes}`).join() === 'b:70' && firstPassDemand({ roadmap: road, modules: [mod('a', 'studied')], from: '2027-01-04', end: '2027-02-01', minutesPerEffortUnit: 60, spoken: new Map() }).length === 0)

// What an accepted mock-led week holds back, and what to say when there is nothing to forecast.
const ask = (o: Partial<Parameters<typeof forecastStudy>[0]> = {}) => forecastStudy({ roadmap: road, modules: [mod('d'), mod('c'), mod('b'), mod('a')], from: '2027-01-11', end: '2027-04-30', minutesPerEffortUnit: 60, spoken: new Map(), mockLedUntil: null, classesRunning: false, ...o })
const ledLater = ask({ mockLedUntil: '2027-01-17' })
check('an accepted mock-led week defers broad study only until it ends: the later readings stay in the forecast', ledLater.items.map(i => `${i.readingId}:${i.notBefore}`).join() === 'a:2027-01-18,b:2027-01-18,c:2027-03-01' && !ledLater.notCounted && ledLater.studyFrom === '2027-01-18')
const ledToEnd = ask({ end: '2027-01-17', mockLedUntil: '2027-01-17' })
check('with no study week left after it, the displaced study is named as left out', ledToEnd.items.length === 0 && ledToEnd.notCounted?.minutes === 240 && /no study week is left in this forecast after it/.test(ledToEnd.notCounted.reason))
const finalPrep = ask({ from: '2027-04-05' })
check('final preparation says it adds no new study', finalPrep.items.length === 0 && /final preparation, which adds no new study/.test(finalPrep.notCounted!.reason) && finalPrep.notCounted!.minutes === 480)
const gapOnly = ask({ roadmap: { ...(road as object), milestones: [{ phase: 'consolidation', moduleIds: ['c'] }] } as never, end: '2027-02-01' })
check('open phases with no unfinished reading scheduled in them say that, not final preparation', gapOnly.items.length === 0 && /no unfinished reading scheduled for first study in this period/.test(gapOnly.notCounted!.reason))
check('while classes run, the reason is that classes set the order', /Your classes set the order of new material/.test(ask({ roadmap: { ...(road as object), milestones: [] } as never, classesRunning: true }).notCounted!.reason))
check('nothing unfinished: nothing is said', ask({ modules: [mod('a', 'studied')] }).notCounted === null && ask({ modules: [] }).items.length === 0)
check('a mature student without a mock week is forecast as before', ask().items.map(i => i.readingId).join() === 'a,b,c' && ask().studyFrom === null)
const heldStatus = recoveryStatus({ ...base, owedMinutes: 120, fit: catchUpFit(days(2, [[1080, 1140]]), [], [piece(120)], none, 45, { items: [{ title: 'Reading A', readingId: 'a', minutes: 60, notBefore: '2027-01-11' }], dailyMinutes: 510, studyFrom: '2027-01-11' }) })
check('the status says when the held study resumes, and counts only that', /holds broad new study until 2027-01-11/.test(heldStatus.why.join(' ')) && heldStatus.numbers.newStudyMinutes === 60)

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
