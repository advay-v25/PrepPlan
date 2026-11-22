/**
 * A pinned question retired AFTER the paper was reserved: the attempt, its pinned form and the established scoring and challenge rules are unchanged.
 * Needs the ordinary fixture bank (node scripts/fixture-bank.cjs create … --readings=r028 --per-outcome=12 --variants=2) and its reviewer; creates/removes nothing in the bank.
 *   E2E_BASE_URL=http://localhost:3102 npx tsx scripts/e2e-retirement.ts --bank=<record file>
 * Shown on a weekly paper: a mock session uses the same form pinning, answer saving, finalisation and challenge path (a full 180-question rehearsal is not rebuilt for this check).
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)
import fs from 'node:fs'
import path from 'node:path'
import { Client } from 'pg'
import { parse } from 'dotenv'
import { createRequire } from 'node:module'
import { createStudent, makeCheck } from './lib/e2eSession'
const { configuration } = createRequire(import.meta.url)('./lib/migrations.cjs')
const { check, finish } = makeCheck()
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const addDays = (d: string, n: number) => new Date(new Date(`${d}T12:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10)
const today = new Date().toISOString().slice(0, 10)
const J = { 'Content-Type': 'application/json' }
const arg = (k: string) => (process.argv.find(a => a.startsWith(`--${k}=`)) ?? '').split('=').slice(1).join('=')
const made: string[] = []

async function main() {
  const bank = JSON.parse(fs.readFileSync(arg('bank'), 'utf8')) as { items: string[]; users: string[] }
  const reviewer = bank.users[0]
  const db = new Client(configuration(['--env=staging', '--dry-run'], parse(fs.readFileSync(path.join(process.cwd(), '.env.staging.local')))).connection); await db.connect()
  try {
    const st = await createStudent(admin, 'ret', { onboard: true }); made.push(st.id)
    const cyc = (await admin.from('planning_cycles').select('id').eq('user_id', st.id).eq('status', 'active')).data![0].id as string
    await admin.from('planning_cycles').update({ starts_at_local: addDays(today, -1), ends_at_local: addDays(today, 6), starts_at: new Date(Date.now() - 86400000).toISOString(), ends_at: new Date(Date.now() + 6 * 86400000).toISOString() }).eq('id', cyc)
    await admin.from('plan_blocks').delete().eq('cycle_id', cyc)
    const ids = ['a', 'b', 'c', 'd', 'e'].map(c => `ret-${Date.now()}-${c}`)
    await admin.from('plan_blocks').insert(ids.map((id, i) => ({ id, user_id: st.id, cycle_id: cyc, title: `Income statement ${i}`, detail: 'd', task_type: 'study', origin: 'planner', priority: 'core', placement: 'day_preferred', execution: 'not_started', local_date: today, day: today, duration_minutes: 30, duration: '30', created_by: 'algorithm', learning_objective: 'o', suggested_approach: 'a', completion_meaning: 'c', lm_id: 'r028', outcome_id: `r028-${['a', 'b', 'c', 'd', 'e'][i]}` })))
    for (const id of ids) { const rev = Number((await admin.from('plan_blocks').select('revision').eq('id', id).single()).data?.revision); await st.s.json(`/api/tasks/${id}`, { method: 'PATCH', headers: J, body: JSON.stringify({ action: 'execution', execution: 'completed', actualDurationMinutes: 30, expectedRevision: rev }) }) }
    const start = await st.s.post('/api/tests/start', { kind: 'weekly' })
    check('a paper is reserved from the approved fixture bank', start.body?.ok === true, JSON.stringify(start.body).slice(0, 200))
    const attemptId = start.body.attemptId as string
    const form = (await admin.from('assessment_attempts').select('form_id').eq('id', attemptId).single()).data!.form_id as string
    const pinned = (await admin.from('form_items').select('item_id, item_version').eq('form_id', form)).data!
    const open = await st.s.json(`/api/tests/attempt/${attemptId}`)
    const items = open.body.items as { id: string; stem: string }[]
    const answered = items.slice(0, 4), later = items[4]
    for (const it of answered) await st.s.post(`/api/tests/attempt/${attemptId}/answer`, { itemId: it.id, selectedOptionIndex: 0, confidence: 'high', activeSeconds: 20, interruptedSeconds: 0 })
    const retiredAnswered = answered[0].id, retiredLater = later.id
    const retire = async (item: string) => {
      await db.query('BEGIN'); await db.query('SET LOCAL ROLE authenticated')
      await db.query("select set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claims',$2,true)", [reviewer, JSON.stringify({ sub: reviewer, role: 'authenticated' })])
      try { const r = (await db.query("select public.decide_item_review($1,1,'retire','retired after reservation (test)',false) as r", [item])).rows[0].r; await db.query('COMMIT'); return r } catch (e) { await db.query('ROLLBACK'); throw e }
    }
    const r1 = await retire(retiredAnswered), r2 = await retire(retiredLater)
    check('a reviewer retires one answered and one not-yet-answered pinned question through the normal command', r1.ok === true && r2.ok === true, JSON.stringify([r1, r2]).slice(0, 240))
    const status = (await admin.from('assessment_items').select('id, review_status').in('id', [retiredAnswered, retiredLater])).data!
    check('both are now retired in the bank, so no NEW paper can use them', status.every(s => s.review_status !== 'reviewed'))
    const after = await st.s.json(`/api/tests/attempt/${attemptId}`)
    check('the open attempt is untouched: same pinned questions, same stems, same saved answers', after.status === 200 && (after.body.items as any[]).length === items.length && (after.body.items as any[]).every((x, i) => x.id === items[i].id && x.stem === items[i].stem) && after.body.attempt.answered === 4)
    check('the pinned form and recorded item versions did not change', JSON.stringify((await admin.from('form_items').select('item_id, item_version').eq('form_id', form)).data!.sort((a: any, b: any) => a.item_id.localeCompare(b.item_id))) === JSON.stringify([...pinned].sort((a: any, b: any) => a.item_id.localeCompare(b.item_id))))
    const late = await st.s.post(`/api/tests/attempt/${attemptId}/answer`, { itemId: retiredLater, selectedOptionIndex: 1, confidence: 'low', activeSeconds: 15, interruptedSeconds: 0 })
    check('the student can still answer the pinned question that was retired meanwhile', late.body?.ok === true, JSON.stringify(late.body))
    const sub = await st.s.post(`/api/tests/attempt/${attemptId}/submit`, { allowUnanswered: true })
    check('the attempt is scored from what was pinned and answered', sub.body?.ok === true && (await admin.from('assessment_attempts').select('status, valid_response_count').eq('id', attemptId).single()).data?.valid_response_count === 5)
    const evs = (await admin.from('evidence_events').select('item_id, evidence_mode, validity').eq('attempt_id', attemptId)).data!
    check('evidence follows the established rule: an item with a recorded approval still counts as reviewed evidence', evs.some(e => e.item_id === retiredAnswered && e.validity === 'valid'), JSON.stringify(evs.filter(e => e.item_id === retiredAnswered)))
    const wrong = (await admin.from('assessment_responses').select('item_id, is_correct').eq('attempt_id', attemptId)).data!.find(r => r.item_id === retiredAnswered)
    const ch = await st.s.post('/api/diagnostic/challenge', { attemptId, itemId: retiredAnswered, comment: 'This question was retired; I want my answer set aside.', reasonCode: 'other' })
    check('the existing challenge process still accepts a challenge on a retired pinned question', ch.body?.ok === true, JSON.stringify(ch.body).slice(0, 160))
    const ev2 = (await admin.from('evidence_events').select('validity').eq('attempt_id', attemptId).eq('item_id', retiredAnswered)).data!
    check('and the challenged answer is set aside from evidence (disputed), not silently kept', ev2.every(e => e.validity === 'disputed'), JSON.stringify(ev2))
    const res = await st.s.json(`/api/tests/attempt/${attemptId}/result`)
    check('the result still builds and lists the challenged question as set aside', res.body?.ok === true && (res.body.result.invalidated as any[]).some(x => x.itemId === retiredAnswered))
    void wrong
  } finally {
    await db.end().catch(() => {})
    for (const id of made) {
      const att = (await admin.from('assessment_attempts').select('id, form_id').eq('user_id', id)).data ?? []
      const a = att.map(x => x.id as string), f = att.map(x => x.form_id as string)
      if (a.length) { await admin.from('evidence_events').delete().in('attempt_id', a); await admin.from('item_challenges').delete().in('attempt_id', a); await admin.from('assessment_responses').delete().in('attempt_id', a); await admin.from('attempt_item_progress').delete().in('attempt_id', a); await admin.from('plan_blocks').update({ attempt_id: null }).in('attempt_id', a) }
      const th = ((await admin.from('repair_threads').select('id').eq('user_id', id)).data ?? []).map(t => t.id as string)
      if (th.length) { await admin.from('repair_check_threads').delete().in('thread_id', th); await admin.from('repair_thread_events').delete().in('thread_id', th); await admin.from('plan_blocks').update({ repair_thread_id: null }).eq('user_id', id); await admin.from('repair_threads').delete().in('id', th) }
      await admin.from('paper_scope_snapshots').delete().eq('user_id', id)
      if (a.length) await admin.from('assessment_attempts').delete().in('id', a)
      if (f.length) { await admin.from('form_items').delete().in('form_id', f); await admin.from('assessment_forms').delete().in('id', f) }
      await admin.auth.admin.deleteUser(id).catch(() => {})
    }
  }
}
main().then(() => finish()).catch(e => { console.error('\nFAILED:', e?.message ?? e); process.exit(1) })
