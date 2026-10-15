/**
 * Flashcard scheduling (pure). A small SM-2 variant with four ratings.
 * Ratings are the student's own recall report: they schedule review and are
 * never evidence, so they cannot move a readiness band.
 */

export type Rating = 'again' | 'hard' | 'good' | 'easy'
export const RATINGS: Rating[] = ['again', 'hard', 'good', 'easy']

export type CardState = { intervalDays: number; ease: number; reps: number; lapses: number }
export type ReviewResult = CardState & { dueAt: string }

const MIN_EASE = 1.3, MAX_EASE = 3.5
/** Nothing waits longer than a year — and repeated 'easy' would otherwise grow without bound. */
export const MAX_INTERVAL_DAYS = 365
const clampEase = (e: number) => Math.min(MAX_EASE, Math.max(MIN_EASE, Math.round(e * 100) / 100))

export function scheduleReview(card: CardState, rating: Rating, now: Date): ReviewResult {
  let { intervalDays, ease, reps, lapses } = card
  let dueMs: number

  if (rating === 'again') {
    lapses += 1; reps = 0; intervalDays = 0; ease = clampEase(ease - 0.2)
    dueMs = now.getTime() + 10 * 60_000 // see it again this session
  } else {
    if (rating === 'hard') {
      intervalDays = reps === 0 ? 1 : Math.max(1, Math.round(intervalDays * 1.2)); ease = clampEase(ease - 0.15)
    } else if (rating === 'good') {
      intervalDays = reps === 0 ? 1 : reps === 1 ? 3 : Math.max(1, Math.round(intervalDays * ease))
    } else {
      intervalDays = reps === 0 ? 3 : Math.max(2, Math.round(intervalDays * ease * 1.3)); ease = clampEase(ease + 0.15)
    }
    intervalDays = Math.min(MAX_INTERVAL_DAYS, intervalDays)
    reps += 1
    dueMs = now.getTime() + intervalDays * 86_400_000
  }
  return { intervalDays, ease, reps, lapses, dueAt: new Date(dueMs).toISOString() }
}

export const isDue = (dueAt: string, now: Date) => new Date(dueAt).getTime() <= now.getTime()
