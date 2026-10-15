/**
 * Phase 1-2 live: the canonical completed scope, the weighted paper preview, confirmation of
 * unresolved blocks, "I studied this", and the 90-question ceiling. Dedicated +e2e account only.
 *
 *   npm run dev
 *   npx tsx scripts/e2e-tests-scope.ts
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)
import { getE2EEmail, verifyAndGetE2EUser, resetE2EUser, assertBlankOnboarding, E2E_BASE_URL } from '../src/lib/testing/e2eIdentity'
import { createSession, completeOnboarding, makeCheck } from './lib/e2eSession'

const { check, finish } = makeCheck()
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const MANIFEST_ID = '11111111-1111-1111-1111-111111111111'
const addDays = (d: string, n: number) => new Date(new Date(`${d}T12:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10)

async function main() {
  console.log('\nTests: completed scope and weighted paper\n')
  const s = createSession(admin, getE2EEmail())
  check('signed in', await s.signIn())
  const uid = await verifyAndGetE2EUser(admin)
  await resetE2EUser(admin, uid)
  await assertBlankOnboarding(admin, uid)
  await completeOnboarding(s, admin)

  const cnt = async (t: string) => (await admin.from(t).select('*', { count: 'exact', head: true }).eq('user_id', uid)).count ?? 0
  const post = (p: string, b?: unknown) => fetch(`${E2E_BASE_URL}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b ?? {}) })
  check('scope requires authentication', (await fetch(`${E2E_BASE_URL}/api/tests/scope`)).status === 401)
  check('confirm and quick-study require authentication', (await post('/api/tests/scope/confirm')).status === 401 && (await post('/api/tests/scope/quick-study')).status === 401)
  check('confirm and quick-study are POST only', (await s.req('/api/tests/scope/confirm')).status === 405 && (await s.req('/api/tests/scope/quick-study')).status === 405)

  // --- fixture: a cycle whose plan is "A-Z" but only some of it was completed
  const { data: cyc } = await admin.from('planning_cycles').select('id, starts_at_local').eq('user_id', uid).eq('status', 'active').single()
  const cycleId = cyc!.id as string
  const today = new Date().toISOString().slice(0, 10)
  await admin.from('plan_blocks').delete().eq('cycle_id', cycleId)
  const mk = (id: string, o: Record<string, unknown>) => ({
    id, user_id: uid, cycle_id: cycleId, title: id, detail: '', task_type: 'study', origin: 'planner', priority: 'core', placement: 'day_preferred',
    execution: 'completed', local_date: addDays(today, -1), day: addDays(today, -1), duration_minutes: 30, duration: '30', created_by: 'algorithm', ...o,
  })
  const ins = await admin.from('plan_blocks').insert([
    mk('t-done', { title: 'Done: EPS', lm_id: 'r028', outcome_id: 'r028-d' }),
    mk('t-readlevel', { title: 'Done: Balance sheet (reading only)', lm_id: 'r029' }),
    mk('t-postponed', { title: 'Postponed: expense recognition', lm_id: 'r028', outcome_id: 'r028-b', execution: 'deferred' }),
    mk('t-missed', { title: 'Missed: revenue', lm_id: 'r028', outcome_id: 'r028-a', execution: 'skipped' }),
    mk('t-overdue', { title: 'Overdue: non-recurring', lm_id: 'r028', outcome_id: 'r028-c', execution: 'not_started' }),
    mk('t-future', { title: 'Later this week', lm_id: 'r028', outcome_id: 'r028-e', execution: 'not_started', local_date: addDays(today, 2), day: addDays(today, 2) }),
    mk('t-paper', { title: 'Weekly diagnostic paper', task_type: 'diagnostic', origin: 'diagnostic', lm_id: 'r028', outcome_id: 'r028-e' }),
  ])
  check('fixture blocks created', !ins.error, ins.error?.message)
  // an attended class (logged) and a scheduled-but-unlogged class (nothing to insert)
  const sess = await admin.from('class_sessions').insert({ user_id: uid, cycle_id: cycleId, class_date: addDays(today, -1), kind: 'covered', idempotency_key: `e2e-scope-${Date.now()}` }).select('id').single()
  await admin.from('class_session_items').insert({ session_id: sess.data!.id, outcome_id: 'r027-a', extent: 'full', studied_in_class: false })

  const counts0 = { blocks: await cnt('plan_blocks'), sessions: await cnt('class_sessions') }
  const g1 = (await s.json('/api/tests/scope')).body
  const g2 = (await s.json('/api/tests/scope')).body
  check('the scope endpoint is a pure read', (await cnt('plan_blocks')) === counts0.blocks && (await cnt('class_sessions')) === counts0.sessions)
  check('the same scope reads the same revision', g1.preview.scope.revision === g2.preview.scope.revision)
  const scope = g1.preview.scope
  const ids = scope.targets.map((t: any) => t.outcomeId).sort()
  check('only completed, mapped work is in scope (plus attended class coverage)', JSON.stringify(ids) === JSON.stringify(['r027-a', 'r028-d']), JSON.stringify(ids))
  check('a completed reading-level block is unresolved, not guessed', scope.unresolved.some((u: any) => u.blockId === 't-readlevel' && u.reason === 'reading_level'))
  const reasons = Object.fromEntries(scope.excluded.map((e: any) => [e.blockId, e.reason]))
  check('postponed, missed and overdue blocks are excluded with the right reasons', reasons['t-postponed'] === 'postponed' && reasons['t-missed'] === 'missed' && reasons['t-overdue'] === 'not_completed')
  check('a block that is not yet due is neither scope nor excluded', !ids.includes('r028-e') && !('t-future' in reasons))
  check('the paper block itself is not learning scope', !('t-paper' in reasons) && !ids.includes('r028-e'))
  const bp = g1.preview.blueprint
  check('the blueprint stays within the 90-question ceiling', bp.totalQuestions > 0 && bp.totalQuestions <= 90 && bp.policy.ceiling === 90, JSON.stringify(bp.totalQuestions))
  check('nothing is allocated outside completed scope', bp.perOutcome.every((o: any) => ids.includes(o.outcomeId)))
  check('the time estimate uses 90 seconds a question', bp.estimatedMinutes === Math.round(bp.totalQuestions * 1.5))
  check('the thin bank is reported, not hidden', g1.preview.limitation === null || /bank cannot yet fully cover/.test(g1.preview.limitation), String(g1.preview.limitation))

  // --- unresolved -> confirm
  const bad = await s.post('/api/tests/scope/confirm', { blockId: 't-readlevel', outcomeIds: ['r028-a'] })
  check('outcomes from a different reading are refused', bad.status === 400)
  check('a block that was postponed cannot be confirmed as done', (await s.post('/api/tests/scope/confirm', { blockId: 't-postponed', outcomeIds: ['r028-b'] })).status === 409)
  check('an unknown block is a 404', (await s.post('/api/tests/scope/confirm', { blockId: 'nope', outcomeIds: [] })).status === 404)
  const ok = await s.post('/api/tests/scope/confirm', { blockId: 't-readlevel', outcomeIds: ['r029-a', 'r029-b'] })
  check('confirming what a block covered saves', ok.body?.ok === true && ok.body.confirmed === 2)
  const after = (await s.json('/api/tests/scope')).body.preview.scope
  check('confirmed outcomes join the scope and it stops being unresolved', ['r029-a', 'r029-b'].every(o => after.targets.some((t: any) => t.outcomeId === o)) && after.unresolved.length === 0)
  check('the scope revision changed', after.revision !== scope.revision)
  await s.post('/api/tests/scope/confirm', { blockId: 't-readlevel', outcomeIds: [] })
  check('clearing a confirmation puts the block back to unresolved', (await s.json('/api/tests/scope')).body.preview.scope.unresolved.length === 1)
  await s.post('/api/tests/scope/confirm', { blockId: 't-readlevel', outcomeIds: ['r029-a', 'r029-b'] })

  // --- "I studied this": extra learning joins scope through a Calendar block
  const key = `e2eqs${Date.now()}`
  const q = await s.post('/api/tests/scope/quick-study', { idempotencyKey: key, outcomeIds: ['r033-a'], minutes: 40 })
  check('extra learning is recorded', q.body?.ok === true && q.body.blocks === 1)
  const q2 = await s.post('/api/tests/scope/quick-study', { idempotencyKey: key, outcomeIds: ['r033-a'], minutes: 40 })
  check('a repeat of the same key changes nothing', q2.body?.ok === true && ((await admin.from('plan_blocks').select('id').eq('user_id', uid).like('id', `qs-${key}-%`)).data ?? []).length === 1)
  const { data: qb } = await admin.from('plan_blocks').select('execution, origin, task_type, cycle_id, outcome_id').eq('id', `qs-${key}-r033-a`).single()
  check('it is a completed, student-origin, curriculum-mapped Calendar block in this cycle', qb?.execution === 'completed' && qb?.origin === 'student' && qb?.cycle_id === cycleId && qb?.outcome_id === 'r033-a')
  const afterQ = (await s.json('/api/tests/scope')).body.preview.scope
  check('the extra topic is now part of the paper scope', afterQ.targets.some((t: any) => t.outcomeId === 'r033-a' && t.sources[0].type === 'quick'))
  check('an invalid duration is refused', (await s.post('/api/tests/scope/quick-study', { idempotencyKey: `${key}x`, outcomeIds: ['r033-a'], minutes: 1 })).status === 400)
  check('an unknown outcome is refused', (await s.post('/api/tests/scope/quick-study', { idempotencyKey: `${key}y`, outcomeIds: ['r999-a'] })).status === 400)
  check('a key that is too short is refused', (await s.post('/api/tests/scope/quick-study', { idempotencyKey: 'x', outcomeIds: ['r033-a'] })).status === 400)

  // --- new vs revision from history, and purpose-specific papers
  await admin.from('user_module_state').upsert({ user_id: uid, lm_id: 'r027', coverage_state: 'studied', source: 'self_report' }, { onConflict: 'user_id,lm_id' })
  const mixed = (await s.json('/api/tests/scope')).body.preview
  check('material the student already worked before is revision, not new', mixed.scope.targets.find((t: any) => t.outcomeId === 'r027-a').kind === 'revision' && mixed.scope.targets.find((t: any) => t.outcomeId === 'r028-d').kind === 'new')
  check('new and revised together make a mixed paper with both sections', mixed.paperKind === 'mixed' && mixed.blueprint.sections.some((x: any) => x.kind === 'new') && mixed.blueprint.sections.some((x: any) => x.kind === 'revision'))
  const dgn = (await s.json('/api/tests/scope?paper=diagnostic')).body.preview
  const rev = (await s.json('/api/tests/scope?paper=revisionary')).body.preview
  check('a diagnostic paper tests only new scope; a revisionary paper only revisited scope', dgn.blueprint.perOutcome.every((o: any) => o.kind === 'new') && rev.blueprint.perOutcome.every((o: any) => o.kind === 'revision'))

  // --- the Tests page
  const html = await (await s.req('/app/tests')).text()
  check('the Tests page leads with what the paper tests', html.includes('What this week') && /never more than\s*(<!-- -->)?\s*90/.test(html))
  check('it names what is excluded and why', html.includes('Postponed') && html.includes('Missed') && html.includes('not counted against you'))
  check('it links each included reading to Curriculum', html.includes('/app/curriculum/fsa/r028'))
  check('the page render created nothing', (await cnt('plan_blocks')) === (counts0.blocks + 1) && (await cnt('class_sessions')) === counts0.sessions)

  // --- the ceiling is enforced on the free-form endpoint too
  const start = await s.post('/api/diagnostic/attempt', { manifestId: MANIFEST_ID, purpose: 'module_diagnostic', constraints: { maxQuestions: 500 } })
  const { data: bps } = await admin.from('assessment_blueprints').select('*').order('created_at', { ascending: false }).limit(1)
  const stored = JSON.stringify(bps?.[0] ?? {})
  const nums = [...stored.matchAll(/"(?:maxQuestions|max_questions|target_size|length)":\s*(\d+)/g)].map(m => Number(m[1]))
  check('a request for 500 questions is capped at 90', start.body?.ok === true && (nums.length === 0 || nums.every(n => n <= 90)), stored.slice(0, 200))

  // --- with no open cycle there is no scope and no place to record extra learning
  await admin.from('planning_cycles').update({ status: 'closed' }).eq('id', cycleId)
  const none = (await s.json('/api/tests/scope')).body.preview
  check('with no open cycle there is no scope and an honest reason', none.scope.totals.outcomes === 0 && /Nothing has been completed|not yet tied/.test(none.noPaperReason ?? ''))
  check('extra learning cannot be recorded without an open week', (await s.post('/api/tests/scope/quick-study', { idempotencyKey: `${key}z`, outcomeIds: ['r033-a'] })).status === 409)

  await admin.from('planning_cycles').update({ status: 'active' }).eq('id', cycleId)
  await admin.from('class_sessions').delete().eq('user_id', uid).like('idempotency_key', 'e2e-scope-%')
  await admin.from('block_scope_confirmations').delete().eq('user_id', uid)
  await admin.from('plan_blocks').delete().eq('user_id', uid).or('id.like.t-%,id.like.qs-%')
  await admin.from('user_module_state').delete().eq('user_id', uid).eq('lm_id', 'r027')
  finish()
}
main().catch(e => { console.error(e); process.exit(1) })
