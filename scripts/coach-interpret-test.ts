/** Interpretation, scope and hint-trust checks. Pure: no database, no provider. npm run coach:interpret:test */
import { interpret, normalise } from '../src/lib/coach/interpret'
import { resolveIntent } from '../src/lib/coach/turn'
import { planProposals, planLinks, type CoachSituation } from '../src/lib/coach/actions'
import { toInterpretation, validateInterpretation } from '../src/lib/coach/interpretModel'
import { resolveDay, pickSlot, insideWindows, parseDateWords } from '../src/lib/coach/move'
import { mergePending, isAffirmation } from '../src/lib/coach/context'
import { CAPABILITIES, HINTABLE, QUICK_ACTIONS } from '../src/lib/coach/capabilities'

let pass = 0, fail = 0
const ok = (name: string, cond: boolean, detail = '') => { cond ? pass++ : (fail++, console.log(`  ✗ ${name} ${detail}`)) }
const is = (msg: string, intent: string, teaching = false) => { const r = interpret(msg); ok(`"${msg}" → ${intent}${teaching ? ' + teaching' : ''}`, r.primary === intent && r.teaching === teaching, `got ${r.primary}/${r.teaching}`) }

// The five findings from the review
is('i msised tday can u repln my calender', 'day_was_bad')
is('when is my exam?', 'exam')
is('when is the exam?', 'exam')
is('teach me how to organise my revision', 'free')
is("I don't want you to teach me FSA; I need a revision plan", 'next')
is("I haven't missed today; what should I do next?", 'next')
ok('negated miss is recorded as negated, so no deferral', interpret("I haven't missed today; what should I do next?").negated.includes('day_was_bad'))
is('I missed today; teach me this chapter', 'day_was_bad', true)

// Boundary pairs
is('teach me how to use Calendar', 'free')
is('teach me derivatives', 'teach', true)
is('explain why my week is lighter', 'lighter')
is('explain the WACC formula', 'teach', true)
is('How should I study FSA?', 'free')
is('teach me this chapter', 'teach', true)
is('solve this question for me', 'teach', true)
is('explain what this paper score means', 'result')
is('how to calculate the duration of a bond', 'teach', true)   // a curriculum calculation is out of scope even without the verb "teach"
ok('"teach me how to calculate WACC" is teaching', interpret('teach me how to calculate WACC').teaching)

// Negation, hypotheticals, corrections
is("no, I didn't miss it", 'today')
ok('a correction is flagged', interpret("no, I didn't miss it").correction)
ok('hypothetical miss is not a report', !interpret('what if I miss tomorrow').intents.includes('day_was_bad'))
is('i missed today', 'day_was_bad')
is('I could not study today', 'day_was_bad')
is('i didnt miss today whats next', 'next')

// Multi-intent
{ const r = interpret('my mock went badly and I work Saturday now'); ok('mock + availability both read', r.intents.includes('mock') && r.intents.includes('availability'), JSON.stringify(r.intents)) }
{ const r = interpret('I missed today and I have a mock soon'); ok('missed + mock', r.primary === 'day_was_bad' && r.intents.includes('mock')) }

// Moves and corrections of the day. The day is text only: the planner places work.
is('move it tomorrow', 'move_block')
ok('"not tomorrow, Friday" → Friday', interpret('move it, not tomorrow, Friday').when === 'friday')
ok('plain tomorrow → tomorrow', interpret('push this block to tomorrow').when === 'tomorrow')

// Handoff capabilities
is('I need to log a class I attended today', 'log_class')
// Phase 7B: the real typo/phrasing examples are read by the deterministic interpreter (no provider), and clear non-requests are not mistaken for them
is('i attnded clas yesterday, can u log it', 'log_class')
is('I atended class yday please log it', 'log_class')
is('attended the lecture today, record it', 'log_class')
is('had class yesterday can you add it', 'log_class')
is('i went to clas', 'free')
ok('"clas" alone is not an action request', interpret('what is a clas of assets?').primary !== 'log_class')
ok('a negated class report does not drive an action', interpret("I didn't attend class yesterday").negated.includes('log_class') || interpret("I didn't attend class yesterday").primary !== 'log_class')
is('log my self study', 'log_learning')
is('I booked my exam date', 'exam')

// Hinglish (modest, high precision) and unknowns that must not become actions
is('aaj nahi padh paya', 'day_was_bad')
is('kal kya padhna hai', 'next')
is('hello there', 'free')
is('qwerty asdf', 'free')

// Normalisation never touches numbers, ids or dates
ok('digits and ids are untouched', normalise('Move task t-2026-11-12 to 2day 09:30') === 'move task t-2026-11-12 to today 09:30'.replace('to today', 'to today'), normalise('Move task t-2026-11-12 to 2day 09:30'))
ok('a bare number named like a fix is not rewritten', normalise('block 2 on 12 nov') === 'block 2 on 12 nov')
ok('curly apostrophes normalise', normalise('I didn’t') === "i didn't")

// The client intent is an untrusted hint
ok('forged today hint on teaching text is ignored', resolveIntent('teach me derivatives', 'today').intent === 'teach')
ok('forged day_was_bad hint with no miss is ignored', resolveIntent('what should I study next', 'day_was_bad').intent === 'next')
ok('forged hint on a mixed request keeps the teaching flag', resolveIntent('explain the WACC formula', 'next').teaching)
ok('a hint breaks a tie only between real matches', resolveIntent('I missed today and have a mock', 'mock').intent === 'mock')
ok('an unknown hint is ignored', resolveIntent('what should I do today?', 'delete_everything').intent === 'today')
ok('negated miss cannot be forced by a hint', resolveIntent("I haven't missed today", 'day_was_bad').intent !== 'day_was_bad')

// Every advertised quick action resolves to its own intent and has a working capability
for (const q of QUICK_ACTIONS) ok(`quick "${q.label}" classifies as ${q.intent}`, interpret(q.text).primary === q.intent, interpret(q.text).primary)
ok('teaching is not advertised', !QUICK_ACTIONS.some(q => q.intent === 'teach') && !HINTABLE.includes('teach' as any))
ok('every capability has a service', CAPABILITIES.every(c => c.service.length > 3))
ok('only execute capabilities may produce a proposal', (() => {
  const base: CoachSituation = { intent: 'free', today: '2026-11-12', todayOpen: [{ id: 'a', title: 'A', revision: 1, durationMinutes: 30, execution: 'not_started', date: '2026-11-12' }], repairs: [], cycle: null, load: {}, paper: 'none', closing: false,
    selectedTask: { id: 'a', title: 'A', revision: 1, date: '2026-11-12', minutes: 30, movable: true } }
  return CAPABILITIES.every(c => planProposals({ ...base, intent: c.intent }).proposals.length === 0 || c.mode === 'execute')
})())

// Move proposals: a real placement, never a deferral dressed as a move
{
  const base: CoachSituation = { intent: 'move_block', today: '2026-11-12', todayOpen: [], repairs: [], cycle: null, load: {}, paper: 'none', closing: false }
  const t = { id: 'a', title: 'Reading 12', revision: 3, date: '2026-11-12', minutes: 40, movable: true }
  const pl = { state: 'ok' as const, date: '2026-11-13', dateLabel: 'Friday 13 Nov', startsAt: '2026-11-13T12:30:00.000Z', startMinutes: 18 * 60, timeLabel: '18:00' }
  const p = planProposals({ ...base, selectedTask: t, when: 'friday', placement: pl })
  ok('a selected task and a resolved day → one move_task preview with the exact slot', p.proposals.length === 1 && p.proposals[0].kind === 'move_task' && (p.proposals[0].changes as any).move.toDate === '2026-11-13' && (p.proposals[0].changes as any).move.revision === 3)
  ok('the preview states the real placement and never calls it a deferral', /Friday 13 Nov at 18:00–18:40/.test(p.proposals[0].reasoning) && !/deferred/i.test(p.proposals[0].reasoning))
  ok('day-only fallback is labelled as having no set time', (() => { const d = planProposals({ ...base, selectedTask: t, placement: { ...pl, startsAt: null, startMinutes: null, timeLabel: null } }); return /no set time/.test(d.proposals[0].reasoning) })())
  ok('an unresolved day asks one question and proposes nothing', (() => { const a = planProposals({ ...base, selectedTask: t, placement: { state: 'ask', ask: 'Which day?' } }); return a.proposals.length === 0 && a.notes[0] === 'Which day?' })())
  ok('a started task proposes nothing and stays due', planProposals({ ...base, selectedTask: { ...t, movable: false }, placement: pl }).proposals.length === 0)
  ok('no selected task → clarification with choices, no proposal', (() => { const c = { ...base, taskChoices: [{ id: 'a', title: 'A', date: '2026-11-12' }, { id: 'b', title: 'B', date: '2026-11-12' }] }; return planProposals(c).proposals.length === 0 && planLinks(c).length === 2 && planLinks(c)[0].href.includes('task=a') })())
  ok('exam-sat pauses a move', planProposals({ ...base, selectedTask: t, placement: pl, examSat: '2026-11-01' }).proposals.length === 0)
}

// Day resolution is explicit and conservative
{
  const r = (w: string | null, from = '2026-11-12') => resolveDay(w, '2026-11-12', from, { start: '2026-11-09', end: '2026-11-15' })   // 12 Nov 2026 is a Thursday
  ok('friday → 13 Nov', (r('friday') as any).date === '2026-11-13')
  ok('tomorrow → 13 Nov', (r('tomorrow') as any).date === '2026-11-13')
  ok('the same weekday as today asks', !r('thursday').ok && (r('thursday') as any).reason === 'ambiguous')
  ok('"next sunday" asks rather than guessing', (r('next sunday') as any).reason === 'ambiguous')
  ok('"kal" asks', (r('kal') as any).reason === 'ambiguous')
  ok('a day outside the cycle points to the weekly review', (r('next week') as any).reason === 'ambiguous' && (resolveDay('monday', '2026-11-12', '2026-11-12', { start: '2026-11-09', end: '2026-11-15' }) as any).reason === 'outside_cycle')
  ok('no day asks', (r(null) as any).reason === 'none')
  ok('moving to the day it is already on says so', (r('friday', '2026-11-13') as any).reason === 'same_day')
}

// Pending context: short follow-ups, corrections, topic changes
{
  const pend = { intent: 'move_block' as const, taskId: 'a', taskChoices: ['a', 'b', 'c'], when: 'tomorrow', asked: 'Which task?' }
  const m = (msg: string, sel: string | null = null) => mergePending(interpret(msg), pend, msg, sel)
  ok('"the second one" picks the second stored choice by id', m('the second one').taskId === 'b' && m('the second one').intent === 'move_block')
  ok('"No, not tomorrow, Friday" amends the pending move', (() => { const x = m('No, not tomorrow, Friday'); return x.when === 'friday' && x.amends && x.intent === 'move_block' })())
  ok('a day alone continues the pending move', m('Friday').intent === 'move_block' && m('Friday').when === 'friday')
  ok('a topic change drops the old context', mergePending(interpret('I missed today'), pend, 'I missed today', null).intent === 'day_was_bad')
  ok('no pending context changes nothing', mergePending(interpret('Friday'), null, 'Friday', null).intent === 'free')
  ok('affirmations are recognised and nothing else is', isAffirmation('yes') && isAffirmation('Go ahead.') && !isAffirmation('yes but move it to friday'))
}

// The model interpreter's validator: strict schema, spans from the ORIGINAL message, nothing URL/SQL/id-shaped, no confidence, no unknown fields
{
  const msg = 'Move it to Friday because I am busy today'
  const good = { version: 'coach-interp-schema.2', requests: [{ capability: 'move_block', negated: false, span: 'Move it', when: { span: 'Friday', role: 'target' } }], excluded: [], correction: false, unresolved: [], clarification: null }
  const bad = (name: string, v: any, m = msg) => ok(`validator rejects: ${name}`, !validateInterpretation(v, m).ok)
  ok('a well-formed interpretation is accepted', validateInterpretation(good, msg).ok)
  bad('unknown field', { ...good, confidence: 0.99 })
  bad('unknown request field', { ...good, requests: [{ ...good.requests[0], userId: 'x' }] })
  bad('capability outside the registry', { ...good, requests: [{ ...good.requests[0], capability: 'delete_plan' }] })
  bad('teach as a capability (it is an exclusion)', { ...good, requests: [{ ...good.requests[0], capability: 'teach' }] })
  bad('a span that is not in the message', { ...good, requests: [{ ...good.requests[0], span: 'Move my whole week' }] })
  bad('a url in the clarification', { ...good, unresolved: ['day'], clarification: 'Open https://evil.example/x' })
  bad('sql-shaped text', { ...good, unresolved: ['task'], clarification: 'drop table plan_blocks; select * from users' })
  bad('an invented uuid', { ...good, unresolved: ['task'], clarification: 'Do you mean 7f3a2b1c-1111-4d5e-9999-abcdefabcdef?' })
  bad('too many requests', { ...good, requests: Array(4).fill(good.requests[0]) })
  bad('wrong schema version', { ...good, version: 'old' })
  const t = toInterpretation(good as any, msg, interpret(msg))
  ok('the day comes from OUR grammar on the validated target span, not from the model', t?.interpretation.when === 'friday')
  const reason = toInterpretation({ ...good, requests: [{ capability: 'move_block', negated: false, span: 'Move it', when: { span: 'today', role: 'reason' } }] } as any, msg, { ...interpret(msg), when: null })
  ok('a date the model labels a reason is never the target', reason?.interpretation.when === null)
  const method = { ...good, requests: [{ capability: 'next', negated: false, span: 'organise my revision' }], excluded: [{ kind: 'teaching', span: 'teach me how to organise my revision' }] }
  ok('a model-flagged "teaching" on study-method help is ignored (our grammar disagrees)', toInterpretation(method as any, 'teach me how to organise my revision', interpret('teach me how to organise my revision'))?.interpretation.teaching === false)
  const calc = { ...good, requests: [{ capability: 'day_was_bad', negated: false, span: 'I missed today' }], excluded: [{ kind: 'teaching', span: 'explain the WACC formula' }] }
  ok('a model-flagged teaching request our grammar confirms is kept', toInterpretation(calc as any, 'I missed today; explain the WACC formula', { ...interpret('I missed today; explain the WACC formula'), teaching: false })?.interpretation.teaching === true)
  const neg = toInterpretation({ ...good, requests: [{ capability: 'day_was_bad', negated: true, span: 'busy today' }, { capability: 'next', negated: false, span: 'Move it' }] } as any, msg, interpret(msg))
  ok('a negated request is removed from the actions, and recorded as negated', !neg!.interpretation.intents.includes('day_was_bad') && neg!.interpretation.negated.includes('day_was_bad'))
  ok('the model cannot change a clear deterministic request (it only runs when the reading is unresolved)', interpret('I missed today and could not study.').primary === 'day_was_bad')
}

// Exact dates and times, and a slot picker that knows the student's own hours (13 Nov 2026 closeout)
{
  const today = '2026-11-13', cyc = { start: '2026-11-09', end: '2026-11-22' }
  const d = (w: string | null, from = '2026-11-13') => resolveDay(w, today, from, cyc)
  ok('an ISO date resolves (the dead end the review reproduced)', (() => { const r = d('2026-11-14'); return r.ok && r.date === '2026-11-14' && r.minutes === null })())
  ok('"14 nov" and "nov 14th" resolve to the same date', (() => { const a = d('14 nov'), b = d('nov 14th'); return a.ok && b.ok && a.date === '2026-11-14' && b.date === '2026-11-14' })())
  ok('an impossible date is not guessed', !d('31 feb').ok && parseDateWords('31 feb', today) === null)
  ok('an unfinished task is not placed in the past', (() => { const r = d('2026-11-12'); return !r.ok && r.reason === 'past' })())
  ok('a date outside the cycle explains the weekly review', (() => { const r = d('2026-12-01'); return !r.ok && r.reason === 'outside_cycle' && /weekly review/.test(r.ask) })())
  ok('a time with no day means the same day: a complete same-day time edit', (() => { const r = d('@19:00'); return r.ok && r.date === '2026-11-13' && r.minutes === 19 * 60 })())
  ok('a day and a time travel together', (() => { const r = d('friday@07:30'); return r.ok && r.date === '2026-11-13' ? false : r.ok && r.minutes === 450 })() || (() => { const r = d('saturday@07:30'); return r.ok && r.date === '2026-11-14' && r.minutes === 450 })())
  ok('the same day with no time still asks (and now offers a time)', (() => { const r = d('2026-11-13'); return !r.ok && r.reason === 'same_day' && /at 7pm/.test(r.ask) })())
  const w = (msg: string) => interpret(msg).when
  ok('"move it to 14 nov" reads the date', w('move it to 14 nov') === '14 nov')
  ok('"move it to saturday at 7pm"', w('move it to saturday at 7pm') === 'saturday@19:00')
  ok('"move it to 2026-11-14 at 19:30"', w('move it to 2026-11-14 at 19:30') === '2026-11-14@19:30')
  ok('"reschedule it to 7:30am" is a same-day time', w('reschedule it to 7:30am') === '@07:30')
  ok('"move it to 9 tasks" is not a time', interpret('move it to tomorrow, I have 9 tasks').when === 'tomorrow')
  ok('a time inside the reason is not the target', interpret('move it to friday because I work at 5pm').when === 'friday')
  // personalised windows
  const early = [{ start: 6 * 60, end: 7 * 60 }]
  ok('a student free only 06:00–07:00 is never offered 08:00', pickSlot([], '2026-11-14', 30, 18 * 60, 'x', early) === 6 * 60 + 30)
  ok('no saved windows → no slot (day-only, never an invented study period)', pickSlot([], '2026-11-14', 30, null, 'x', []) === null)
  ok('a window shorter than the task offers no slot', pickSlot([], '2026-11-14', 90, null, 'x', early) === null)
  ok('a busy gap inside the window is skipped', (() => { const occ = [{ id: 'o', title: 'Call', date: '2026-11-14', start: 6 * 60, durationMinutes: 30, isProtected: true, kind: 'commitment' as const }]; return pickSlot(occ, '2026-11-14', 30, 6 * 60, 'x', early) === 6 * 60 + 30 })())
  ok('insideWindows is boundary-exact', insideWindows(early, 6 * 60 + 30, 30) && !insideWindows(early, 6 * 60 + 45, 30))
}

// Semantic exclusions survive the boundary (13 Nov closeout): exclusion-only is valid, unfamiliar wording is kept, method help is never refused
{
  const sch = 'coach-interp-schema.2'
  const mk = (o: object) => ({ version: sch, requests: [], excluded: [], correction: false, unresolved: [], clarification: null, ...o })
  const run = (msg: string, o: object) => { const v = validateInterpretation(mk(o), msg); return v.ok ? toInterpretation(v.value, msg, interpret(msg)) : null }
  const m1 = 'tell me how duration and convexity interact with each other'
  const r1 = run(m1, { excluded: [{ kind: 'teaching', span: 'how duration and convexity interact' }] })
  ok('an exclusion-only description is valid (the schema no longer demands a request)', r1 !== null && r1.interpretation.primary === 'free' && r1.interpretation.exclusions?.length === 1)
  ok('the unfamiliar teaching phrase is retained as a note, not flagged as teaching by a model guess', r1!.interpretation.teaching === false && r1!.interpretation.exclusions![0].kind === 'teaching')
  const m2 = 'plan my revision for tomorrow and break down how convexity works to me'
  const r2 = run(m2, { requests: [{ capability: 'next', negated: false, span: 'plan my revision' }], excluded: [{ kind: 'teaching', span: 'break down how convexity works to me' }] })
  ok('a mixed request keeps its planning intent AND the unfamiliar exclusion', r2!.interpretation.primary === 'next' && r2!.interpretation.exclusions?.length === 1)
  const m3 = 'walk me through how to organise my revision'
  const r3 = run(m3, { excluded: [{ kind: 'teaching', span: 'walk me through how to organise my revision' }] })
  ok('method help flagged as teaching by a model is dropped, not refused', r3 === null || (r3.interpretation.exclusions ?? []).length === 0 && !r3.interpretation.teaching)
  const m4 = 'explain the WACC formula'
  const r4 = run(m4, { excluded: [{ kind: 'teaching', span: 'explain the WACC formula' }] })
  ok('grammar-confirmed teaching is still teaching', r4!.interpretation.teaching === true && r4!.interpretation.primary === 'teach')
  ok('a span that is not in the message is still rejected', !validateInterpretation(mk({ excluded: [{ kind: 'teaching', span: 'invented words' }] }), m1).ok)
  ok('an empty description with nothing unresolved gives the server nothing to act on', run('hmm okay then', {}) === null)
  ok('"explain" on the student\'s own state is not an exclusion', interpret('explain why my week is lighter').teaching === false)
}

// "What next?" agrees with Home's canonical next action
{
  const base: CoachSituation = { intent: 'next', today: '2026-11-13', todayOpen: [{ id: 'a', title: 'Reading 3', revision: 1, durationMinutes: 30, execution: 'not_started', date: '2026-11-13' }], repairs: [], cycle: null, load: {}, paper: 'none', closing: false,
    nextTask: { id: 'a', title: 'Reading 3', date: '2026-11-13', minutes: 30, type: 'study' }, homeNext: { code: 'complete_logs', title: 'Finish your study logs', rationale: 'Two earlier blocks have no outcome yet.', destination: '/app/calendar?logs=1' } }
  const n = planProposals(base).notes.join(' ')
  ok('Coach names the same first step Home shows, and says so', /same one Home shows, is “Finish your study logs”/.test(n))
  ok('its first link is Home\'s destination, not a different task', planLinks(base)[0]?.href === '/app/calendar?logs=1')
  ok('for "today" Home\'s step comes before the first open task', planLinks({ ...base, intent: 'today' })[0]?.href === '/app/calendar?logs=1' && planLinks({ ...base, intent: 'today' }).length >= 2)
  ok('without a Home decision the old behaviour is unchanged', planProposals({ ...base, homeNext: null, intent: 'today' }).notes.join(' ').includes('Your next accepted task'))
}

console.log(`${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
