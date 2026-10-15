import {
  BookOpen, Check, ClipboardCheck, Crosshair, GraduationCap, Lock, RefreshCw, Timer, Wrench, CalendarClock,
} from 'lucide-react'
import type { CalendarEntry } from '../../lib/planning/calendarData'

/**
 * How a calendar block looks. Kept apart from the grid so the week view, the
 * "no set time" chips, the agenda and the legend all read as one system.
 *
 * Type is carried by an icon and a word, never by colour alone. The colour
 * still helps at a glance, but a student who cannot tell violet from blue can
 * still tell a class from a study block.
 */

export const LAYER_LABEL: Record<string, string> = {
  commitment: 'Commitment', class: 'Class', study: 'Study', review: 'Review',
  diagnostic: 'Diagnostic', repair: 'Repair', recheck: 'Re-check', mock: 'Mock', other: 'Task',
}

const ICONS: Record<string, typeof BookOpen> = {
  study: BookOpen, review: RefreshCw, diagnostic: ClipboardCheck, repair: Wrench,
  recheck: Crosshair, mock: Timer, class: GraduationCap, commitment: Lock, other: CalendarClock,
}

export function LayerIcon({ layer, size = 14 }: { layer: string; size?: number }) {
  const Icon = ICONS[layer] ?? CalendarClock
  return <Icon size={size} strokeWidth={2} aria-hidden className="cb-icon" />
}

/**
 * The block's height decides how much it can say. A 20-minute repair is one
 * line; a 2-hour mock has room for its type, title, time and status.
 */
export type BlockSize = 'xs' | 'sm' | 'md' | 'lg'
export function sizeFor(heightPx: number): BlockSize {
  if (heightPx < 38) return 'xs'
  if (heightPx < 58) return 'sm'
  if (heightPx < 88) return 'md'
  return 'lg'
}

function clock(minutes: number, withSuffix: boolean) {
  const h = Math.floor(minutes / 60) % 24
  const m = minutes % 60
  const hour12 = h % 12 === 0 ? 12 : h % 12
  const time = m === 0 ? `${hour12}` : `${hour12}:${String(m).padStart(2, '0')}`
  return withSuffix ? `${time}${h < 12 ? 'am' : 'pm'}` : time
}

/** "5:30–6:30pm", or "11:30am–12:30pm" when the range crosses noon. */
export function timeRange(start: number, duration: number) {
  const end = start + duration
  const sameHalf = Math.floor(start / 720) === Math.floor((end - 1) / 720) && end <= 1440
  return sameHalf ? `${clock(start, false)}–${clock(end, true)}` : `${clock(start, true)}–${clock(end, true)}`
}

export function durationLabel(minutes: number) {
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`
}

/** "45m", "1h", "1h 30m": short enough for a block's time line. */
export function durationShort(minutes: number) {
  if (minutes < 60) return `${minutes}m`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

export function statusOf(entry: Pick<CalendarEntry, 'execution'>): 'done' | 'partial' | 'active' | null {
  if (entry.execution === 'completed') return 'done'
  if (entry.execution === 'partial') return 'partial'
  if (entry.execution === 'in_progress') return 'active'
  return null
}

const STATUS_WORDS = { done: 'Done', partial: 'Partly done', active: 'In progress' } as const

/** Everything a screen reader needs, in one sentence, since the visual is icon-led. */
export function blockSummary(entry: CalendarEntry) {
  const status = statusOf(entry)
  return [
    LAYER_LABEL[entry.layer] ?? entry.layer,
    entry.title,
    entry.startMinutes !== null ? timeRange(entry.startMinutes, entry.durationMinutes) : 'no set time',
    durationLabel(entry.durationMinutes),
    status ? STATUS_WORDS[status] : null,
    entry.isProtected ? 'fixed, cannot be moved' : null,
  ].filter(Boolean).join(', ')
}

/** The title as shown on a block: the icon and colour already say "Study", so the prefix is dropped. */
export function displayTitle(entry: Pick<CalendarEntry, 'title' | 'layer'>) {
  return entry.layer === 'study' ? entry.title.replace(/^Study:\s*/, '') : entry.title
}

/** Contents of a timed block. Layout per size lives in CSS (`[data-size]`). The enclosing button carries `aria-label={blockSummary(entry)}`. */
export function BlockFace({ entry }: { entry: CalendarEntry }) {
  const status = statusOf(entry)
  return (
    <>
      <LayerIcon layer={entry.layer} />
      <span className="cb-kind">{LAYER_LABEL[entry.layer] ?? entry.layer}</span>
      <span className="cb-title calendar-event__title">{displayTitle(entry)}</span>
      {status === 'done' && <span className="cb-badge" aria-hidden><Check size={10} strokeWidth={3.5} /></span>}
      {entry.isProtected && status !== 'done' && <Lock size={11} strokeWidth={2.25} aria-hidden className="cb-lock" />}
      {entry.startMinutes !== null && (
        <span className="cb-meta calendar-event__time">
          {timeRange(entry.startMinutes, entry.durationMinutes)}
          <span className="cb-dur"> · {durationShort(entry.durationMinutes)}</span>
        </span>
      )}
      {status && status !== 'done' && <span className="cb-status">{STATUS_WORDS[status]}</span>}
      {status === 'partial' && <span className="cb-progress" aria-hidden />}
    </>
  )
}
