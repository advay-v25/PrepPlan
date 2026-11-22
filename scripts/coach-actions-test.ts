import { classifyIntent, planProposals, planLinks, deterministicReply, type CoachSituation } from '../src/lib/coach/actions'
let p = 0, f = 0
const ok = (n: string, c: boolean) => { c ? p++ : (f++, console.log('  ✗', n)) }

ok('bad day is recognised', classifyIntent('I had a terrible day and could not study') === 'day_was_bad' || classifyIntent('today was a bad day') === 'day_was_bad')
ok('struggling is recognised', classifyIntent('Why do I keep getting duration wrong?') === 'struggling')
ok('redo is recognised', classifyIntent('can I try again on that?') === 'redo')
ok('next is recognised', classifyIntent('What should I focus on?') === 'next')
ok('ordinary text is free', classifyIntent('hello there') === 'free')
ok('explaining content is a teaching request, never an action', classifyIntent('explain bond duration') === 'teach')

const base: CoachSituation = {
  intent: 'free', today: '2026-09-21', todayOpen: [], repairs: [], cycle: { start: '2026-09-21', end: '2026-09-27' },
  load: {}, paper: 'none', closing: false,
}
const rep = { outcomeId: 'o1', name: 'Effective annual rate', readingId: 'r010', subjectId: 'quant', readingLabel: 'Reading 10' }
const task = (n: number, execution = 'not_started') => ({ id: `t${n}`, title: `Task ${n}`, revision: n, durationMinutes: 30, execution, date: '2026-09-21' })

ok('free text proposes nothing', planProposals(base).proposals.length === 0)
ok('a bad day with open work proposes deferral', planProposals({ ...base, intent: 'day_was_bad', todayOpen: [task(1), task(2)] }).proposals[0]?.kind === 'defer_today')
ok('deferral carries each reviewed task with its revision and date', (() => { const c: any = planProposals({ ...base, intent: 'day_was_bad', todayOpen: [task(1), task(2)] }).proposals[0].changes; return c.version === 2 && c.moves.length === 2 && c.moves[1].revision === 2 && c.moves[1].date === '2026-09-21' && c.moves[0].minutes === 30 })())
ok('deferral is capped at six and says how many wait', (() => { const c: any = planProposals({ ...base, intent: 'day_was_bad', todayOpen: [1, 2, 3, 4, 5, 6, 7, 8].map(n => task(n)) }).proposals[0].changes; return c.moves.length === 6 && c.waiting === 2 })())
ok('started work is never moved: it stays due and is named', (() => { const r = planProposals({ ...base, intent: 'day_was_bad', todayOpen: [task(1), task(2, 'partial')] }); const c: any = r.proposals[0].changes; return c.moves.length === 1 && c.staysDue.length === 1 && /stays due/.test(r.proposals[0].reasoning) })())
ok('only started work: nothing is proposed, and it says why', (() => { const r = planProposals({ ...base, intent: 'day_was_bad', todayOpen: [task(1, 'in_progress')] }); return r.proposals.length === 0 && /already been started/.test(r.notes[0]) })())
ok('a bad day with nothing open says so', (() => { const r = planProposals({ ...base, intent: 'day_was_bad' }); return r.proposals.length === 0 && r.notes.length === 1 })())
const followUp = { label: 'Review repair follow-up', href: '/app/tests/result-owner/result#proposal-h' }
ok('repair requests use the existing follow-up instead of creating a task proposal', (() => { const r = planProposals({ ...base, intent: 'struggling', repairs: [rep], repairFollowUp: followUp }); return r.proposals.length === 0 && /confirm there/.test(r.notes[0]) })())
ok('retry requests keep exact result provenance in the link', planLinks({ ...base, intent: 'redo', repairFollowUp: followUp })[0]?.href === followUp.href)
ok('no current repair does not invent one', (() => { const r = planProposals({ ...base, intent: 'struggling' }); return r.proposals.length === 0 && /cannot point/.test(r.notes[0]) })())
ok('a full or elapsed week still allows reviewing existing repair history', planLinks({ ...base, intent: 'redo', cycle: null, repairFollowUp: followUp }).some(l => l.href === followUp.href))
ok('links point at the closure when the cycle is closing', planLinks({ ...base, closing: true })[0]?.href === '/app/review-week')
ok('links point at a startable paper', planLinks({ ...base, paper: 'start' })[0]?.href === '/app/tests')
ok('links open the repair reading', planLinks({ ...base, intent: 'struggling', repairs: [rep] }).some(l => l.href === '/app/curriculum/quant/r010'))
ok('links are capped at three', planLinks({ ...base, intent: 'next', closing: true, paper: 'start', repairs: [rep] }).length <= 3)
ok('a reply never claims a change was made', !/\b(i have|i\'ve) (moved|added|scheduled|changed)\b/i.test(deterministicReply({ ...base, intent: 'day_was_bad' }, 'Building', [], planProposals({ ...base, intent: 'day_was_bad', todayOpen: [task(1)] }).proposals)))
ok('a bad-day reply does not blame understanding', /not.*(count|wrong)/i.test(deterministicReply({ ...base, intent: 'day_was_bad' }, 'Building', [], [])))
ok('thin evidence is stated as thin', /not enough scored evidence/.test(deterministicReply(base, 'Insufficient evidence', [], [])))
// --- Phase 4 intents: each resolves to verified state, never to a model's choice
const I = (m: string) => classifyIntent(m)
ok('"what should I do today?" -> today', I('What should I do today?') === 'today')
ok('"I missed today" -> missed work (preview)', I('I missed today and could not study.') === 'day_was_bad')
ok('"my availability changed" -> availability', I('My availability changed.') === 'availability')
ok('"why did my week get lighter?" -> lighter', I('Why did my week get lighter?') === 'lighter')
ok('"what should I do about this result?" -> result', I('What should I do about this result?') === 'result')
ok('"right but slow" -> slow', I('I get these questions right, but I am slow.') === 'slow')
ok('"I have a mock coming up" -> mock', I('I have a mock coming up.') === 'mock')
ok('"teach me this chapter" -> teach', I('Teach me this chapter.') === 'teach')
const taskNow = { id: 'tk1', title: 'Income statements', date: '2026-09-21', minutes: 45, type: 'study' }
ok('today links to the exact Calendar task', planLinks({ ...base, intent: 'today', nextTask: taskNow })[0]?.href === '/app/calendar?view=agenda&week=2026-09-21&task=tk1')
ok('today with nothing accepted says so and offers the week', (() => { const r = planProposals({ ...base, intent: 'today' }); return /Nothing accepted/.test(r.notes[0]) && planLinks({ ...base, intent: 'today' })[0]?.href === '/app/calendar' })())
ok('availability opens the editor with a return path', planLinks({ ...base, intent: 'availability' })[0]?.href === '/onboarding/week?returnTo=%2Fapp%2Fcoach')
ok('lighter explains the recorded adaptation, not a judgement', (() => { const r = planProposals({ ...base, intent: 'lighter', adaptation: { headline: 'A lighter week after a heavy one.', lighter: true, optionalMinutes: 0, waiting: 2 } }); return /lighter week after a heavy one/.test(r.notes[0]) && /not a judgement/.test(r.notes[0]) && /2 readings wait/.test(r.notes[0]) })())
ok('lighter without a recorded review does not invent a reason', /cannot find a recorded weekly review/.test(planProposals({ ...base, intent: 'lighter' }).notes[0]))
const res = { attemptId: 'a1', href: '/app/tests/a1/result', headline: 'Plan repair work for 2 areas.', findings: [{ kind: 'misconception', title: 'x' }], timing: { available: true, message: null, deliverable: 10, minutes: 13 } }
ok('result links to the exact result and its follow-up', (() => { const l = planLinks({ ...base, intent: 'result', latestResult: res, repairFollowUp: followUp }); return l[0].href === '/app/tests/a1/result' && l[1].href === followUp.href })())
ok('no result yet is stated, not invented', /no scored result yet/.test(planProposals({ ...base, intent: 'result' }).notes[0]))
ok('a selected result that cannot be opened says so, links no result and offers only Tests (nothing is substituted)', (() => { const sit = { ...base, intent: 'result' as const, selectedResultUnavailable: true, latestResult: null, repairFollowUp: null }; const n = planProposals(sit).notes[0], l = planLinks(sit); return /could not open the result you selected/.test(n) && /not substituted another/.test(n) && !/no scored result yet/.test(n) && l.length === 1 && l[0].href === '/app/tests' })())
ok('a selected result that opened is "this result", not "your latest"', (() => { const sit = { ...base, intent: 'result' as const, selectedResultOpen: true, latestResult: res, repairFollowUp: null }; return /The result you opened says/.test(planProposals(sit).notes[0]) && planLinks(sit)[0].label === 'Open this result' })())
ok('slow offers timed practice only when the decision permits it', /Timed practice is available: 10 fresh questions/.test(planProposals({ ...base, intent: 'slow', latestResult: res }).notes[0]) && /needs at least 5 fresh/.test(planProposals({ ...base, intent: 'slow', latestResult: { ...res, timing: { available: false, message: 'Timed practice needs at least 5 fresh human-reviewed questions on this reading; the bank can serve 0 right now.', deliverable: 0, minutes: 0 } } }).notes[0]))
ok('slow says speed is not a gap in understanding and keeps practice out of evidence', (() => { const r = deterministicReply({ ...base, intent: 'slow', latestResult: res }, 'Building', planProposals({ ...base, intent: 'slow', latestResult: res }).notes, []); return /not a gap in understanding/.test(r) && /does not change your understanding signal/.test(r) })())
ok('mock explains the checkpoint and keeps a mock report as self-report', (() => { const r = planProposals({ ...base, intent: 'mock', checkpoint: { title: 'mock', date: '2026-10-01', href: '/app/calendar?x', choiceUnresolved: true } }); return /2026-10-01/.test(r.notes[0]) && /your own report/.test(r.notes[0]) && planLinks({ ...base, intent: 'mock', checkpoint: { title: 'mock', date: '2026-10-01', href: '/app/calendar?x', choiceUnresolved: false } })[0].href === '/app/calendar?x' })())
ok('teach redirects to scope and a practical method with the student\'s own resources, and teaches nothing', (() => { const r = deterministicReply({ ...base, intent: 'teach', nextTask: taskNow }, 'Building', [], []); return /does not teach chapters/.test(r) && /own materials/.test(r) && /Income statements/.test(r) && planLinks({ ...base, intent: 'teach' })[0].href === '/app/curriculum' })())
console.log(`${p} passed, ${f} failed`)
if (f) process.exit(1)
