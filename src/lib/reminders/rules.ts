import { addDays, utcToZonedParts, zonedTimeToUtc } from '../planning/studyWeek'

/**
 * Reminder rules (pure). Reminders are opt-in, sent at a sensible local time, never inside the student's quiet hours, never after they said
 * they sat the exam, and always re-checked for relevance at send time. A job has a durable identity (`jobKey`), so a retry cannot create a second one.
 */
export type Prefs = { assessmentReminders: boolean; weeklyReviewReminders: boolean; quietStart: string; quietEnd: string }
export type Desired = { kind: 'assessment_upcoming' | 'weekly_review_ready'; refId: string; jobKey: string; sendAt: Date; link: string; subject: string; text: string }

const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m }
/** True when `minutes` (local minutes of day) is inside quiet hours; the window may wrap midnight. */
export function inQuietHours(minutes: number, quietStart: string, quietEnd: string): boolean {
  const s = toMin(quietStart), e = toMin(quietEnd)
  return s === e ? false : s < e ? minutes >= s && minutes < e : minutes >= s || minutes < e
}
/** The first instant at or after `at` that is outside quiet hours, in the student's timezone. */
export function outsideQuiet(at: Date, tz: string, p: Pick<Prefs, 'quietStart' | 'quietEnd'>): Date {
  const parts = utcToZonedParts(at, tz)
  if (!inQuietHours(toMin(parts.time), p.quietStart, p.quietEnd)) return at
  // Quiet hours end at quietEnd: today if we are before it, otherwise tomorrow.
  const day = toMin(parts.time) < toMin(p.quietEnd) ? parts.date : addDays(parts.date, 1)
  return zonedTimeToUtc(day, p.quietEnd, tz)
}

export type DesiredInput = {
  now: Date; tz: string; prefs: Prefs; examSat: boolean
  appointments: { id: string; title: string; date: string; internal: boolean; href: string }[]
  review: { cycleId: string; endsAt: string; ready: boolean } | null
}

export function desiredReminders(i: DesiredInput): Desired[] {
  if (i.examSat) return []
  const out: Desired[] = []
  const at = (date: string, time: string) => outsideQuiet(zonedTimeToUtc(date, time, i.tz), i.tz, i.prefs)
  if (i.prefs.assessmentReminders) {
    for (const a of i.appointments) {
      const when = at(addDays(a.date, -1), '18:00')
      // Only the next couple of days are scheduled; a past send time (the appointment is tomorrow and it is already evening) sends at the next allowed moment.
      if (when.getTime() > i.now.getTime() + 3 * 86_400_000) continue
      const sendAt = when.getTime() < i.now.getTime() ? outsideQuiet(i.now, i.tz, i.prefs) : when
      if (utcToZonedParts(sendAt, i.tz).date > a.date) continue
      out.push({ kind: 'assessment_upcoming', refId: a.id, jobKey: `assessment_upcoming:${a.id}:${a.date}`, sendAt, link: a.href,
        subject: `Coming up: ${a.title} on ${a.date}`, text: `${a.title} is planned for ${a.date}.${a.internal ? ' Your rehearsal has two timed sessions of 135 minutes each; plan the time and a break.' : ' Record what happened afterwards; it stays your own report.'}` })
    }
  }
  if (i.prefs.weeklyReviewReminders && i.review?.ready) {
    const day = utcToZonedParts(i.now, i.tz).date
    out.push({ kind: 'weekly_review_ready', refId: i.review.cycleId, jobKey: `weekly_review_ready:${i.review.cycleId}:${i.review.endsAt}`, sendAt: outsideQuiet(i.now, i.tz, i.prefs),
      link: '/app/review-week', subject: 'Your weekly review is ready', text: `Your week ended ${i.review.endsAt}. The review takes a few minutes and sets up next week.` })
    void day
  }
  return out
}

export type SendCheck = { prefsOk: boolean; stillPlanned: boolean; examSat: boolean; now: Date; tz: string; quiet: Pick<Prefs, 'quietStart' | 'quietEnd'> }
/** Re-checked at send time: 'send', 'cancel' (no longer relevant, with the reason) or 'later' (inside quiet hours; reschedule). */
export function sendDecision(c: SendCheck): { action: 'send' } | { action: 'cancel'; reason: string } | { action: 'later'; at: Date } {
  if (c.examSat) return { action: 'cancel', reason: 'exam_complete' }
  if (!c.prefsOk) return { action: 'cancel', reason: 'opted_out' }
  if (!c.stillPlanned) return { action: 'cancel', reason: 'no_longer_relevant' }
  const next = outsideQuiet(c.now, c.tz, c.quiet)
  return next.getTime() > c.now.getTime() ? { action: 'later', at: next } : { action: 'send' }
}
