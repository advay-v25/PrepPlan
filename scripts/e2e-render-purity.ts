/**
 * Render purity: a GET of any primary page must not change a single row.
 *
 * The account is put in the exact state that used to make Calendar generate a
 * week on render (onboarded, active roadmap, no planned work this week), then
 * every primary page is fetched twice and row counts are compared.
 *
 *   npm run dev
 *   npx tsx scripts/e2e-render-purity.ts
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)
import { getE2EEmail, verifyAndGetE2EUser, resetE2EUser, assertBlankOnboarding } from '../src/lib/testing/e2eIdentity'
import { createSession, completeOnboarding, makeCheck } from './lib/e2eSession'

const { check, finish } = makeCheck()
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

const TABLES = [
  'plan_blocks', 'planning_cycles', 'plan_drafts', 'study_roadmaps', 'roadmap_milestones',
  'assessment_attempts', 'assessment_blueprints', 'assessment_forms', 'form_items', 'assessment_responses',
  'evidence_events', 'repair_threads', 'coach_proposals', 'task_events', 'learning_activities',
  'calendar_commitments', 'availability_windows', 'user_topic_exposure', 'user_module_state',
]
// Tables without a user_id column are scoped through the user's own rows, so only user-owned tables are counted.
const USER_TABLES = TABLES.filter(t => !['assessment_blueprints', 'assessment_forms', 'form_items', 'roadmap_milestones'].includes(t))

async function snapshot(uid: string) {
  const counts: Record<string, number> = {}
  for (const t of USER_TABLES) {
    const { count, error } = await admin.from(t).select('*', { count: 'exact', head: true }).eq('user_id', uid)
    if (error) throw new Error(`count ${t}: ${error.message}`)
    counts[t] = count ?? 0
  }
  // Tables without user_id: whole-table counts (nothing else writes during the run).
  for (const t of ['assessment_blueprints', 'assessment_forms', 'form_items', 'roadmap_milestones']) {
    const { count } = await admin.from(t).select('*', { count: 'exact', head: true })
    counts[t] = count ?? 0
  }
  const { data: profile } = await admin.from('profiles').select('*').eq('id', uid).maybeSingle()
  return { counts, profile: JSON.stringify(profile) }
}

async function main() {
  console.log('\nRender purity (GET must not write)\n')
  const email = getE2EEmail()
  const s = createSession(admin, email)
  check('signed in', await s.signIn())
  const uid = await verifyAndGetE2EUser(admin)

  await resetE2EUser(admin, uid)
  await assertBlankOnboarding(admin, uid)
  await completeOnboarding(s, admin)
  // The old trigger state: onboarded, active roadmap, nothing planned.
  await admin.from('plan_blocks').delete().eq('user_id', uid)
  await admin.from('planning_cycles').delete().eq('user_id', uid)
  const { count: active } = await admin.from('study_roadmaps').select('*', { count: 'exact', head: true }).eq('user_id', uid).eq('status', 'active')
  check('precondition: an active roadmap and no planned work', active === 1)

  // A legacy row: this week, cycle_id null, as old accounts have.
  const legacyId = 'legacy-e2e-repair'
  const nowIso = new Date().toISOString()
  const today = nowIso.slice(0, 10)
  await admin.from('plan_blocks').delete().eq('id', legacyId)
  const ins = await admin.from('plan_blocks').insert({
    id: legacyId, user_id: uid, title: 'LEGACY-REPAIR-MARKER', detail: '', task_type: 'repair', origin: 'planner',
    priority: 'core', placement: 'timed', execution: 'not_started', local_date: today, day: today,
    starts_at: nowIso, duration_minutes: 30, duration: '30', created_by: 'algorithm',
  })
  check('legacy cycle-less row inserted', !ins.error, ins.error?.message)

  const nextWeek = new Date(Date.now() + 8 * 86_400_000).toISOString().slice(0, 10)
  const pages = ['/app', '/app/calendar', `/app/calendar?week=${nextWeek}`, '/app/calendar?view=agenda', '/app/curriculum', '/app/curriculum?view=readiness', '/app/curriculum/fsa', '/app/curriculum/fsa/r028', '/app/tests', '/app/settings']

  const before = await snapshot(uid)
  const statuses: Record<string, number> = {}
  const calendarHtml: string[] = []
  for (let round = 0; round < 2; round++) {
    for (const p of pages) {
      const res = await s.req(p)
      statuses[p] = res.status
      if (p === '/app/calendar') calendarHtml.push(await res.text())
    }
  }
  const after = await snapshot(uid)

  for (const p of pages) check(`GET ${p} renders`, statuses[p] === 200, `status ${statuses[p]}`)
  for (const t of TABLES) check(`${t}: row count unchanged after GETs`, before.counts[t] === after.counts[t], `${before.counts[t]} -> ${after.counts[t]}`)
  check('profile row unchanged after GETs', before.profile === after.profile)
  check('Calendar offers the explicit command instead of generating', (calendarHtml[0] ?? '').includes('Prepare this week'))
  check('legacy cycle-less task is not displayed on Calendar', !(calendarHtml[0] ?? '').includes('LEGACY-REPAIR-MARKER'))
  const { count: kept } = await admin.from('plan_blocks').select('*', { count: 'exact', head: true }).eq('id', legacyId)
  check('legacy row is preserved in the database', kept === 1)
  await admin.from('plan_blocks').delete().eq('id', legacyId)
  finish()
}
main().catch(e => { console.error(e); process.exit(1) })
