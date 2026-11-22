/**
 * Curriculum coverage is protected where it is written (fixture students, development database, own dev server):
 *   E2E_BASE_URL=http://localhost:3141 npx tsx scripts/curriculum-coverage-test.ts
 * A self-report can record where the student believes they are; it can never replace what their answers verified, and can never claim verification.
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)
import { createStudent, makeCheck } from './lib/e2eSession'

const { check, finish } = makeCheck()
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const made: string[] = []

async function main() {
  console.log('\nCurriculum coverage protection (fixture)\n')
  try {
    const st = await createStudent(admin, 'cov', { onboard: true }); made.push(st.id)
    const lms = ((await admin.from('learning_modules').select('id').eq('is_active', true).order('sequence_hint').limit(6)).data ?? []).map(m => m.id as string)
    const [vA, vB, ord, cls, dup] = lms
    await admin.from('user_module_state').delete().eq('user_id', st.id).in('lm_id', lms)
    const seeded = await admin.from('user_module_state').insert([
      { user_id: st.id, lm_id: vA, coverage_state: 'verified', source: 'diagnostic', last_verified_at: new Date().toISOString(), verification_passes: 2 },
      { user_id: st.id, lm_id: vB, coverage_state: 'studied', source: 'diagnostic', verification_passes: 0 },
      { user_id: st.id, lm_id: ord, coverage_state: 'taught', source: 'self_report', verification_passes: 0 },
      { user_id: st.id, lm_id: cls, coverage_state: 'taught', source: 'class', verification_passes: 0 },
    ])
    check('seeded legacy rows (verified, diagnostic, self-report, class)', !seeded.error, seeded.error?.message)
    const row = async (lm: string) => JSON.stringify((await admin.from('user_module_state').select('*').eq('user_id', st.id).eq('lm_id', lm).maybeSingle()).data)
    const counts = async () => JSON.stringify(await Promise.all(['evidence_events', 'repair_threads', 'concept_state', 'assessment_attempts'].map(async t =>
      (await admin.from(t).select('*', { count: 'exact', head: true }).eq('user_id', st.id)).count)))
    const cov = (body: unknown) => st.s.post('/api/curriculum/coverage', body)

    console.log('1. A self-report cannot replace verified or diagnostic-owned coverage')
    const [bA, bB, ev0] = [await row(vA), await row(vB), await counts()]
    const r1 = await cov({ lmId: vA, state: 'not_started' })
    check('verified row: 409 with a link to record confidence on that reading', r1.status === 409 && r1.body?.code === 'VERIFIED_COVERAGE_PROTECTED' && r1.body.conflicts?.[0]?.href?.endsWith(`/${vA}`), JSON.stringify(r1.body).slice(0, 200))
    check('...and the row is byte-for-byte unchanged', (await row(vA)) === bA)
    const r2 = await cov({ lmId: vB, state: 'not_started' })
    check('diagnostic-owned (not verified) row is protected too, unchanged', r2.status === 409 && (await row(vB)) === bB)
    check('evidence, repair, concept and attempt records are unchanged', (await counts()) === ev0)

    console.log('\n2. A mixed batch cannot partly save')
    const bOrd = await row(ord)
    const r3 = await cov({ updates: [{ lmId: ord, state: 'studied' }, { lmId: vA, state: 'taught' }] })
    check('batch with one protected reading: 409 and nothing saved', r3.status === 409 && (await row(ord)) === bOrd && (await row(vA)) === bA)

    console.log('\n3. A student cannot fabricate verification')
    check('route refuses state "verified"', (await cov({ lmId: ord, state: 'verified' })).status === 400)
    const forged = await admin.from('user_module_state').upsert({ user_id: st.id, lm_id: dup, coverage_state: 'verified', source: 'self_report' }, { onConflict: 'user_id,lm_id' })
    check('even a direct write cannot create self-reported "verified" (database guard)', forged.error?.code === 'CV409', forged.error?.message)
    const direct = await admin.from('user_module_state').update({ coverage_state: 'not_started', source: 'self_report' }).eq('user_id', st.id).eq('lm_id', vA)
    check('a direct self-report update over a verified row is refused by the database too', direct.error?.code === 'CV409' && (await row(vA)) === bA)

    console.log('\n4. Ordinary self-reports still save')
    const r4 = await cov({ lmId: ord, state: 'studied' })
    check('an ordinary self-report saves with self_report provenance', r4.body?.ok === true && JSON.parse(await row(ord)).coverage_state === 'studied')
    const r5 = await cov({ updates: [{ lmId: dup, state: 'taught' }, { lmId: ord, state: 'decaying' }] })
    check('an ordinary batch saves atomically', r5.body?.ok === true && JSON.parse(await row(dup)).coverage_state === 'taught' && JSON.parse(await row(ord)).coverage_state === 'decaying')
    const r6 = await cov({ lmId: cls, state: 'not_started' })
    check('a student may still correct class-sourced coverage (not evidence)', r6.body?.ok === true)

    console.log('\n5. Input validation')
    check('duplicate readings in one request: 400', (await cov({ updates: [{ lmId: ord, state: 'taught' }, { lmId: ord, state: 'studied' }] })).status === 400)
    check('unknown reading: 400', (await cov({ lmId: 'nope-999', state: 'taught' })).status === 400)
    check('empty request: 400', (await cov({})).status === 400)
    for (const bad of [null, [], true, 17]) check(`non-object coverage payload ${JSON.stringify(bad)}: 400, not a server error`, (await cov(bad)).status === 400)
    check('malformed entries: 400, not a crash', (await cov({ updates: [null, 5] })).status === 400)

    console.log('\n6. Real scoring and class paths keep their own rules')
    const up = await admin.from('user_module_state').update({ coverage_state: 'decaying', source: 'diagnostic' }).eq('user_id', st.id).eq('lm_id', vA)
    check('a diagnostic can still change a verified row (decay)', !up.error && JSON.parse(await row(vA)).coverage_state === 'decaying')
    const up2 = await admin.from('user_module_state').update({ coverage_state: 'verified', source: 'diagnostic' }).eq('user_id', st.id).eq('lm_id', ord)
    check('a diagnostic can verify an ordinary row', !up2.error && JSON.parse(await row(ord)).coverage_state === 'verified')

    console.log('\n7. Readiness opens the exact owned repair, else the reading')
    const map = (await admin.from('concept_outcome_map').select('concept_id, outcome_id').limit(2)).data ?? []
    const manifest = (await admin.from('curriculum_manifests').select('id').limit(1).single()).data!.id as string
    if (map.length >= 2) {
      const mkThread = async (conceptId: string) => (await admin.from('repair_threads').insert({ user_id: st.id, concept_id: conceptId, manifest_id: manifest, status: 'open', latest_evidence_at: new Date().toISOString() }).select('id').single()).data!.id as string
      const [m1, m2] = map
      const t1 = await mkThread(m1.concept_id as string), t2 = m2.concept_id === m1.concept_id ? t1 : await mkThread(m2.concept_id as string)
      const cyc = (await admin.from('planning_cycles').select('id, ends_at_local').eq('user_id', st.id).eq('status', 'active').single()).data!
      await admin.from('plan_blocks').insert({ id: `rp-${st.id.slice(0, 8)}`, user_id: st.id, cycle_id: cyc.id, title: 'Repair task', detail: 'd', task_type: 'repair', origin: 'planner', priority: 'core', placement: 'day_preferred', execution: 'not_started', local_date: cyc.ends_at_local, day: cyc.ends_at_local, duration_minutes: 30, duration: '30', created_by: 'algorithm', repair_thread_id: t1 })
      const { getRepairLinks } = await import('../src/lib/curriculum/losTrackerService')
      const links = await getRepairLinks(st.id)
      check('a scheduled repair opens its dated Calendar task', links[m1.outcome_id as string]?.includes('/app/calendar') && links[m1.outcome_id as string].includes('rp-'), links[m1.outcome_id as string])
      if (t2 !== t1) check('an open, unplaced repair opens the repair thread', links[m2.outcome_id as string]?.startsWith('/app/coach?repair='), links[m2.outcome_id as string])
      check('an outcome with no repair has no repair link', Object.keys(links).every(k => k === m1.outcome_id || k === m2.outcome_id))
    }

    console.log('\n8. A repair obligation stays visible through every lifecycle state, without inventing an observation')
    {
      const mp = (await admin.from('concept_outcome_map').select('concept_id, outcome_id').range(40, 40)).data![0]
      const manifest2 = (await admin.from('curriculum_manifests').select('id').limit(1).single()).data!.id as string
      const th = (await admin.from('repair_threads').insert({ user_id: st.id, concept_id: mp.concept_id, manifest_id: manifest2, status: 'open', latest_evidence_at: new Date().toISOString() }).select('id').single()).data!.id as string
      const { getLosTracker } = await import('../src/lib/curriculum/losTrackerService')
      const rowNow = async () => { const t = await getLosTracker(st.id); for (const tp of t.topics) for (const m of tp.modules) for (const r of m.rows) if (r.outcomeId === mp.outcome_id) return r; return null }
      for (const status of ['open', 'proposed', 'scheduled', 'in_progress', 'awaiting_recheck']) {
        await admin.from('repair_threads').update({ status }).eq('id', th)
        const r = await rowNow()
        check(`status ${status}: the outcome is still Repair, with sample 0 (no observation invented)`, r?.band === 'repair' && r.sample === 0, JSON.stringify({ band: r?.band, sample: r?.sample }))
      }
      await admin.from('repair_threads').update({ status: 'closed', closed_at: new Date().toISOString(), closure_reason: 'fixture' }).eq('id', th)
      const closed = await rowNow()
      check('a closed thread no longer holds the outcome in Repair', closed?.band !== 'repair')
    }

    console.log('\n9. Flashcard rating replay (a lost response and retry must not advance the card twice)')
    {
      const mk = await st.s.post('/api/curriculum/flashcards', { action: 'create', scopeType: 'reading', scopeId: 'r028', front: 'Replay front', back: 'Replay back', requestKey: crypto.randomUUID() })
      const card = mk.body?.card
      check('a card is created', mk.body?.ok === true && !!card?.id && card.revision === 1, JSON.stringify(mk.body).slice(0, 120))
      const ev0 = await counts()
      const key = crypto.randomUUID()
      const r1 = await st.s.post('/api/curriculum/flashcards', { action: 'review', cardId: card.id, rating: 'good', expectedRevision: card.revision, requestKey: key })
      const retry = await st.s.post('/api/curriculum/flashcards', { action: 'review', cardId: card.id, rating: 'good', expectedRevision: card.revision, requestKey: key })
      const after = (await admin.from('flashcards').select('reps, interval_days, revision').eq('id', card.id).single()).data!
      check('the first rating advances the card once', r1.body?.ok === true && !r1.body.replay && after.reps === card.reps + 1 && after.revision === 2, JSON.stringify(after))
      check('the retry of the same request is recognised and does not advance it again', retry.body?.ok === true && retry.body.replay === true && after.reps === card.reps + 1)
      const [c1, c2] = await Promise.all([1, 2].map(() => st.s.post('/api/curriculum/flashcards', { action: 'review', cardId: card.id, rating: 'good', expectedRevision: after.revision, requestKey: crypto.randomUUID() })))
      const afterRace = (await admin.from('flashcards').select('reps').eq('id', card.id).single()).data!
      check('two concurrent ratings (same view of the card) advance it exactly once; the other is told the card changed', afterRace.reps === after.reps + 1 && [c1, c2].filter(x => x.body?.ok === true).length === 1 && [c1, c2].filter(x => x.status === 409 && x.body?.code === 'STALE_CARD').length === 1, `${afterRace.reps} (was ${after.reps})`)
      check('card ratings leave diagnostic evidence unchanged', (await counts()) === ev0)
    }

    console.log('\n9b. Canonical reading coverage across all ten subjects (explicit identity, validated, all-or-nothing)')
    {
      const rs = (await admin.from('curriculum_readings').select('id, topic_id, legacy_module_ids').eq('is_active', true).order('sequence')).data ?? []
      const byTopic = new Map<string, any>(); for (const r of rs) if (!byTopic.has(r.topic_id)) byTopic.set(r.topic_id, r)
      const picks = [...byTopic.values()]; const unmapped = picks.filter(r => (r.legacy_module_ids ?? []).length === 0)
      check('ten subjects, and most have NO legacy module mapping (so the old module ids could never reach them)', picks.length === 10 && unmapped.length >= 8, `${picks.length} subjects, ${unmapped.length} unmapped`)
      const ids = picks.map(r => r.id as string); await admin.from('user_module_state').delete().eq('user_id', st.id).in('lm_id', ids)
      const cycle = (await admin.from('planning_cycles').select('id').eq('user_id', st.id).eq('status', 'active').single()).data!.id as string
      const version = async () => (await admin.rpc('weekly_source_version', { p_user: st.id, p_cycle: cycle })).data as string
      const v0 = await version(), ev1 = await counts()
      const states = picks.map((r, i) => ({ readingId: r.id, topicId: r.topic_id, state: i % 3 === 0 ? 'covered' : i % 3 === 1 ? 'partly' : 'not_started' }))
      const ok1 = await cov({ updates: states })
      check('one request reports ten readings, one per subject, including readings with no legacy mapping', ok1.body?.ok === true && ok1.body.updated === 10, JSON.stringify(ok1.body).slice(0, 160))
      const rows = (await admin.from('user_module_state').select('lm_id, coverage_state, source').eq('user_id', st.id).in('lm_id', ids)).data ?? []
      check('stored under the canonical reading id, source self_report: covered→studied, partly→taught, not covered→not_started', picks.every((r, i) => { const x = rows.find(y => y.lm_id === r.id); return x?.source === 'self_report' && x.coverage_state === (i % 3 === 0 ? 'studied' : i % 3 === 1 ? 'taught' : 'not_started') }), JSON.stringify(rows).slice(0, 200))
      const tr = (await st.s.json('/api/curriculum/readiness')).body?.tracker
      const mod = (id: string) => (tr?.topics ?? []).flatMap((t: any) => t.modules).find((m: any) => m.id === id)
      check('the tracker reads the SAME stored identity for every subject (studied / taught / not started)', picks.every((r, i) => mod(r.id)?.coverage === (i % 3 === 0 ? 'studied' : i % 3 === 1 ? 'taught' : 'not_started')), JSON.stringify(picks.map(r => mod(r.id)?.coverage)))
      check('a reported report is not evidence: no verified state, evidence/repair/concept/attempt rows unchanged', rows.every(x => x.coverage_state !== 'verified') && (await counts()) === ev1)
      check('the weekly draft change token moved, so a pending unaccepted draft built from the old context is stale', (await version()) !== v0)
      const again = await cov({ updates: states }); const rows2 = (await admin.from('user_module_state').select('lm_id, coverage_state').eq('user_id', st.id).in('lm_id', ids)).data ?? []
      check('the same request repeated is idempotent: ten rows, same states', again.body?.ok === true && rows2.length === 10 && rows2.every(x => rows.find(y => y.lm_id === x.lm_id)?.coverage_state === x.coverage_state))
      const snap = JSON.stringify((await admin.from('user_module_state').select('lm_id, coverage_state').eq('user_id', st.id).order('lm_id')).data)
      const bad = [
        ['an unknown reading', { updates: [{ readingId: ids[0], state: 'covered' }, { readingId: 'r999', state: 'covered' }] }, 'UNKNOWN_READING'],
        ['a retired legacy module sent as a reading', { updates: [{ readingId: ids[0], state: 'covered' }, { readingId: 'alt-features', state: 'covered' }] }, 'UNKNOWN_READING'],
        ['a retired legacy module sent as lmId', { updates: [{ readingId: ids[0], state: 'covered' }, { lmId: 'alt-features', state: 'studied' }] }, 'RETIRED_MODULE'],
        ['a reading under the wrong subject', { updates: [{ readingId: ids[0], state: 'covered' }, { readingId: ids[1], topicId: picks[0].topic_id, state: 'covered' }] }, 'WRONG_SUBJECT'],
      ] as const
      for (const [label, body, code] of bad) { const r = await cov(body); check(`${label}: 400 ${code}, and the valid entry in the same batch was NOT saved`, r.status === 400 && r.body?.code === code && JSON.stringify((await admin.from('user_module_state').select('lm_id, coverage_state').eq('user_id', st.id).order('lm_id')).data) === snap, JSON.stringify(r.body).slice(0, 140)) }
      check('"verified", an unknown state and a mixed readingId+lmId entry are refused', (await cov({ updates: [{ readingId: ids[0], state: 'verified' }] })).status === 400 && (await cov({ updates: [{ readingId: ids[0], state: 'studied' }] })).status === 400 && (await cov({ updates: [{ readingId: ids[0], lmId: ids[0], state: 'covered' }] })).status === 400)
      await admin.from('user_module_state').upsert({ user_id: st.id, lm_id: ids[2], coverage_state: 'studied', source: 'diagnostic', verification_passes: 0 }, { onConflict: 'user_id,lm_id' })
      const snap2 = JSON.stringify((await admin.from('user_module_state').select('lm_id, coverage_state').eq('user_id', st.id).order('lm_id')).data)
      const prot = await cov({ updates: [{ readingId: ids[0], state: 'partly' }, { readingId: ids[2], state: 'not_started' }] })
      check('a reading whose coverage a test owns is protected: 409 and nothing in the batch is saved', prot.status === 409 && JSON.stringify((await admin.from('user_module_state').select('lm_id, coverage_state').eq('user_id', st.id).order('lm_id')).data) === snap2, JSON.stringify(prot.body).slice(0, 140))
      const mine3 = JSON.stringify((await admin.from('user_module_state').select('coverage_state, source').eq('user_id', st.id).eq('lm_id', ids[3])).data)
      const other = await createStudent(admin, 'cov2', { onboard: true }); made.push(other.id)
      const otherRows = await other.s.post('/api/curriculum/coverage', { updates: [{ readingId: ids[3], state: 'covered' }] })
      check('another student writes only their own rows (the session decides the owner; there is no owner field)', otherRows.body?.ok === true && ((await admin.from('user_module_state').select('lm_id').eq('user_id', other.id).eq('lm_id', ids[3])).data ?? []).length === 1 && JSON.stringify((await admin.from('user_module_state').select('coverage_state, source').eq('user_id', st.id).eq('lm_id', ids[3])).data) === mine3)
      check('legacy callers still work with an ACTIVE module id', (await cov({ lmId: ids[4], state: 'taught' })).body?.ok === true)
    }

    console.log('\n10. PrepPlan replacement is atomic and replay-safe')
    {
      const act = await st.s.post('/api/roadmap', { activate: true })
      check('a roadmap can be built', act.body?.ok === true, JSON.stringify(act.body).slice(0, 140))
      const live = async () => ((await admin.from('study_roadmaps').select('id, status').eq('user_id', st.id).in('status', ['active', 'draft'])).data ?? [])
      const before = await live()
      const msBefore = (await admin.from('roadmap_milestones').select('id', { count: 'exact', head: true }).eq('roadmap_id', before[0]?.id ?? '')).count
      const again = await st.s.post('/api/roadmap', { activate: true })
      const afterSame = await live()
      check('the same request again (lost response) returns the same roadmap, building nothing new', again.body?.ok === true && afterSame.length === 1 && afterSame[0].id === before[0].id, JSON.stringify(afterSame))
      const bad = await admin.rpc('replace_roadmap', { p_user: st.id, p_activate: true, p_hash: 'inject-' + Date.now(), p_roadmap: { target_date: '2027-05-20', route: 'self_study', phases: [], inputs: {}, feasibility: {} }, p_milestones: [{ phase: 'not-a-phase', topic_ref: 'x', sequence: 1, planned_start_week: 1, planned_end_week: 1, planned_start_date: '2026-11-09', planned_end_date: '2026-11-15', effort_weight: 1 }] })
      const afterBad = await live()
      check('a failing milestone rolls the whole replacement back: the previous roadmap is still the one active', !!bad.error && afterBad.length === 1 && afterBad[0].id === before[0].id && afterBad[0].status === 'active', bad.error?.message)
      check('...with its milestones intact and no partial replacement left', (await admin.from('roadmap_milestones').select('id', { count: 'exact', head: true }).eq('roadmap_id', before[0].id)).count === msBefore)
      check('the replacement function is service-only', (await st.s.post('/api/roadmap', { examWindowId: 'x' })).status === 410)
    }
  } finally {
    for (const id of made) await admin.auth.admin.deleteUser(id).catch(() => {})
  }
  finish()
}
main().catch(e => { console.error(e); process.exit(1) })
