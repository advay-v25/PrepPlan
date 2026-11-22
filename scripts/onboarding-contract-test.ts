/** Pure tests for the onboarding entry contract: exam sitting selection, booked-date validation, split-sitting grouping, assessment wording. */
import { bookedDateProblem, isSelectableSitting } from '../src/lib/onboarding/examWindows'
import { groupSittings } from '../src/lib/onboarding/sittingGroups'
import { stageFromPlannedPaper, stageFromWeeklyPrimary } from '../src/lib/tests/assessmentStage'

let passed = 0, failed = 0
const check = (n: string, ok: boolean, d = '') => { ok ? (passed++, console.log(`  ✓ ${n}`)) : (failed++, console.log(`  ✗ ${n}${d ? ` — ${d}` : ''}`)) }

console.log('\nCandidate entering during an OPEN sitting (fixture: opened 3 days ago, closes in 4)')
{
  // A fixture window: the real 2027 sittings are all in the future, so this is the only way to exercise the open-sitting case.
  const now = '2027-05-14T09:00:00.000Z'
  const open = { window_opens: '2027-05-11T18:30:00.000Z', window_closes: '2027-05-17T18:30:00.000Z', sitting: 'may', year: 2027 }
  const closed = { window_opens: '2027-02-15T18:30:00.000Z', window_closes: '2027-02-21T18:30:00.000Z', sitting: 'february', year: 2027 }
  const upcoming = { window_opens: '2027-08-16T18:30:00.000Z', window_closes: '2027-08-22T18:30:00.000Z', sitting: 'august', year: 2027 }
  check('an open sitting is still selectable (the old filter required window_opens > today)', isSelectableSitting(open, now))
  check('a finished sitting is not', !isSelectableSitting(closed, now))
  check('a future sitting is', isSelectableSitting(upcoming, now))
  check('a future booked date inside the open sitting month is accepted', bookedDateProblem(open, '2027-05-16', '2027-05-14') === null)
  check('today itself is accepted', bookedDateProblem(open, '2027-05-14', '2027-05-14') === null)
  check('a date already past is refused with a plain reason', /already passed/.test(bookedDateProblem(open, '2027-05-12', '2027-05-14') ?? ''))
  check('a date in another month is refused', /not in the May 2027 sitting/.test(bookedDateProblem(open, '2027-06-02', '2027-05-14') ?? ''))
  check('a window with no closing date falls back to its opening date', isSelectableSitting({ window_opens: '2027-09-01T00:00:00.000Z', window_closes: null }, now) && !isSelectableSitting({ window_opens: null, window_closes: null }, now))
}

console.log('\nSplit sittings group under their reading; every task stays inspectable')
{
  const t = (id: string, title: string, m: number, d = '2026-11-09', type = 'study') => ({ id, title, duration_minutes: m, local_date: d, task_type: type })
  const g = groupSittings([t('a', 'Reading 3 · sitting 1 of 3', 60), t('b', 'Reading 3 · sitting 2 of 3', 60), t('c', 'Reading 3 · sitting 3 of 3', 40), t('d', 'Reading 4', 30), t('e', 'Reading 3 · sitting 1 of 2', 50, '2026-11-10'), t('p', 'Weekly paper', 90, '2026-11-15', 'diagnostic')])
  check('three sittings of one reading on one day become one group of 160 minutes', g[0].title === 'Reading 3' && g[0].items.length === 3 && g[0].minutes === 160)
  check('an unsplit task stays a single-item group', g[1].items.length === 1 && g[1].title === 'Reading 4')
  check('the same reading on another day is its own group', g[2].date === '2026-11-10' && g[2].items.length === 1)
  check('the paper keeps its marker', g[3].paper === true)
  check('nothing is lost: every task id is present', g.flatMap(x => x.items.map(i => i.id)).sort().join('') === 'abcdep')
}

console.log('\nOne assessment vocabulary')
{
  check('a planned paper is a scheduled paper', stageFromPlannedPaper({ kind: 'paper', reason: null }) === 'scheduled_paper')
  check('no scope is a weekly checkpoint', stageFromPlannedPaper({ kind: 'none', reason: 'no_scope' }) === 'weekly_checkpoint')
  check('an insufficient bank is unavailable coverage', stageFromPlannedPaper({ kind: 'none', reason: 'insufficient_bank' }) === 'unavailable_coverage')
  check('Calendar: scope to confirm is awaiting confirmed work', stageFromWeeklyPrimary({ kind: 'confirm_scope' }) === 'awaiting_confirmed_work' && stageFromWeeklyPrimary({ kind: 'no_scope' }) === 'awaiting_confirmed_work')
  check('Calendar: a blocked start is unavailable coverage, a clear one a scheduled paper', stageFromWeeklyPrimary({ kind: 'start', blocked: 'x' }) === 'unavailable_coverage' && stageFromWeeklyPrimary({ kind: 'start', blocked: null }) === 'scheduled_paper')
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
