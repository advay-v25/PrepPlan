/**
 * What the clock does in an assessment, from the attempt's own record (the same rule the pause endpoint enforces: a session with a time
 * limit or a deadline cannot be paused; an untimed one can). Wording is derived from that, never assumed.
 */
export type ClockAttempt = { time_limit_minutes: number | null; deadline_at: string | null }
export type ClockPolicy = 'untimed_pausable' | 'timed_running'

export function clockPolicy(a: ClockAttempt): ClockPolicy { return a.time_limit_minutes || a.deadline_at ? 'timed_running' : 'untimed_pausable' }

export function clockWording(a: ClockAttempt, timeZone = 'UTC'): string {
  if (clockPolicy(a) === 'untimed_pausable') return 'There is no time limit. You can pause and resume.'
  const limit = a.time_limit_minutes ? `${a.time_limit_minutes} minutes` : 'a fixed time'
  const until = a.deadline_at ? ` until ${new Intl.DateTimeFormat('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone }).format(new Date(a.deadline_at))}` : ''
  return `Timed: ${limit}. The clock keeps running${until} and cannot be paused.`
}
