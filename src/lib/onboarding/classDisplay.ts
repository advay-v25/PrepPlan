import type { OnboardingState } from './state'

export type NextClass = { label: string; date: string; startTime: string; endTime: string }

/** A stored one-off class back into the student's own timezone, for editing and for Review. */
export function nextClassFrom(state: Pick<OnboardingState, 'commitments' | 'profile'>): NextClass | null {
  const row = (state.commitments ?? []).find(c => c.kind === 'class' && c.source === 'onboarding' && (c as any).recurrence === 'none')
  if (!row || !(row as any).starts_at || !(row as any).ends_at) return null
  const tz = state.profile?.timezone || 'UTC'
  const part = (iso: string) => {
    const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    const p = Object.fromEntries(f.formatToParts(new Date(iso)).map(x => [x.type, x.value]))
    return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` }
  }
  const a = part((row as any).starts_at), b = part((row as any).ends_at)
  return { label: String(row.label ?? ''), date: a.date, startTime: a.time, endTime: b.time }
}
