import type { CoachIntent } from './actions'

/**
 * One registry of what the Coach does, read by the API (hint validation), the quick actions and the tests.
 *  - `execute`: the Coach prepares a reviewed change that the student confirms, applied by the existing atomic command.
 *  - `handoff`: the Coach explains from real state and opens the exact existing page or editor. It does not change anything.
 *  - `boundary`: declined, with the valid alternative.
 * `context` is what must resolve on the server before the answer is specific; without it the Coach asks one question.
 */
export type CapabilityMode = 'execute' | 'handoff' | 'boundary' | 'model'
export type Capability = { intent: CoachIntent; mode: CapabilityMode; service: string; context?: 'selected_task' | 'owned_attempt'; quick?: { label: string; text: string } }

export const CAPABILITIES: Capability[] = [
  { intent: 'today', mode: 'handoff', service: 'operating state → Calendar task', quick: { label: 'What should I do today?', text: 'What should I do today?' } },
  { intent: 'day_was_bad', mode: 'execute', service: 'confirm_coach_proposal (defer, then redistribute)', quick: { label: 'I missed today', text: 'I missed today and could not study.' } },
  { intent: 'move_block', mode: 'execute', service: 'confirm_coach_proposal (one reviewed task)', context: 'selected_task' },
  { intent: 'availability', mode: 'handoff', service: 'onboarding week editor', quick: { label: 'My availability changed', text: 'My availability changed.' } },
  { intent: 'lighter', mode: 'handoff', service: 'weekly adaptation record', quick: { label: 'Why is my week lighter?', text: 'Why did my week get lighter?' } },
  { intent: 'result', mode: 'handoff', service: 'result service', context: 'owned_attempt', quick: { label: 'What do I do about my result?', text: 'What should I do about this result?' } },
  { intent: 'slow', mode: 'handoff', service: 'result timing finding → timed practice preflight' },
  { intent: 'mock', mode: 'handoff', service: 'checkpoint view + rehearsal decision' },
  { intent: 'struggling', mode: 'handoff', service: 'repair follow-up (result page owns preview/accept)' },
  { intent: 'redo', mode: 'handoff', service: 'repair follow-up (result page owns preview/accept)' },
  { intent: 'next', mode: 'handoff', service: 'operating state, revision rotation, Tests decision', quick: { label: 'What should I focus on?', text: 'What should I focus on next?' } },
  { intent: 'log_class', mode: 'handoff', service: '/app/calendar/log-class' },
  { intent: 'log_learning', mode: 'handoff', service: '/app/log' },
  { intent: 'exam', mode: 'handoff', service: '/app/exam' },
  { intent: 'teach', mode: 'boundary', service: 'none: curriculum teaching is out of scope' },
  { intent: 'free', mode: 'model', service: 'bounded wording over server-chosen options' },
]

export const capabilityOf = (intent: CoachIntent) => CAPABILITIES.find(c => c.intent === intent)!
/** Primary suggestions: three at most, chosen for the state; teaching is never advertised. */
export const QUICK_ACTIONS = CAPABILITIES.filter(c => c.quick).map(c => ({ intent: c.intent, ...c.quick! }))
/** Intents a client may send as a hint. The server still re-derives the intent from the message. */
export const HINTABLE = QUICK_ACTIONS.map(q => q.intent)
