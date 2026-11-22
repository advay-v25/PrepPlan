/**
 * The empty-week planning journey against the development database, with isolated throwaway students (deleted by recorded id).
 *   npx tsx scripts/current-week-db-test.ts
 * Fixture results: nothing here touches the question bank, so assessment availability says nothing about live-bank capability.
 */
import { createRequire } from 'node:module'
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)
const require = createRequire(import.meta.url)
const { Client } = require('pg'); const { parse } = require('dotenv'); const { configuration } = require('./lib/migrations.cjs')

let passed = 0, failed = 0
const check = (n: string, ok: boolean, d = '') => { ok ? (passed++, console.log(`  ✓ ${n}`)) : (failed++, console.log(`  ✗ ${n}${d ? ` — ${d}` : ''}`)) }
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!, ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const admin = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const ids: string[] = []

async function student(tag: string) {
  const email = `integ+${tag}${Date.now()}@example.com`, password = `Pw-${crypto.randomUUID()}`
  const uid = (await admin.auth.admin.createUser({ email, password, email_confirm: true })).data.user!.id; ids.push(uid)
  const client = createClient(URL, ANON, { auth: { persistSession: false } }); await client.auth.signInWithPassword({ email, password })
  return { uid, email, client }
}

async function main() {
  const cfg = configuration(['--env=staging', '--dry-run'], parse(fs.readFileSync('.env.staging.local')))
  const conns: any[] = []
  const conn = async () => { const c = new Client({ ...cfg.connection, connectionTimeoutMillis: 30000 }); await c.connect(); conns.push(c); return c }
  console.log('\nEmpty-week planning journey (fixture)\n')
  try {
    const svc = await import('../src/lib/onboarding/service')
    const { generatePreview } = await import('../src/lib/onboarding/previewService')
    const cw = await import('../src/lib/planning/currentWeek/service')
    const { loadPlacementContext } = await import('../src/lib/planning/pulse/generateWeek')
    const { weekForDate } = await import('../src/lib/planning/schedule')
    const { todayInZone } = await import('../src/lib/planning/studyWeek')
    const { data: feb } = await admin.from('exam_windows').select('id').eq('year', 2027).eq('sitting', 'february').single()
    const noTimes = { availabilityMode: 'none_this_week', windows: [], commitments: [], maxSessionMinutes: 60 }
    const times = (days: number[], extra: any[] = []) => ({ availabilityMode: 'windows', windows: days.map(weekday => ({ weekday, startTime: '18:00', endTime: '21:00' })), commitments: extra, maxSessionMinutes: 60 })

    /** A student who completed onboarding with no study times and accepted the (empty) week. */
    async function acceptedEmpty(tag: string) {
      const st = await student(tag)
      await svc.saveExam(st.uid, { examWindowId: feb!.id, registered: false, timezone: 'Europe/London' })
      await svc.saveRoute(st.uid, { prepMode: 'self_study', classPattern: 'none', recurringClasses: [], nextClass: null })
      await svc.savePosition(st.uid, { stage: 'first_pass_underway', topicExposure: {} })
      await svc.saveWeek(st.uid, noTimes)
      const p = await generatePreview(st.uid)
      const acc = await st.client.rpc('accept_onboarding_preview', { p_draft_id: p.draftId, p_expected_revision: p.revision })
      if (acc.error) throw new Error('onboarding accept failed: ' + acc.error.message)
      return { ...st, cycleId: acc.data.cycle_id as string, onboardingDraft: p.draftId }
    }
    const cycleOf = async (uid: string) => (await admin.from('planning_cycles').select('id, starts_at_local, ends_at_local, status').eq('user_id', uid).eq('status', 'active').single()).data!
    const blocks = async (cycleId: string) => ((await admin.from('plan_blocks').select('id').eq('cycle_id', cycleId)).data ?? []).length

    console.log('1. No study times, then saving them')
    const a = await acceptedEmpty('cwa')
    const before = await cycleOf(a.uid)
    let st = await cw.getCurrentWeekPlanState(a.uid)
    check('an accepted empty week with no study times reads "Add study times"', st.kind === 'no_study_times' && st.action?.href === '/onboarding/week?returnTo=%2Fapp%2Fcalendar', st.kind)
    check('the week really is empty', (await blocks(a.cycleId)) === 0)
    await svc.saveWeek(a.uid, times([1, 2, 3, 4, 5, 6]))
    st = await cw.getCurrentWeekPlanState(a.uid)
    check('saving study times is setup only: still no tasks, and a plan is OFFERED, not made', (await blocks(a.cycleId)) === 0 && st.kind === 'ready_to_plan', `${st.kind}, ${await blocks(a.cycleId)} tasks`)

    console.log('\n2. Preview → review → accept into the SAME cycle')
    const prop = await cw.getOrCreateCurrentWeekProposal(a.uid)
    check('a versioned proposal is prepared for the existing cycle', prop.state.kind === 'proposal_ready' && !!prop.draft && prop.draft.tasks.length > 0, `${prop.state.kind}`)
    const today = todayInZone('Europe/London')
    check('every proposed task is today or later and inside the cycle', prop.draft!.tasks.every(t => t.local_date >= today && t.local_date >= before.starts_at_local && t.local_date <= before.ends_at_local))
    const again = await cw.getOrCreateCurrentWeekProposal(a.uid)
    check('asking again reuses the same proposal', again.draft!.draftId === prop.draft!.draftId)
    const trio = await Promise.all([cw.getOrCreateCurrentWeekProposal(a.uid), cw.getOrCreateCurrentWeekProposal(a.uid)])
    check('concurrent previews share it too', trio.every(t => t.draft!.draftId === prop.draft!.draftId))
    check('nothing is in the week until it is accepted', (await blocks(a.cycleId)) === 0)

    // Cross-account refusal before the owner accepts.
    const other = await student('cwx')
    // Exercise ownership independently of the setup gate.
    await admin.from('profiles').update({ onboarding_status: 'complete' }).eq('id', other.uid)
    const refused = await other.client.rpc('accept_current_week_plan', { p_draft_id: prop.draft!.draftId, p_expected_revision: prop.draft!.revision })
    check('another student cannot accept it', !!refused.error && /Unauthorized/.test(refused.error.message), refused.error?.message)

    // Concurrent acceptance on two connections: one result.
    const c1 = await conn(), c2 = await conn()
    const accept = async (c: any) => { await c.query('begin'); await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: a.uid, role: 'authenticated' })]); await c.query('set local role authenticated')
      try { const r = await c.query('select public.accept_current_week_plan($1,$2) as r', [prop.draft!.draftId, prop.draft!.revision]); await c.query('commit'); return r.rows[0].r } catch (e: any) { await c.query('rollback'); return { error: e.message } } }
    const [r1, r2] = await Promise.all([accept(c1), accept(c2)])
    check('two simultaneous acceptances produce one result', !r1.error && !r2.error && r1.cycle_id === r2.cycle_id && r1.tasks_added === r2.tasks_added, JSON.stringify([r1, r2]))
    const after = await cycleOf(a.uid)
    check('the cycle keeps its identity and dates', after.id === before.id && after.starts_at_local === before.starts_at_local && after.ends_at_local === before.ends_at_local)
    check('the tasks were added once, to that cycle', (await blocks(a.cycleId)) === prop.draft!.tasks.length && r1.tasks_added === prop.draft!.tasks.length, `${await blocks(a.cycleId)} vs ${prop.draft!.tasks.length}`)
    const rep = await a.client.rpc('accept_current_week_plan', { p_draft_id: prop.draft!.draftId, p_expected_revision: prop.draft!.revision })
    check('a later repeat returns the stored receipt', !rep.error && rep.data.cycle_id === before.id && rep.data.tasks_added === r1.tasks_added)
    const orig = (await admin.from('plan_drafts').select('status, accepted_cycle_id, purpose').eq('id', a.onboardingDraft).single()).data!
    check('the original onboarding receipt is untouched, and the planning action is recorded separately', orig.status === 'accepted' && orig.accepted_cycle_id === before.id && prop.draft!.draftId !== a.onboardingDraft)
    check('the state now reads plan accepted', (await cw.getCurrentWeekPlanState(a.uid)).kind === 'plan_accepted')

    console.log('\n3. Something changes while a proposal is open')
    const b = await acceptedEmpty('cwb'); await svc.saveWeek(b.uid, times([1, 2, 3, 4, 5, 6]))
    const pb = await cw.getOrCreateCurrentWeekProposal(b.uid)
    await admin.from('plan_blocks').insert({ id: `cw-manual-${Date.now()}`, user_id: b.uid, cycle_id: b.cycleId, title: 'Added by hand', detail: '', task_type: 'study', origin: 'student', priority: 'core', placement: 'day_preferred', execution: 'not_started', local_date: today, day: today, duration_minutes: 20, duration: '20', created_by: 'student' })
    const st1 = await b.client.rpc('accept_current_week_plan', { p_draft_id: pb.draft!.draftId, p_expected_revision: pb.draft!.revision })
    check('a task added by hand refuses the old proposal', !!st1.error && /STALE_PROPOSAL/.test(st1.error.message), st1.error?.message)
    check('…and the week, now holding work, no longer offers an empty-week plan', (await cw.getCurrentWeekPlanState(b.uid)).kind === 'not_applicable')
    const c = await acceptedEmpty('cwc'); await svc.saveWeek(c.uid, times([1, 2, 3, 4, 5, 6]))
    const pc = await cw.getOrCreateCurrentWeekProposal(c.uid)
    await svc.saveWeek(c.uid, times([5, 6]))
    const st2 = await c.client.rpc('accept_current_week_plan', { p_draft_id: pc.draft!.draftId, p_expected_revision: pc.draft!.revision })
    check('an availability change refuses it', !!st2.error && /STALE_PROPOSAL/.test(st2.error.message))
    const sc = await cw.getCurrentWeekPlanState(c.uid)
    check('the state reads "proposal stale", with the draft to rebuild', sc.kind === 'proposal_stale' && sc.draft?.id === pc.draft!.draftId, sc.kind)
    const d = await acceptedEmpty('cwd'); await svc.saveWeek(d.uid, times([1, 2, 3, 4, 5, 6]))
    const pd = await cw.getOrCreateCurrentWeekProposal(d.uid)
    const { data: mod } = await admin.from('learning_modules').select('id').eq('is_active', true).limit(1).single()
    const up = await admin.from('user_module_state').upsert({ user_id: d.uid, lm_id: mod!.id, coverage_state: 'studied', source: 'self_report' }, { onConflict: 'user_id,lm_id' })
    if (up.error) throw new Error('coverage fixture failed: ' + up.error.message)
    const st3 = await d.client.rpc('accept_current_week_plan', { p_draft_id: pd.draft!.draftId, p_expected_revision: pd.draft!.revision })
    check('a change to reported coverage refuses it', !!st3.error && /STALE_PROPOSAL/.test(st3.error.message), st3.error?.message)
    const stale = await cw.getCurrentWeekPlanState(d.uid)
    check('the stale proposal is reported as stale, not silently reused', stale.kind === 'proposal_stale' && stale.action?.kind === 'preview', stale.kind)
    const rebuilt = await cw.getOrCreateCurrentWeekProposal(d.uid)
    check('rebuilding gives a new, current proposal that can be accepted', rebuilt.draft!.draftId !== pd.draft!.draftId && !(await d.client.rpc('accept_current_week_plan', { p_draft_id: rebuilt.draft!.draftId, p_expected_revision: rebuilt.draft!.revision })).error)

    console.log('\n4. Keeping the week empty')
    const e = await acceptedEmpty('cwe'); await svc.saveWeek(e.uid, times([1, 2, 3, 4, 5, 6]))
    const pe = await cw.getOrCreateCurrentWeekProposal(e.uid)
    check('keeping it empty discards the proposal', (await e.client.rpc('dismiss_current_week_plan', { p_draft_id: pe.draft!.draftId, p_expected_revision: pe.draft!.revision })).data?.outcome === 'dismissed')
    check('the state reads intentionally empty, and no task exists', (await cw.getCurrentWeekPlanState(e.uid)).kind === 'intentionally_empty' && (await blocks(e.cycleId)) === 0)
    await svc.saveWeek(e.uid, times([1, 2, 3, 4, 5, 6, 0]))
    check('changing the setup afterwards makes it plannable again', (await cw.getCurrentWeekPlanState(e.uid)).kind === 'ready_to_plan')

    console.log('\n5. Windows, Sundays, ended cycles and commitments')
    const f = await acceptedEmpty('cwf')
    const wk = await weekForDate(f.uid, before.starts_at_local)
    const left = wk.days.filter(x => x >= today)
    const dow = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay()
    const later = [0, 1, 2, 3, 4, 5, 6].filter(w => !left.some(d => dow(d) === w))
    if (later.length) {
      await svc.saveWeek(f.uid, times(later))
      const s5 = await cw.getCurrentWeekPlanState(f.uid)
      check('windows that fall only on days after this cycle: no usable windows, applies next week', s5.kind === 'no_usable_windows' && s5.reason === 'later_week', `${s5.kind}/${s5.reason}`)
    } else console.log('  (every weekday is still ahead today; the later-week case is covered by the pure test)')
    await svc.saveWeek(f.uid, times([1, 2, 3, 4, 5, 6, 0]))
    const sun = await cw.getCurrentWeekPlanState(f.uid, new Date(`${wk.endDate}T12:00:00Z`))
    check('self-study with only Sunday left: Sunday is for paper and review, no study is proposed', sun.kind === 'no_usable_windows' && sun.reason === 'assessment_day_only', `${sun.kind}/${sun.reason}`)
    const cap = async (commit: any[]) => { await svc.saveWeek(f.uid, times([1, 2, 3, 4, 5, 6], commit)); return Object.values((await loadPlacementContext(f.uid, wk, new Date(`${wk.startDate}T08:00:00Z`))).capacity).reduce((n: number, x: any) => n + x, 0) }
    const free = await cap([]), withWork = await cap([{ label: 'Work', kind: 'work', weekdays: [1, 2, 3, 4, 5], startTime: '18:00', endTime: '20:00' }])
    check('commitments occupy the supplied windows', withWork < free, `${free} -> ${withWork} min`)
    await admin.from('planning_cycles').update({ ends_at_local: new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10) }).eq('id', f.cycleId)
    const ended = await cw.getCurrentWeekPlanState(f.uid)
    check('an ended cycle points at weekly review', ended.kind === 'cycle_ended' && ended.action?.href === '/app/review-week')
  } finally {
    for (const c of conns) await c.end().catch(() => {})
    let ok = true
    for (const id of ids) { const del = await admin.auth.admin.deleteUser(id); ok &&= !del.error }
    check('every throwaway student was removed by recorded id', ok)
  }
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}
main().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
