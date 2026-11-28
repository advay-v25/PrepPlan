/** One-off windows for a proposed week (pure): validation against the week and taken time, and what each window enables. */
import { fillWindows, parseExtraWindows, type FillItem } from '../src/lib/planning/extraWindows'
let passed = 0, failed = 0
const check = (n: string, ok: boolean, d = '') => { ok ? (passed++, console.log(`  ✓ ${n}`)) : (failed++, console.log(`  ✗ ${n}${d ? ` — ${d}` : ''}`)) }
const week = ['2027-01-04', '2027-01-05', '2027-01-06']
const win = (date: string, start: string, end: string) => ({ date, start, end })
const ok = parseExtraWindows([win('2027-01-05', '07:00', '08:00'), win('2027-01-04', '12:00', '14:30')], week, '2027-01-04')
check('valid windows are accepted and ordered', ok.errors.length === 0 && ok.windows[0].date === '2027-01-04' && ok.windows[0].start === 720)
check('outside the week or already passed is refused', parseExtraWindows([win('2027-02-01', '07:00', '08:00')], week, '2027-01-04').errors.length === 1 && parseExtraWindows([win('2027-01-04', '07:00', '08:00')], week, '2027-01-05').errors.length === 1)
check('too short, too long, backwards or garbled is refused', [['07:00', '07:10'], ['07:00', '20:00'], ['09:00', '08:00'], ['7', '8']].every(([a, b]) => parseExtraWindows([win('2027-01-04', a, b)], week, '2027-01-04').errors.length === 1))
check('two added windows may not overlap', parseExtraWindows([win('2027-01-04', '07:00', '08:00'), win('2027-01-04', '07:30', '09:00')], week, '2027-01-04').errors.length === 1)
check('a window over booked time names what is there', /“Work”/.test(parseExtraWindows([win('2027-01-04', '09:00', '10:00')], week, '2027-01-04', { '2027-01-04': [{ start: 540, end: 1050, title: 'Work' }] }).errors[0]))
check('too many windows are refused', parseExtraWindows(Array(8).fill(win('2027-01-04', '07:00', '08:00')), week, '2027-01-04').errors.length === 1)

const item = (key: string, minutes: number, kind: FillItem['kind'] = 'continuing', notBefore?: FillItem['notBefore']): FillItem => ({ key, title: key, minutes, kind, notBefore })
let f = fillWindows(ok.windows, [item('a', 45), item('b', 45), item('c', 45), item('d', 45), item('e', 45)], 45)
check('each window says what it enables, in order, and what still waits', f.perWindow[0].items.map(i => i.key).join() === 'a,b,c' && f.perWindow[1].items.map(i => i.key).join() === 'd' && f.waiting.map(i => i.key).join() === 'e' && f.perWindow[0].unusedMinutes === 15)
check('sittings follow each other without overlapping', f.placed[1].start === f.placed[0].start + 45)
check('a sitting over the limit is not squeezed in', /longer than your 45-minute sitting/.test(fillWindows(ok.windows, [item('long', 60)], 45).waiting[0].reason))
check('a mock keeps its own clock past the sitting limit', fillWindows(ok.windows, [item('m', 135, 'mock')], 45).placed.length === 1)
f = fillWindows(ok.windows, [item('debrief', 30, 'debrief', { date: '2027-01-04', start: 855 })], 45)
check('a debrief never starts before its mock ends', f.placed[0].date === '2027-01-05' || f.placed[0].start >= 855)
check('no window: everything waits and says so', /No extra window/.test(fillWindows([], [item('a', 30)], 45).waiting[0].reason))
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
