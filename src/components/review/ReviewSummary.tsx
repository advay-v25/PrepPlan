import { formatStudyDate } from '../../lib/format/date'
import Link from 'next/link'
import { Notice } from '../ui/Notice'
import type { Continuing } from '../../lib/planning/weeklyReview/service'
import type { Displaced } from '../../lib/planning/weeklyReview/composer'

const day = (d: string) => formatStudyDate(d, 'short')

/** What was saved, in the words the student saw in the preview: the same tasks, days and durations. */
export function ReviewSummary({ summary }: { summary: { continuing?: Continuing[]; displaced?: Displaced[]; classFollowUp?: { placed: { title: string; date: string; minutes: number }[]; waiting: { title: string; remainingMinutes: number }[] } } | null }) {
  const continuing = summary?.continuing ?? [], displaced = summary?.displaced ?? []
  const placed = continuing.filter(c => c.placement?.date), waiting = continuing.filter(c => !c.placement?.date)
  return (
    <Notice tone="success" role="status">
      <strong>Your review is saved and this week is open.</strong>
      {continuing.length === 0 && displaced.length === 0 && <> Nothing carried over from last week.</>}
      {placed.length > 0 && (
        <p>Continuing and placed: {placed.map(c => `${c.title} on ${day(c.placement.date!)} (${c.minutes} min)`).join('; ')}.</p>
      )}
      {waiting.length > 0 && (
        <p>Waiting for a place (still visible in this week&apos;s unplaced work): {waiting.map(c => c.title).join('; ')}.</p>
      )}
      {(summary?.classFollowUp?.placed.length ?? 0) > 0 && (
        <p>Class follow-up placed: {summary!.classFollowUp!.placed.map(c => `${c.title} on ${day(c.date)} (${c.minutes} min)`).join('; ')}.</p>
      )}
      {(summary?.classFollowUp?.waiting.length ?? 0) > 0 && (
        <p>Class follow-up still waiting for room: {summary!.classFollowUp!.waiting.map(c => `${c.title} (${c.remainingMinutes} min)`).join('; ')}.</p>
      )}
      {displaced.length > 0 && (
        <p>New work that moved to make room: {displaced.map(d => `${d.title} (${d.mode === 'moved_back' ? 'moved to a later week' : `${d.minutesRemoved} min shorter`})`).join('; ')}.</p>
      )}
      <p className="fine-print">Your earlier weeks are unchanged. <Link href="/app/review-week" className="prose-link">Review</Link> history stays available there.</p>
    </Notice>
  )
}
