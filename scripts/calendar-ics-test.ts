import ICAL from 'ical.js'
import { buildIcs, escapeText, fold, eventUid } from '../src/lib/calendar/ics'
import { zonedTimeToUtc, addDays } from '../src/lib/planning/studyWeek'
import { parseExportOptions, ExportInputError } from '../src/lib/calendar/exportService'

let p = 0, f = 0
const ok = (n: string, c: boolean, d = '') => { c ? (p++, console.log('  ✓', n)) : (f++, console.log('  ✗', n, d)) }
const parse = (s: string) => new ICAL.Component(ICAL.parse(s)).getAllSubcomponents('vevent')

const long = 'Étude — 日本語のタイトル, with; commas\nand a newline ' + 'x'.repeat(200)
const start = zonedTimeToUtc('2026-03-29', '09:30', 'Europe/London')     // clocks change that day: BST starts 01:00 GMT
const ics = buildIcs('acct-1', [
  { id: 't1', title: long, description: 'Objective; with, punctuation\\ and a\nnewline', url: 'http://localhost:3141/app/calendar?task=t1', kind: 'timed', start, end: new Date(start.getTime() + 45 * 60_000), category: 'study' },
  { id: 't2', title: 'All-day reminder', kind: 'allday', date: '2026-12-31' },
  { id: 't1', title: 'Same event, different title', kind: 'allday', date: '2026-03-29' },   // same identity: exported once
], { name: 'Roadmap schedule (snapshot)', stamp: new Date('2026-11-14T10:00:00Z') })

ok('CRLF everywhere, never a bare LF', !/[^\r]\n/.test(ics) && ics.endsWith('\r\n'))
ok('no physical line exceeds 75 octets', ics.split('\r\n').every(l => Buffer.byteLength(l, 'utf8') <= 75))
const evs = parse(ics)
ok('an independent parser reads two events (identity dedupes, not title)', evs.length === 2)
const e1 = evs.find(e => e.getFirstPropertyValue('summary')?.toString().startsWith('Étude'))!
ok('Unicode, commas, semicolons and newlines survive a round trip', e1.getFirstPropertyValue('summary') === long && e1.getFirstPropertyValue('description') === 'Objective; with, punctuation\\ and a\nnewline')
ok('timed event is the correct UTC instant across the London DST change (09:30 BST = 08:30Z)', (e1.getFirstPropertyValue('dtstart') as any).toJSDate().toISOString() === '2026-03-29T08:30:00.000Z' && (e1.getFirstPropertyValue('dtend') as any).toJSDate().toISOString() === '2026-03-29T09:15:00.000Z')
ok('Asia/Kolkata 19:00 is 13:30Z (no DST)', zonedTimeToUtc('2026-11-14', '19:00', 'Asia/Kolkata').toISOString() === '2026-11-14T13:30:00.000Z')
const e2 = evs.find(e => e.getFirstPropertyValue('summary') === 'All-day reminder')!
const ds = e2.getFirstProperty('dtstart')!, de = e2.getFirstProperty('dtend')!
ok('all-day uses VALUE=DATE with a non-inclusive end, across a year boundary, and does not block time', ds.type === 'date' && /DTSTART;VALUE=DATE:20261231/.test(ics) && (ds.getFirstValue() as any).toString() === '2026-12-31' && (de.getFirstValue() as any).toString() === '2027-01-01' && e2.getFirstPropertyValue('transp') === 'TRANSPARENT')
ok('UIDs are stable per identity, differ per account and never carry the account id', eventUid('acct-1', 't1') === e1.getFirstPropertyValue('uid') && eventUid('acct-1', 't1') !== eventUid('acct-2', 't1') && !ics.includes('acct-1'))
ok('fold never splits a multibyte character', (() => { const t = fold('SUMMARY:' + '日'.repeat(60)); return t.split('\r\n').every(l => !l.includes('�')) && t.replace(/\r\n /g, '') === 'SUMMARY:' + '日'.repeat(60) })())
ok('escapeText escapes backslash first', escapeText('a\\b;c,d\ne') === 'a\\\\b\\;c\\,d\\ne')
{
  // Exact bytes, independent of any JavaScript string-literal escaping: ';' must be 0x5C 0x3B, ',' 0x5C 0x2C, newline 0x5C 'n', backslash 0x5C 0x5C.
  const b = Buffer.from(escapeText('a;b,c\\d\ne'), 'utf8')
  ok('TEXT escaping bytes (RFC 5545 3.3.11): a 5C3B b 5C2C c 5C5C d 5C6E e', b.toString('hex') === '61' + '5c3b' + '62' + '5c2c' + '63' + '5c5c' + '64' + '5c6e' + '65', b.toString('hex'))
  const wire = buildIcs('a', [{ id: 'x', title: 'one;two', kind: 'allday', date: '2026-11-14' }], { name: 'n' })
  ok('the wire format carries the escaped semicolon in SUMMARY', wire.includes('SUMMARY:one\\;two'))
}
const empty = buildIcs('a', [], { name: 'x' })
ok('an empty range is a valid empty calendar', new ICAL.Component(ICAL.parse(empty)).getAllSubcomponents('vevent').length === 0 && empty.startsWith('BEGIN:VCALENDAR'))

const q = (s: string) => new URLSearchParams(s)
ok('defaults: today plus 34 days (this week and the next four)', (() => { const o = parseExportOptions(q(''), '2026-11-14'); return o.from === '2026-11-14' && o.to === addDays('2026-11-14', 34) && !o.classes && !o.history })())
const bad = (s: string) => { try { parseExportOptions(q(s), '2026-11-14'); return false } catch (e) { return e instanceof ExportInputError } }
ok('invalid, reversed and oversized ranges are refused', bad('from=nope') && bad('from=2026-12-01&to=2026-11-01') && bad('from=2026-01-01&to=2026-12-31'))
console.log(`\n${p} passed, ${f} failed`); process.exit(f ? 1 : 0)
