import { classifyIntent, planProposals, planLinks, pickRecheckDate, deterministicReply, FULL_DAY_MINUTES, type CoachSituation } from '../src/lib/coach/actions'
let p = 0, f = 0
const ok = (n: string, c: boolean) => { c ? p++ : (f++, console.log('  ✗', n)) }

ok('bad day is recognised', classifyIntent('I had a terrible day and could not study') === 'day_was_bad' || classifyIntent('today was a bad day') === 'day_was_bad')
ok('struggling is recognised', classifyIntent('Why do I keep getting duration wrong?') === 'struggling')
ok('redo is recognised', classifyIntent('can I try again on that?') === 'redo')
ok('next is recognised', classifyIntent('What should I focus on?') === 'next')
ok('ordinary text is free', classifyIntent('hello there') === 'free')
ok('tutoring-ish text does not become an action', classifyIntent('explain bond duration') === 'free')

const base: CoachSituation = {
  intent: 'free', today: '2026-09-21', todayOpen: [], repairs: [], cycle: { start: '2026-09-21', end: '2026-09-27' },
  load: {}, paper: 'none', closing: false,
}
const rep = { outcomeId: 'o1', name: 'Effective annual rate', readingId: 'r010', subjectId: 'quant', readingLabel: 'Reading 10' }
const task = (n: number) => ({ id: `t${n}`, title: `Task ${n}`, revision: n, durationMinutes: 30 })

ok('free text proposes nothing', planProposals(base).proposals.length === 0)
ok('a bad day with open work proposes deferral', planProposals({ ...base, intent: 'day_was_bad', todayOpen: [task(1), task(2)] }).proposals[0]?.kind === 'defer_today')
ok('deferral carries each task revision', (() => { const c: any = planProposals({ ...base, intent: 'day_was_bad', todayOpen: [task(1), task(2)] }).proposals[0].changes; return c.tasks.length === 2 && c.tasks[1].revision === 2 })())
ok('deferral is capped at six', (() => { const c: any = planProposals({ ...base, intent: 'day_was_bad', todayOpen: [1, 2, 3, 4, 5, 6, 7, 8].map(task) }).proposals[0].changes; return c.tasks.length === 6 })())
ok('a bad day with nothing open says so', (() => { const r = planProposals({ ...base, intent: 'day_was_bad' }); return r.proposals.length === 0 && r.notes.length === 1 })())
ok('struggling with a repair proposes a re-check', planProposals({ ...base, intent: 'struggling', repairs: [rep] }).proposals[0]?.kind === 'recheck_block')
ok('the re-check goes to the lightest later day', (() => { const c: any = planProposals({ ...base, intent: 'struggling', repairs: [rep], load: { '2026-09-22': 120, '2026-09-23': 30, '2026-09-24': 90 } }).proposals[0].changes; return c.date === '2026-09-25' || c.date === '2026-09-26' || c.date === '2026-09-27' })())
ok('ties go to the earliest day', pickRecheckDate({ today: '2026-09-21', cycle: base.cycle, load: { '2026-09-22': 0 } }) === '2026-09-22')
ok('the re-check never lands on today', pickRecheckDate({ today: '2026-09-21', cycle: base.cycle, load: {} }) !== '2026-09-21')
ok('full days are skipped', pickRecheckDate({ today: '2026-09-26', cycle: base.cycle, load: { '2026-09-27': FULL_DAY_MINUTES } }) === null)
ok('no cycle means no re-check date', pickRecheckDate({ today: '2026-09-21', cycle: null, load: {} }) === null)
ok('no room is explained, not forced', (() => { const r = planProposals({ ...base, intent: 'redo', repairs: [rep], today: '2026-09-27' }); return r.proposals.length === 0 && r.notes.length === 1 })())
ok('no repair is explained, not invented', (() => { const r = planProposals({ ...base, intent: 'struggling' }); return r.proposals.length === 0 && /No outcome/.test(r.notes[0]) })())
ok('links point at the closure when the cycle is closing', planLinks({ ...base, closing: true })[0]?.href === '/app/review-week')
ok('links point at a startable paper', planLinks({ ...base, paper: 'start' })[0]?.href === '/app/tests')
ok('links open the repair reading', planLinks({ ...base, intent: 'struggling', repairs: [rep] }).some(l => l.href === '/app/curriculum/quant/r010'))
ok('links are capped at three', planLinks({ ...base, intent: 'next', closing: true, paper: 'start', repairs: [rep] }).length <= 3)
ok('a reply never claims a change was made', !/\b(i have|i\'ve) (moved|added|scheduled|changed)\b/i.test(deterministicReply({ ...base, intent: 'day_was_bad' }, 'Building', [], planProposals({ ...base, intent: 'day_was_bad', todayOpen: [task(1)] }).proposals)))
ok('a bad-day reply does not blame understanding', /not.*(count|wrong)/i.test(deterministicReply({ ...base, intent: 'day_was_bad' }, 'Building', [], [])))
ok('thin evidence is stated as thin', /not enough scored evidence/.test(deterministicReply(base, 'Insufficient evidence', [], [])))
console.log(`${p} passed, ${f} failed`)
if (f) process.exit(1)
