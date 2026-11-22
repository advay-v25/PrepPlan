import { createHash } from 'node:crypto'

/**
 * One-way iCalendar (RFC 5545) snapshot writer. Pure: no I/O. CRLF line ends, UTF-8 folding at 75 octets (never inside a multibyte character),
 * escaped text, UTC instants for timed events, non-inclusive DTEND for all-day events. UIDs are stable hashes of (account, event identity), so the
 * same event keeps its UID across downloads and the account id/email never appears.
 */
export const CALENDAR_EXPORT_PATH = '/api/calendar/export'

export type IcsEvent =
  | { id: string; title: string; description?: string | null; url?: string | null; kind: 'timed'; start: Date; end: Date; category?: string }
  | { id: string; title: string; description?: string | null; url?: string | null; kind: 'allday'; date: string; category?: string }

export const escapeText = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n')

/** Fold at 75 octets, continuation lines start with one space. Splits only between code points. */
export function fold(line: string): string {
  const out: string[] = []; let cur = '', bytes = 0
  for (const ch of line) {
    const n = Buffer.byteLength(ch, 'utf8'), limit = out.length === 0 ? 75 : 74
    if (bytes + n > limit) { out.push(cur); cur = ''; bytes = 0 }
    cur += ch; bytes += n
  }
  out.push(cur)
  return out.map((l, i) => (i === 0 ? l : ' ' + l)).join('\r\n')
}

const utc = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
const day = (s: string) => s.replace(/-/g, '')
const nextDay = (s: string) => new Date(Date.parse(`${s}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
export const eventUid = (accountId: string, eventId: string) => `rm-${createHash('sha256').update(`${accountId}\u0000${eventId}`).digest('hex').slice(0, 32)}@roadmap`

export function buildIcs(accountId: string, events: IcsEvent[], opts: { name: string; stamp?: Date }): string {
  const stamp = utc(opts.stamp ?? new Date())
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//PrepPlan//Calendar snapshot//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${escapeText(opts.name)}`]
  const seen = new Set<string>()
  for (const e of events) {
    const uid = eventUid(accountId, e.id)
    if (seen.has(uid)) continue   // identity, not title: one event per accepted object
    seen.add(uid)
    lines.push('BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${stamp}`, 'SEQUENCE:0')
    if (e.kind === 'timed') lines.push(`DTSTART:${utc(e.start)}`, `DTEND:${utc(e.end)}`, 'TRANSP:OPAQUE')
    else lines.push(`DTSTART;VALUE=DATE:${day(e.date)}`, `DTEND;VALUE=DATE:${day(nextDay(e.date))}`, 'TRANSP:TRANSPARENT')
    lines.push(`SUMMARY:${escapeText(e.title)}`)
    if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`)
    if (e.url) lines.push(`URL:${e.url}`)
    if (e.category) lines.push(`CATEGORIES:${escapeText(e.category)}`)
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.map(fold).join('\r\n') + '\r\n'
}
