/**
 * C3 end-to-end: the long-term roadmap through the real endpoints.
 *
 *   npm run dev
 *   npx tsx scripts/e2e-roadmap.ts --reset
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import { FINAL_PHASE_WEEKS } from '../src/lib/curriculum/roadmap'
import { daysBetween } from '../src/lib/planning/studyWeek'

dotenv.config({ path: '.env.local', quiet: true } as any)

import { getE2EEmail, verifyAndGetE2EUser, resetE2EUser, E2E_BASE_URL } from '../src/lib/testing/e2eIdentity'

const BASE = E2E_BASE_URL
const EMAIL = getE2EEmail()

let passed = 0, failed = 0
const check = (n: string, ok: boolean, d = '') => { ok ? (passed++, console.log(`  ✓ ${n}`)) : (failed++, console.log(`  ✗ ${n}${d ? ` — ${d}` : ''}`)) }

const jar = new Map<string, string>()
function store(res: Response) {
  for (const line of ((res.headers as any).getSetCookie?.() ?? []) as string[]) {
    const [pair] = line.split(';'); const i = pair.indexOf('=')
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim())
  }
}
async function req(path: string, init: RequestInit = {}) {
  const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
  const res = await fetch(`${BASE}${path}`, { ...init, redirect: 'manual', headers: { ...(init.headers ?? {}), ...(cookie ? { cookie } : {}) } })
  store(res); return res
}
async function json(path: string, init: RequestInit = {}) {
  const res = await req(path, init); const t = await res.text()
  try { return { status: res.status, body: JSON.parse(t) } } catch { return { status: res.status, body: { raw: t.slice(0, 200) } } }
}
const post = (p: string, b?: unknown) => json(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) })

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

async function main() {
  console.log(`\nC3 end-to-end: the roadmap against ${BASE}\n`)

  const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email: EMAIL })
  let path = `/auth/confirm?token_hash=${(link!.properties as any).hashed_token}&type=magiclink&next=/app/curriculum`
  for (let i = 0; i < 5; i++) {
    const res = await req(path); const loc = res.headers.get('location')
    if (!loc) break
    const u = new URL(loc, BASE); path = u.pathname + u.search
    if (path.startsWith('/app')) break
  }
  check('signed in', path.startsWith('/app'))

  const uid = await verifyAndGetE2EUser(admin)

  // The calendar hero shows today's task instead of the milestone when any is planned,
  // so this suite must not inherit another suite's planned week (dedicated +e2e account only).
  await admin.from('plan_blocks').delete().eq('user_id', uid)
  await admin.from('planning_cycles').delete().eq('user_id', uid)

  if (process.argv.includes('--reset')) {
    await admin.from('roadmap_milestones').delete().eq('user_id', uid)
    await admin.from('study_roadmaps').delete().eq('user_id', uid)
    await admin.from('user_module_state').delete().eq('user_id', uid)
    // Feasibility is only 'unknown' when there is no availability at all, so a
    // suite asserting that must not inherit another suite's week.
    await admin.from('availability_rules').delete().eq('user_id', uid)
    // Onboarding now records real study windows and an exam date as well.
    await admin.from('availability_windows').delete().eq('user_id', uid)
    await admin.from('task_events').delete().eq('user_id', uid)
    await admin.from('profiles').update({ registered: false, exam_date: null, exam_window_id: null, exam_year: null, exam_sitting: null }).eq('id', uid)
    console.log('  (reset)')
  }

  // --- The graph -----------------------------------------------------------
  console.log('\nCurriculum graph')
  const { count: topicCount } = await admin.from('topics').select('id', { count: 'exact', head: true })
  const { count: moduleCount } = await admin.from('learning_modules').select('id', { count: 'exact', head: true })
  const { count: edgeCount } = await admin.from('lm_edges').select('from_lm', { count: 'exact', head: true })
  check('all ten topics are seeded', topicCount === 10, `${topicCount}`)
  check('the module graph is populated', (moduleCount ?? 0) >= 60, `${moduleCount} modules`)
  check('dependencies exist', (edgeCount ?? 0) >= 40, `${edgeCount} edges`)

  const { data: weights } = await admin.from('topics').select('id, exam_weight_min, exam_weight_max')
  const totalMid = (weights ?? []).reduce((s, t) => s + (Number(t.exam_weight_min) + Number(t.exam_weight_max)) / 2, 0)
  check('topic weights sum to roughly 100%', Math.abs(totalMid - 100) <= 6, `${totalMid.toFixed(1)}%`)

  const { data: orphans } = await admin.from('learning_modules').select('id').is('topic_ref', null)
  check('every module belongs to a topic', (orphans ?? []).length === 0, `${(orphans ?? []).length} orphaned`)

  // --- No target yet -------------------------------------------------------
  console.log('\nBefore a target is chosen')
  const noTarget = await json('/api/roadmap')
  check('there is no roadmap yet', noTarget.body?.ok === true && noTarget.body.roadmap === null, JSON.stringify(noTarget.body).slice(0, 120))
  const refused = await post('/api/roadmap', {})
  check('generating without a target is refused with a reason',
    refused.status === 400 && refused.body?.code === 'NO_TARGET', JSON.stringify(refused.body).slice(0, 140))

  const page = await req('/app/curriculum?view=roadmap')
  const html = await page.text()
  check('Curriculum asks which exam first', page.status === 200 && html.includes('Which exam are you sitting'))

  // --- Choose a target roughly nine months out -----------------------------
  console.log('\nChoosing a sitting')
  const today = new Date().toISOString().slice(0, 10)
  const { data: windowRows } = await admin
    .from('exam_windows').select('id, year, sitting, window_opens').gt('window_opens', today).order('window_opens')

  const nineMonths = (windowRows ?? []).find(w => {
    const d = daysBetween(today, w.window_opens as string)
    return d >= 230 && d <= 320
  }) ?? (windowRows ?? [])[0]
  check('a future exam window is available', Boolean(nineMonths))
  if (!nineMonths) return finish()
  const horizonDays = daysBetween(today, nineMonths.window_opens as string)
  console.log(`  targeting ${nineMonths.sitting} ${nineMonths.year} — ${horizonDays} days out`)

  const built = await post('/api/roadmap', { examWindowId: nineMonths.id, registered: false, activate: true })
  check('a roadmap is built', built.body?.ok === true, JSON.stringify(built.body).slice(0, 200))
  const roadmap = built.body?.roadmap
  if (!roadmap) return finish()

  // --- The exit test -------------------------------------------------------
  console.log('\nExit test: phases and the protected final weeks')
  const firstPass = roadmap.phases.find((p: any) => p.phase === 'first_pass')
  const final = roadmap.phases.find((p: any) => p.phase === 'final')
  check('a first pass is planned', Boolean(firstPass))
  check('the final phase is eight weeks', final?.weeks === FINAL_PHASE_WEEKS, `${final?.weeks}`)
  if (firstPass && horizonDays >= 240) {
    const firstPassDays = daysBetween(roadmap.startDate, firstPass.endDate)
    check('the first pass finishes within seven months', firstPassDays <= 213, `${firstPassDays} days`)
  }
  check('nothing is planned into the final phase',
    roadmap.milestones.every((m: any) => m.endWeek < (final?.startWeek ?? 1e9)))
  check('every topic is in the plan', new Set(roadmap.milestones.map((m: any) => m.topicId)).size === 10,
    `${new Set(roadmap.milestones.map((m: any) => m.topicId)).size} topics`)
  check('milestones are week ranges, not exact dates',
    roadmap.milestones.every((m: any) => m.endWeek >= m.startWeek && m.startDate && m.endDate))

  // Scoped to this roadmap: superseded roadmaps keep their own milestones, which
  // is the record of what was planned at the time.
  const { data: storedMilestones } = await admin
    .from('roadmap_milestones').select('id, phase, sequence').eq('roadmap_id', built.body.id)
  check('milestones are persisted against this roadmap',
    (storedMilestones ?? []).length === roadmap.milestones.length,
    `${(storedMilestones ?? []).length} stored vs ${roadmap.milestones.length}`)

  // --- Feasibility ---------------------------------------------------------
  console.log('\nFeasibility')
  check('a verdict is given', Boolean(roadmap.feasibility?.verdict), JSON.stringify(roadmap.feasibility).slice(0, 120))
  check('with no availability recorded it says unknown rather than guessing',
    roadmap.feasibility.verdict === 'unknown', roadmap.feasibility.verdict)
  check('and explains what is missing', /study windows|availability|how fast/.test(roadmap.feasibility.message))
  check('no hours are claimed per module', !JSON.stringify(roadmap.milestones).includes('hours'))

  // --- Progress ------------------------------------------------------------
  console.log('\nPlanned against actual')
  let progress = built.body?.progress
  check('progress is reported', Boolean(progress))
  check('nothing is done yet', progress.actualPercent === 0, `${progress.actualPercent}%`)
  check('a current milestone is identified', Boolean(progress.currentMilestone))
  check('it is the first one', progress.currentMilestone?.sequence === 1)

  // Record real coverage and confirm the plan reacts.
  const { data: quantModules } = await admin.from('learning_modules').select('id').eq('topic_ref', 'quant')
  const coverageRes = await post('/api/curriculum/coverage', {
    updates: (quantModules ?? []).map(m => ({ lmId: m.id, state: 'studied' })),
  })
  check('coverage can be self-reported', coverageRes.body?.ok === true, JSON.stringify(coverageRes.body).slice(0, 140))

  const verified = await post('/api/curriculum/coverage', { lmId: (quantModules ?? [])[0]?.id, state: 'verified' })
  check('a student cannot mark their own work verified', verified.status === 400,
    JSON.stringify(verified.body).slice(0, 160))

  const after = await json('/api/roadmap')
  check('progress moves once coverage is recorded', after.body?.progress?.actualPercent > 0,
    `${after.body?.progress?.actualPercent}%`)
  check('the plan still knows the total', after.body?.progress?.modulesTotal >= 60)
  check('planned and actual are both reported',
    typeof after.body?.progress?.plannedPercent === 'number' && typeof after.body?.progress?.actualPercent === 'number')

  const { data: stateRows } = await admin.from('user_module_state').select('source').eq('user_id', uid).limit(1)
  check('a self-report is stored as a self-report', stateRows?.[0]?.source === 'self_report', stateRows?.[0]?.source)

  // --- The pages -----------------------------------------------------------
  console.log('\nPages')
  const curriculum = await req('/app/curriculum?view=roadmap')
  const curriculumHtml = await curriculum.text()
  check('Curriculum renders the roadmap', curriculum.status === 200 && curriculumHtml.includes('weeks to the exam'))
  check('it shows the phases', curriculumHtml.includes('First pass') && curriculumHtml.includes('Final preparation'))
  check('it shows planned against actual', curriculumHtml.includes('Planned against actual'))
  check('it names the sequence', curriculumHtml.includes('The sequence'))

  const syllabus = await req('/app/syllabus')
  check('/app/syllabus redirects to /app/curriculum',
    syllabus.status >= 300 && syllabus.status < 400 && (syllabus.headers.get('location') ?? '').includes('/app/curriculum'),
    `${syllabus.status} → ${syllabus.headers.get('location')}`)

  const calendar = await req('/app/calendar')
  const calendarHtml = await calendar.text()
  check('the calendar shows what the week draws from', calendar.status === 200 && calendarHtml.includes('This week draws from'))
  check('and only the near-term milestone, not the whole plan',
    (calendarHtml.match(/wk \d/g) ?? []).length === 0)

  // --- Rebuild -------------------------------------------------------------
  console.log('\nRebuilding')
  const rebuilt = await post('/api/roadmap', { activate: true })
  check('the roadmap can be rebuilt from current position', rebuilt.body?.ok === true)
  const { data: activeRows } = await admin
    .from('study_roadmaps').select('id, status').eq('user_id', uid).eq('status', 'active')
  check('only one roadmap is active at a time', (activeRows ?? []).length === 1, `${(activeRows ?? []).length} active`)

  finish()
}

function finish() {
  console.log(`\n${passed} passed, ${failed} failed\n`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch(e => { console.error('\nCrashed:', e); process.exit(1) })
