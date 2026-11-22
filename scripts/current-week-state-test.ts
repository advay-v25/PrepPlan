/** Pure: every state of "this week has nothing planned", with its destination. This is the contract Home consumes. */
import { ADD_STUDY_TIMES_HREF, REVIEW_PLAN_HREF, deriveCurrentWeekPlanState, type CurrentWeekFacts } from '../src/lib/planning/currentWeek/state'

import { currentWeekCommandError } from '../src/lib/planning/currentWeek/commandError'

let passed = 0, failed = 0
const check = (n: string, ok: boolean, d = '') => { ok ? (passed++, console.log(`  ✓ ${n}`)) : (failed++, console.log(`  ✗ ${n}${d ? ` — ${d}` : ''}`)) }
const base: CurrentWeekFacts = { hasCycle: true, cycleEnded: false, plannedTasks: 0, acceptedBy: 'onboarding', planAccepted: false, availabilityMode: 'windows', hasWindows: true,
  remaining: { minutes: 120, assessmentDayOnly: false, windowsLater: false }, draft: null, discardedFingerprint: null, currentHash: 'h1' }
const f = (o: Partial<CurrentWeekFacts>) => deriveCurrentWeekPlanState({ ...base, ...o })

console.log('\nCanonical states and destinations')
check('no accepted cycle: not applicable', f({ hasCycle: false }).kind === 'not_applicable')
check('a week with planned work needs nothing', f({ plannedTasks: 3 }).kind === 'not_applicable')
let s = f({ availabilityMode: 'none_this_week', hasWindows: false })
check('no study times → Add study times → /onboarding/week?returnTo=%2Fapp%2Fcalendar', s.kind === 'no_study_times' && s.action?.label === 'Add study times' && s.action.href === '/onboarding/week?returnTo=%2Fapp%2Fcalendar' && s.action.href === ADD_STUDY_TIMES_HREF, s.action?.href)
check('"varies" counts as no study times too', f({ availabilityMode: 'varies', hasWindows: false }).kind === 'no_study_times')
s = f({})
check('study times saved and time remains → Review a plan for this week (saving alone does not plan)', s.kind === 'ready_to_plan' && s.action?.label === 'Review a plan for this week' && s.action.href === REVIEW_PLAN_HREF && s.action.kind === 'preview')
s = f({ draft: { id: 'd', revision: 1, fingerprint: 'h1' } })
check('a current proposal is ready for review, carrying its id and revision', s.kind === 'proposal_ready' && s.draft?.id === 'd' && s.draft.revision === 1)
s = f({ draft: { id: 'd', revision: 1, fingerprint: 'OLD' } })
check('a proposal built from an older source state is stale, with a rebuild action', s.kind === 'proposal_stale' && /Rebuild/.test(s.action?.label ?? ''))
s = f({ plannedTasks: 4, planAccepted: true })
check('after acceptance: plan accepted, nothing more to do', s.kind === 'plan_accepted' && s.action === null)
check('kept empty on purpose (same source state) is intentionally empty, and can still be planned', f({ discardedFingerprint: 'h1' }).kind === 'intentionally_empty' && f({ discardedFingerprint: 'h1' }).action?.kind === 'preview')
check('…but once the week or setup changes it is plannable again', f({ discardedFingerprint: 'OLD' }).kind === 'ready_to_plan')
check('an empty week accepted in weekly review is intentionally empty', f({ acceptedBy: 'weekly_review' }).kind === 'intentionally_empty')

console.log('\nWhen no study time remains')
s = f({ remaining: { minutes: 0, assessmentDayOnly: false, windowsLater: true } })
check('windows only on later days: no usable windows, they apply from next week', s.kind === 'no_usable_windows' && s.reason === 'later_week' && /next week/.test(s.message))
s = f({ remaining: { minutes: 0, assessmentDayOnly: true, windowsLater: false } })
check('self-study with only Sunday left: Sunday is for paper and review, not new study', s.kind === 'no_usable_windows' && s.reason === 'assessment_day_only' && /Sunday/.test(s.message))
check('time used up by commitments or the clock', f({ remaining: { minutes: 0, assessmentDayOnly: false, windowsLater: false } }).reason === 'time_used')
s = f({ cycleEnded: true })
check('an ended cycle points at the weekly review, not at adding work', s.kind === 'cycle_ended' && s.action?.href === '/app/review-week')
check('no usable windows offers a way to edit the study times', f({ remaining: { minutes: 0, assessmentDayOnly: false, windowsLater: true } }).action?.href === ADD_STUDY_TIMES_HREF)

check('a saved preview with expired capacity requires rebuilding even when its hash matches', f({ draft: { id: 'd', revision: 1, fingerprint: 'h1', current: false } }).kind === 'proposal_stale')
for (const [kind, href] of [['log_class', '/app/calendar/log-class'], ['add_class', '/app/calendar?action=add-next-class'], ['upcoming_class', '/app/calendar?view=agenda']] as const) {
  check(`class-led waiting state ${kind} opens its useful next action`, f({ classGuidance: kind }).kind === 'awaiting_class_input' && f({ classGuidance: kind }).action?.href === href)
}
check('missing dismissal has a confirmed 404, not an uncertain retry', currentWeekCommandError('NOT_FOUND').status === 404 && !currentWeekCommandError('NOT_FOUND').uncertain)
check('access failure is a confirmed refusal', currentWeekCommandError('ACCESS_REQUIRED').status === 403)
check('ended cycle points to review without asking for a rebuild', currentWeekCommandError('CYCLE_ENDED').nextUrl === '/app/review-week' && !currentWeekCommandError('CYCLE_ENDED').rebuild)
check('unknown save outcome keeps the same-request retry', currentWeekCommandError('network failure').uncertain && currentWeekCommandError('network failure').status === 503)
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
