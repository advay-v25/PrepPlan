/**
 * Phase 2 §3/§4: one assessment decision for every Coach action, completed external-mock context, preparation context versus coverage edits,
 * the exact message set, and controlled provider failures. Real runTurn orchestration with an OWNED throwaway student and SIMULATED providers
 * (no live model is called; this proves routing, validation, links and zero writes, not language understanding).
 *   E2E_BASE_URL=http://localhost:3142 npx tsx scripts/coach-phase2-eval.ts
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)
import { makeCheck, createStudent } from './lib/e2eSession'
import { assessmentAdvice, planLinks, deterministicReply, planProposals, type CoachSituation } from '../src/lib/coach/actions'
import { interpret, normalise } from '../src/lib/coach/interpret'

const { check, finish } = makeCheck()
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const made: string[] = []

const base = (o: Partial<CoachSituation> = {}): CoachSituation => ({ intent: 'next', today: '2027-01-10', todayOpen: [], repairs: [], cycle: { start: '2027-01-04', end: '2027-01-10' }, load: {}, paper: 'none', closing: false, ...o })

async function main() {
  console.log('\n1. The weekly assessment is worded from ONE decision (Tests, Home and Calendar read the same one)\n')
  const states: [string, Partial<CoachSituation>, RegExp, boolean][] = [
    ['start', { paper: 'start' }, /can be started now/, true],
    ['upcoming', { paper: 'upcoming', paperDetail: { dueDate: '2027-01-10' } }, /available early and is due 2027-01-10/, false],
    ['resume', { paper: 'resume', paperDetail: { href: '/app/tests/abc' } }, /in progress/, false],
    ['result', { paper: 'result', paperDetail: { href: '/app/tests/abc/result' } }, /already scored/, false],
    ['confirm_scope', { paper: 'confirm_scope', paperDetail: { unresolved: 2 } }, /2 finished or partly finished blocks need you to confirm/, false],
    ['no_scope', { paper: 'no_scope' }, /no completed, eligible study/, false],
    ['insufficient', { paper: 'insufficient' }, /not enough approved, unseen questions/, false],
    ['waiting', { paper: 'waiting', paperDetail: { message: 'A repair task must be finished and spaced first.' } }, /repair task must be finished/, false],
  ]
  for (const [name, patch, note, startable] of states) {
    const s = base(patch), adv = assessmentAdvice(s), links = planLinks(s).map(l => l.label).join(' | ')
    const reply = deterministicReply({ ...s, intent: 'next' }, 'Insufficient evidence', planProposals({ ...s, intent: 'next' }).notes, [])
    check(`${name}: the note says exactly what is true`, !!adv && note.test(adv.note), adv?.note)
    check(`${name}: "Go to this week's paper" appears ONLY when a paper can start`, /Go to this week’s paper/.test(links) === startable && /the next useful step is the one that produces evidence/.test(reply) === startable, `${links} :: ${reply.slice(0, 80)}`)
  }
  check('none: nothing is offered or promised', assessmentAdvice(base({ paper: 'none' })) === null)
  check('the confirm-coverage link goes to the exact existing scope section', assessmentAdvice(base({ paper: 'confirm_scope' }))!.link!.href === '/app/tests#scope-h')
  check('a resume link opens the owned attempt, not a new paper', planLinks(base({ paper: 'resume', paperDetail: { href: '/app/tests/abc' } })).some(l => l.href === '/app/tests/abc'))

  console.log('\n2. Completed external mock stays discoverable with no upcoming appointment\n')
  const lastMock = { title: 'Provider mock', date: '2027-02-06', reportedResult: '48%', notes: 'ran out of time; changed right answers to wrong', href: '/app/calendar?week=2027-02-01&appointment=a1#checkpoint' }
  const mockS = base({ intent: 'mock', lastMock, checkpoint: null })
  const mockReply = deterministicReply(mockS, 'Insufficient evidence', planProposals(mockS).notes, []), mockLinks = planLinks(mockS)
  check('with no booking the reply names the recorded result and labels it the student\'s own report', /Provider mock/.test(mockReply) && /“48%”/.test(mockReply) && /your own report/.test(mockReply) && /not test evidence/.test(mockReply), mockReply)
  check('it does NOT say it cannot see a mock', !/cannot see a mock/.test(mockReply))
  check('it links to the exact saved report', mockLinks[0]?.href === lastMock.href, JSON.stringify(mockLinks))
  check('it makes no concept diagnosis, causal claim or pass prediction from an overall score', !/FSA|fixed income|because|pass|ready|on track|weak in/i.test(mockReply), mockReply)
  const gone = base({ intent: 'mock', lastMock: { ...lastMock, href: null } })
  check('a deleted appointment keeps the report and offers Calendar, not a dead link', planLinks(gone).every(l => l.href === '/app/calendar') && /48%/.test(deterministicReply(gone, 'x', planProposals(gone).notes, [])))
  const none = base({ intent: 'mock' })
  check('no recorded mock and no booking: honest, and says what to do', /cannot see a mock/.test(deterministicReply(none, 'x', planProposals(none).notes, [])))

  console.log('\n2b. A chosen mock report is discussed AS ITSELF (older selected, withdrawn, missing) and never replaced by the latest\n')
  const old = { id: 'rep-old', takenOn: '2027-01-02', scoreText: '55%', scope: 'full' as const, provider: 'Provider Old', selected: true, status: 'active' as const }
  const selS = base({ intent: 'mock', mockReport: old, lastMock: null })
  const selReply = deterministicReply(selS, 'x', planProposals(selS).notes, []), selLinks = planLinks(selS)
  check('an older selected report is named by its date and provider, as the student\'s own report', /2027-01-02/.test(selReply) && /Provider Old/.test(selReply) && /your own report, not test evidence/.test(selReply), selReply)
  check('it offers to guide how to work, not to teach curriculum content, and changes nothing', /do not teach the curriculum/.test(selReply) && /Nothing changes in your week until you review and confirm/.test(selReply))
  check('its link opens THAT report', selLinks[0]?.href === '/app/calendar/mock-report/rep-old' && selLinks[0]?.label === 'Open this mock report', JSON.stringify(selLinks))
  const wd = base({ intent: 'mock', mockReport: { ...old, status: 'withdrawn' } }), wdReply = deterministicReply(wd, 'x', planProposals(wd).notes, [])
  check('a withdrawn selection says it was withdrawn and plans nothing new from it', /You withdrew the mock report from 2027-01-02/.test(wdReply) && /cannot plan new work from it/.test(wdReply) && !/55%/.test(wdReply))
  const missing = base({ intent: 'mock', mockReport: null, mockReportUnavailable: true }), goneReply = deterministicReply(missing, 'x', planProposals(missing).notes, [])
  check('a missing or foreign selection is said to be unavailable and no other report is substituted', /cannot open the mock report you chose/.test(goneReply) && /not substituted another report/.test(goneReply) && planLinks(missing).every(l => l.href === '/app/calendar'))

  console.log('\n3. The message set through the real turn runtime (owned student, simulated providers)\n')
  const { runTurn } = await import('../src/lib/coach/turn')
  const st = await createStudent(admin, 'p2coach', { onboard: true }); made.push(st.id)
  const uid = st.id, db = null as any
  await admin.from('coach_messages').delete().eq('user_id', uid)
  const world = (extra: Partial<CoachSituation> = {}) => (async (_u: string, intent: any) => ({ situation: base({ intent, ...extra }), context: {}, pack: null, band: 'Insufficient evidence', todayTitles: [], unavailable: [] })) as any
  const tables = ['plan_blocks', 'block_scope_confirmations', 'evidence_events', 'assessment_attempts', 'coach_proposals', 'mock_outcomes', 'user_module_state'] as const
  const snap = async () => Object.fromEntries(await Promise.all(tables.map(async t => [t, (await admin.from(t).select('*', { count: 'exact', head: true }).eq('user_id', uid)).count ?? 0]))) as Record<string, number>
  const before = await snap()
  let k = 0; const key = () => `p2${Date.now().toString(36)}${k++}${Math.random().toString(36).slice(2, 6)}`
  const ask = (message: string, extra: Partial<CoachSituation> = {}, provider?: any, hasKey?: boolean) => runTurn({ userId: uid, db, loadWorld: world(extra), message, turnKey: key(), provider, hasKey })

  const prep = await ask('I finished the syllabus and revised it once.')
  check('"I finished the syllabus and revised it once.": planning context, not teaching, not a logging prompt', prep.status === 200 && prep.body.intent === 'next' && !prep.body.boundary && !/can’t teach|does not teach/.test(prep.body.reply), prep.body.reply?.slice(0, 140))
  check('...it is acknowledged WITHOUT being recorded, and the canonical editor is offered', /have not changed your coverage, revision status or calendar/.test(prep.body.reply) && prep.body.links.some((l: any) => /onboarding\/position/.test(l.href)), JSON.stringify(prep.body.links))
  check('...and creates no proposal', (prep.body.proposals ?? []).length === 0)
  check('interpretation: it is NOT a log-study request any more', !interpret('I finished the syllabus and revised it once.').intents.includes('log_learning'))
  check('"log my study: I finished reading 4" is still a log request (explicit verb)', interpret('please log that I finished reading 4 today').intents.includes('log_learning') || interpret('I studied reading 4 today').intents.includes('log_learning'))

  const org = await ask('First pass done, mock in a month; how should I organise revision?')
  check('"First pass done, mock in a month; how should I organise revision?": answered as planning with mock context, no teaching boundary', org.status === 200 && !org.body.boundary && org.body.intent === 'mock', `${org.body.intent} ${org.body.reply?.slice(0, 120)}`)

  const POOR = 'My February mock was 48%; FSA 35%, Fixed Income 40%. I ran out of time and changed right answers to wrong.'
  const poor = await ask(POOR, { lastMock })
  check('the exact poor-mock message: uses the SAVED report, labels it self-reported, links to it, no topic diagnosis, no writes', poor.status === 200 && poor.body.intent === 'mock' && /“48%”/.test(poor.body.reply) && /not test evidence/.test(poor.body.reply) && poor.body.links[0]?.href === lastMock.href && (poor.body.proposals ?? []).length === 0 && !/diagnos|probab|you will pass|on track/i.test(poor.body.reply), poor.body.reply?.slice(0, 200))
  const poorNoScores = await ask('My February mock did not go well. I ran out of time and changed right answers to wrong.', { lastMock })
  check('the same situation without topic scores and without a booking is handled the same way', /“48%”/.test(poorNoScores.body.reply) && poorNoScores.body.links[0]?.href === lastMock.href)
  const poorUnsaved = await ask(POOR)
  check('if nothing is saved, it does not pretend to have the numbers and does not store them', !/48/.test(poorUnsaved.body.reply) && /not saved as a result/.test(poorUnsaved.body.reply), poorUnsaved.body.reply?.slice(0, 160))

  const t1 = await ask('Teach me derivatives')
  check('"Teach me derivatives": the planning/teaching boundary, no tutoring', t1.body.boundary === 'planning_not_tutoring' && /can.t teach|does not teach|planning/i.test(t1.body.reply) && !/the formula|step 1/i.test(t1.body.reply), t1.body.reply?.slice(0, 120))
  const t2 = await ask('Teach me how to organise my derivatives revision')
  check('"Teach me how to organise my derivatives revision": method help, not refused', !t2.body.boundary && !/can.t teach|does not teach/.test(t2.body.reply ?? ''), `${t2.body.boundary} ${t2.body.reply?.slice(0, 120)}`)
  const mixed = await ask('I want a revision plan and also explain how duration is calculated')
  check('a mixed message: the planning part is answered and the teaching boundary is stated briefly', mixed.body.intent === 'next' && /can.t teach the chapter/.test(mixed.body.reply) && mixed.body.boundary === 'planning_not_tutoring', mixed.body.reply?.slice(0, 160))
  const neg = await ask("I haven't finished revision")
  check('"I haven\'t finished revision": context, no missed-day recovery, no proposal, nothing recorded', neg.body.intent === 'next' && (neg.body.proposals ?? []).length === 0 && /have not changed your coverage/.test(neg.body.reply))
  const hypo = interpret('What if I miss a whole week?')
  check('a hypothetical missed week is not a missed day', !hypo.intents.includes('day_was_bad'))
  const corr = interpret('not this task, the second one')
  check('"not this task, the second one" does not itself move anything', !corr.intents.includes('move_block'))
  const typo = normalise('pls move task-tdy-42 to 2027-02-03 tmrw 7pm')
  check('typos are fixed but identifiers, dates and numbers are untouched', typo.includes('task-tdy-42') && typo.includes('2027-02-03') && typo.includes('7pm') && /please/.test(typo) && /tomorrow/.test(typo), typo)
  check('natural paraphrase: "done with my first pass, revision is finished" is preparation context', interpret('done with my first pass, revision is finished').preparation === true)

  console.log('\n4. Controlled provider failures: same facts, same permitted actions, nothing written\n')
  const FREE = 'could you possibly sort out my afternoon somehow'
  const fails: [string, any, boolean?][] = [
    ['disabled', undefined, false], ['unreachable', async () => { throw new Error('ECONNREFUSED') }], ['malformed', async () => '{"reply":'], ['empty', async () => ''],
    ['slow', () => new Promise<string>(r => setTimeout(() => r('{"reply":"late"}'), 12_000))],
  ]
  const outs: any[] = []
  for (const [name, prov, hasKey] of fails) {
    const t0 = Date.now(), r = await ask(FREE, { lastMock, paper: 'insufficient' }, prov, hasKey === undefined ? true : hasKey)
    outs.push(r)
    check(`${name}: a working deterministic fallback, no claimed change, bounded (${Date.now() - t0} ms)`, r.status === 200 && r.body.fallback === true && (r.body.proposals ?? []).length === 0 && Date.now() - t0 < 40_000, `${r.status} ${r.body.fallbackReason}`)
  }
  check('every failure path leaves the same links and permitted actions', new Set(outs.map(o => JSON.stringify(o.body.links) + (o.body.proposals ?? []).length)).size === 1)

  console.log('\n5. Zero unintended writes\n')
  const after = await snap()
  check('no task, scope confirmation, evidence, attempt, proposal, mock outcome or coverage row was created by any read-only question', JSON.stringify(before) === JSON.stringify(after), JSON.stringify({ before, after }))
}

main().catch(e => { console.error(e); process.exitCode = 1 }).finally(async () => {
  for (const id of made) await admin.auth.admin.deleteUser(id).catch(() => {})
  console.log(`cleaned ${made.length} owned student(s)`)
  finish()
})
