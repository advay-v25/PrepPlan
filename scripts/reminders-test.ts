/** Pure tests for reminder rules: opt-in, timezone, quiet hours (incl. wrap past midnight), exam-complete pause, durable job keys, send-time relevance. */
import { desiredReminders, inQuietHours, outsideQuiet, sendDecision, type Prefs } from '../src/lib/reminders/rules'

let passed = 0, failed = 0
const check = (n: string, ok: boolean, d = '') => { ok ? (passed++, console.log(`  ✓ ${n}`)) : (failed++, console.log(`  ✗ ${n}${d ? ` — ${d}` : ''}`)) }
const prefs: Prefs = { assessmentReminders: true, weeklyReviewReminders: true, quietStart: '21:00', quietEnd: '08:00' }
const appt = { id: 'a1', title: 'Coaching mock', date: '2026-11-10', internal: false, href: '/app/calendar?appointment=a1#checkpoint' }
const base = { now: new Date('2026-11-09T10:00:00Z'), tz: 'Europe/London', prefs, examSat: false, appointments: [appt], review: null }

console.log('\nQuiet hours\n')
check('21:00–08:00 wraps midnight', inQuietHours(22 * 60, '21:00', '08:00') && inQuietHours(3 * 60, '21:00', '08:00') && !inQuietHours(12 * 60, '21:00', '08:00'))
check('equal start and end means no quiet hours', !inQuietHours(0, '08:00', '08:00'))
check('a send time inside quiet hours waits until they end, in the student\'s timezone', outsideQuiet(new Date('2026-11-09T22:30:00Z'), 'Europe/London', prefs).toISOString() === '2026-11-10T08:00:00.000Z')
check('Auckland is a different local clock: 22:30 UTC is already morning there', outsideQuiet(new Date('2026-11-09T22:30:00Z'), 'Pacific/Auckland', prefs).toISOString() === '2026-11-09T22:30:00.000Z')

console.log('\nWhat is scheduled\n')
const d = desiredReminders(base)
check('opted in: one reminder the evening before, with a durable key and the exact appointment link', d.length === 1 && d[0].jobKey === 'assessment_upcoming:a1:2026-11-10' && d[0].link === appt.href && d[0].sendAt.toISOString() === '2026-11-09T18:00:00.000Z')
check('not opted in: nothing', desiredReminders({ ...base, prefs: { ...prefs, assessmentReminders: false } }).length === 0)
check('after the student sat the exam: nothing', desiredReminders({ ...base, examSat: true }).length === 0)
check('moving the appointment changes the key (the old job is obsolete, the new one is distinct)', desiredReminders({ ...base, appointments: [{ ...appt, date: '2026-11-11' }] })[0].jobKey === 'assessment_upcoming:a1:2026-11-11')
check('the same state twice gives the same keys (retries cannot duplicate)', JSON.stringify(desiredReminders(base).map(x => x.jobKey)) === JSON.stringify(desiredReminders(base).map(x => x.jobKey)))
check('an appointment far away is not scheduled yet', desiredReminders({ ...base, appointments: [{ ...appt, date: '2026-12-20' }] }).length === 0)
check('already evening the day before: it goes at the next allowed moment, never into quiet hours', (() => { const x = desiredReminders({ ...base, now: new Date('2026-11-09T22:00:00Z') })[0]; return !x || x.sendAt.toISOString() === '2026-11-10T08:00:00.000Z' })())
const wr = desiredReminders({ ...base, appointments: [], review: { cycleId: 'c1', endsAt: '2026-11-08', ready: true } })
check('a weekly review that is ready makes one reminder linking the review', wr.length === 1 && wr[0].link === '/app/review-week' && wr[0].jobKey === 'weekly_review_ready:c1:2026-11-08')
check('a review that is not ready makes none', desiredReminders({ ...base, appointments: [], review: { cycleId: 'c1', endsAt: '2026-11-08', ready: false } }).length === 0)

console.log('\nChecked again at send time\n')
const c = { prefsOk: true, stillPlanned: true, examSat: false, now: new Date('2026-11-09T18:00:00Z'), tz: 'Europe/London', quiet: prefs }
check('relevant and outside quiet hours: send', sendDecision(c).action === 'send')
check('the student opted out meanwhile: cancel', JSON.stringify(sendDecision({ ...c, prefsOk: false })) === '{"action":"cancel","reason":"opted_out"}')
check('the appointment moved or finished: cancel', JSON.stringify(sendDecision({ ...c, stillPlanned: false })) === '{"action":"cancel","reason":"no_longer_relevant"}')
check('exam sat meanwhile: cancel', JSON.stringify(sendDecision({ ...c, examSat: true })) === '{"action":"cancel","reason":"exam_complete"}')
check('inside quiet hours at send time: later, not now', sendDecision({ ...c, now: new Date('2026-11-09T22:00:00Z') }).action === 'later')
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
