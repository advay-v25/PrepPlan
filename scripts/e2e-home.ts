/**
 * Home, live, on the dedicated +e2e account only.
 *
 *   npm run dev
 *   npx tsx scripts/e2e-home.ts
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)
import { getE2EEmail, verifyAndGetE2EUser, resetE2EUser, assertBlankOnboarding } from '../src/lib/testing/e2eIdentity'
import { createSession, completeOnboarding, makeCheck } from './lib/e2eSession'

const { check, finish } = makeCheck()
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

async function main() {
  console.log('\nHome\n')
  const s = createSession(admin, getE2EEmail())
  check('signed in', await s.signIn())
  const uid = await verifyAndGetE2EUser(admin)
  await resetE2EUser(admin, uid)
  await assertBlankOnboarding(admin, uid)
  await completeOnboarding(s, admin)

  const cnt = async (t: string) => (await admin.from(t).select('*', { count: 'exact', head: true }).eq('user_id', uid)).count ?? 0
  const before = { blocks: await cnt('plan_blocks'), cycles: await cnt('planning_cycles'), events: await cnt('task_events'), attempts: await cnt('assessment_attempts') }

  const html = (await (await s.req('/app')).text()).replace(/<!-- -->/g, '')
  const home = await s.req('/app')
  check('Home renders for a signed-in student', home.status === 200)
  check('greets the student by name', /Welcome back(, [^<.]+)?\./.test(html))
  check('drops the old cycle-context line', !/Mon–Sat study|Class-led cycle/.test(html))
  check('shows the exam countdown', /weeks to your exam|weeks to the [^<]* sitting/.test(html))
  check('shows a next action', /next-up__eyebrow">(Up next|Today)/.test(html))
  check('shows the four signals as separate tiles', ['Syllabus covered', 'Understanding', 'Plan followed', 'Confidence vs accuracy'].every(w => html.includes(w)) && (html.match(/class="stand__tile"/g) ?? []).length === 4)
  check('shows this week as a calendar', html.includes('week-cal__days') && (html.match(/class="week-cal__day is-/g) ?? []).length === 7, `${(html.match(/class="week-cal__day is-/g) ?? []).length} days`)
  check('shows the roadmap visually', html.includes('road__track') || html.includes('road--empty'))
  check('says coverage is exposure, not mastery', /exposure, not mastery/.test(html))
  check('Coach is one floating link, not a page section', html.includes('coach-fab') && !html.includes('home-coach'))
  check('offers learning capture in place', html.includes('Log learning'))
  check('a self-study account is not offered class logging as the default action', !html.includes('/app/calendar/log-class'))
  check('the sidebar-duplicating quick links are gone', !html.includes('home-quicklinks'))
  check('no placeholder "Signals" card', !/Preparedness:/.test(html))
  check('rendering wrote nothing', before.blocks === await cnt('plan_blocks') && before.cycles === await cnt('planning_cycles') && before.events === await cnt('task_events') && before.attempts === await cnt('assessment_attempts'))

  // Today's controls use the guarded task endpoint; prove it end to end on a real task.
  const { data: task } = await admin.from('plan_blocks').select('id, revision, execution').eq('user_id', uid).neq('execution', 'completed').limit(1).maybeSingle()
  if (task) {
    const r = await s.json(`/api/tasks/${task.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'execution', execution: 'completed', expectedRevision: task.revision, actualDurationMinutes: 25 }) })
    check('completing a task with actual minutes succeeds', r.body.ok === true, JSON.stringify(r.body).slice(0, 120))
    const stale = await s.json(`/api/tasks/${task.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'execution', execution: 'skipped', expectedRevision: task.revision }) })
    check('a stale revision is refused, not overwritten', stale.status === 409)
    const { data: ev } = await admin.from('task_events').select('actual_duration_minutes').eq('task_id', task.id).eq('actual_duration_minutes', 25).limit(1)
    check('the actual duration was recorded', (ev ?? []).length === 1)
  } else {
    console.log('  (no plan task on this account today; task-control checks skipped)')
  }

  // An unregistered candidate gets a countdown against the sitting they picked, not nothing, and it never
  // reads as a promise of an exact date they have not booked.
  await admin.from('profiles').update({ registered: false, exam_date: null }).eq('id', uid)
  const unregHtml = await (await s.req('/app')).text()
  check('an unregistered candidate sees an indicative countdown to their chosen sitting', /weeks to the \w+ \d{4} sitting/.test(unregHtml) && unregHtml.includes('Indicative') && !unregHtml.includes('weeks to your exam'), unregHtml.match(/weeks to[^<]*/)?.[0] ?? 'not found')
  await admin.from('profiles').update({ registered: true, exam_date: '2027-02-20' }).eq('id', uid)
  const regHtml = await (await s.req('/app')).text()
  check('a registered candidate sees the exact countdown, not the indicative one', regHtml.includes('weeks to your exam') && /\d+ days · 20 Feb 2027/.test(regHtml) && !/weeks to the \w+ \d{4} sitting/.test(regHtml), regHtml.match(/weeks to[^<]*/)?.[0] ?? 'not found')

  // Coach still accepts a prefilled question (other pages deep-link with ?q=).
  const coach = await (await s.req('/app/coach?q=' + encodeURIComponent('What should I focus on?'))).text()
  check('Coach opens with a prefilled question', coach.includes('What should I focus on?'))

  // A due paper never sends the student to a route that does not exist.
  const hrefs = [...html.matchAll(/href="(\/app[^"#]*)"/g)].map(m => m[1].split('?')[0])
  const bad: string[] = []
  for (const h of new Set(hrefs)) { const r = await s.req(h); if (r.status >= 400) bad.push(`${h}:${r.status}`) }
  check('every internal link on Home resolves', bad.length === 0, bad.join(', '))

  finish()
}
main().catch(e => { console.error(e); process.exit(1) })
