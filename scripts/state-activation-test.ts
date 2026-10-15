import { deriveActivation } from '../src/lib/state/derive'
import { selectNextAction } from '../src/lib/state/nextActionSelector'
import { OperatingState } from '../src/lib/state/types'
import { calendarTaskHref } from '../src/lib/routing/calendar'

let passed = 0, failed = 0
const check = (n: string, ok: boolean, d = '') => { ok ? (passed++, console.log(`  ✓ ${n}`)) : (failed++, console.log(`  ✗ ${n}${d ? ` — ${d}` : ''}`)) }
const eq = (n: string, a: unknown, b: unknown) => check(n, a === b, `got ${a}, wanted ${b}`)

console.log('\nActivation State Logic\n')

eq('missing cycle with active roadmap triggers preview_required', deriveActivation('completed', 'roadmap_123', null, null, false), 'preview_required')
eq('failed activation overrides draft state', deriveActivation('completed', 'roadmap_123', null, 'ready', true), 'activation_failed')

const mockState: OperatingState = {
  schemaVersion: 1,
  generatedAt: '2026-09-19T00:00:00Z',
  timezone: 'UTC',
  dataVersion: 1,
  activation: 'preview_required',
  identity: { userId: '1', examDate: null, examWindowId: null, classPattern: 'none', weekAvailabilityMode: 'windows', hasKnownNextClass: false, indicativeExamDate: null, examSitting: null },
  roadmap: { 
    id: 'rm_123', 
    revision: 0,
    availability: 'available',
    destination: '/app/curriculum',
    permittedCommands: [],
    phase: 'first_pass', 
    status: 'active', 
    route: 'coaching',
    currentMilestoneId: 'ms_1', 
    nextMilestoneId: null, 
    trajectory: 'holding', 
    projectedRange: null 
  },
  cycle: null,
  integrity: {
    isStale: false,
    crossPageInvariantFailed: false,
    activationFailed: false,
    insufficientPaperBank: false,
    partialServiceFailure: []
  },
  today: { dateLocal: '2026-09-19', blocks: [], protectedCommitments: [] },
  execution: { completedMinutes: 0, partialMinutes: 0, deferredMinutes: 0, skippedMinutes: 0, unreportedMinutes: 0, deviations: [] },
  papers: { availablePapers: [], activeReservation: null },
  evidence: { recentChanges: [], preparednessBand: null },
  preparedness: null,
  repairs: { openThreads: [], proposals: [] },
  attention: [],
  nextAction: null,
  capabilities: { canTakeDiagnostic: false, canTakeRevisionary: false, canCloseWeek: false }
}

const action = selectNextAction(mockState)
eq('when activation is preview_required, selector prioritizes Prepare this week action', action.code, 'recover_activation')
eq('Prepare this week action directs to /app/calendar', action.destination, '/app/calendar')

mockState.activation = 'ready'
mockState.today.blocks = [{
  id: 'study-1', revision: 2, availability: 'available', destination: '', permittedCommands: [],
  title: 'Work through cash flows', detail: '', taskType: 'study', origin: 'planner',
  durationMinutes: 45, placement: 'day_preferred', startsAt: null, execution: 'not_started',
}]
eq('next session opens its exact task and day', selectNextAction(mockState).destination, calendarTaskHref('study-1', mockState.today.dateLocal))
mockState.today.blocks[0].execution = 'in_progress'
eq('resume opens the same task rather than generic agenda', selectNextAction(mockState).destination, calendarTaskHref('study-1', mockState.today.dateLocal))
mockState.today.blocks[0].execution = 'not_started'
mockState.today.blocks[0].placement = 'timed'
mockState.today.blocks[0].startsAt = '2026-09-19T10:00:00Z'
eq('timed action opens its exact task', selectNextAction(mockState).destination, calendarTaskHref('study-1', mockState.today.dateLocal))
mockState.today.blocks[0].placement = 'floating'
eq('unplaced action opens its exact task', selectNextAction(mockState).destination, calendarTaskHref('study-1', mockState.today.dateLocal))

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
