/**
 * Phase 2, live over HTTP: the reviewer workspace and its isolation from students.
 *   E2E_BASE_URL=http://localhost:3102 npx tsx scripts/e2e-reviewer.ts
 * A throwaway reviewer and a throwaway ORDINARY student (no role), plus fixture questions that are deleted by recorded id.
 * No real bank item is approved, edited or held out. The database rules themselves are proved by scripts/reviewer-db-test.cjs.
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import { readFileSync } from 'node:fs'
dotenv.config({ path: '.env.local', quiet: true } as any)
import { createStudent, makeCheck } from './lib/e2eSession'
import { loadEligibleItemPool } from '../src/lib/tests/itemPool'

const { check, finish } = makeCheck()
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const users: string[] = [], items: string[] = [], concepts: string[] = []
const tag = Date.now().toString(36)
const count = async (t: string, filter?: (q: any) => any) => { let q: any = admin.from(t).select('*', { count: 'exact', head: true }); if (filter) q = filter(q); return (await q).count ?? 0 }
const loc = (r: { headers: Headers }) => r.headers.get('location') ?? ''

async function main() {
  const { data: man } = await admin.from('curriculum_manifests').select('id').eq('is_active', true).single()
  const { data: outcome } = await admin.from('reading_los').select('id, reading_id').order('id').limit(1).single()
  const stu = await createStudent(admin, `rvs${tag}`); users.push(stu.id)
  const rev = await createStudent(admin, `rvr${tag}`); users.push(rev.id)
  await admin.from('user_roles').insert({ user_id: rev.id, role: 'diagnostic_reviewer' })
  // Reaching /app routes needs a finished onboarding record; the reviewer journey does not need the planner itself.
  await admin.from('profiles').update({ onboarding_status: 'complete' }).in('id', [stu.id, rev.id])

  const concept = async (status: string) => {
    const id = crypto.randomUUID()
    const { error } = await admin.from('curriculum_concepts').insert({ id, manifest_id: man!.id, topic: 'Fixture', reading: 'Fixture', module: 'fx', los: 'fx', name: `Fixture ${status} ${tag}`, importance: 'core', lm_id: outcome!.reading_id, verification_status: status, scope_notes: 'fixture scope' })
    if (error) throw new Error(error.message)
    await admin.from('concept_outcome_map').insert({ concept_id: id, outcome_id: outcome!.id, approximate: false }); concepts.push(id); return id
  }
  const cOk = await concept('verified'), cNo = await concept('drafted')
  let n = 0
  const item = async (o: { st?: string; c?: string; held?: boolean; checks?: boolean } = {}) => {
    const id = `fxrv-${tag}-h${++n}`
    const { error } = await admin.from('assessment_items').insert({ id, lm_id: outcome!.reading_id, learning_objective: 'fx', verification_intent: 'fx', difficulty: 1, stem: `HTTP fixture ${id}: what follows when the assumption stated here holds?`, options: [`A ${id}`, `B ${id}`, `C ${id}`], per_option_feedback: { '0': 'Correct. fx', '1': 'Wrong fx', '2': 'Wrong fx' }, provenance: 'fixture', review_status: o.st ?? 'verified', concept_id: o.c ?? cOk, outcome_id: outcome!.id, key_index: 0, item_card: { solution: 'Worked solution that is long enough to count as one.', distractorDiagnoses: [] }, held_out: o.held ?? false })
    if (error) throw new Error(`${id}: ${error.message}`)
    items.push(id)
    if (o.checks !== false) await admin.from('item_validations').insert([{ item_id: id, reviewer_role: 'editorial_verifier', status: 'PASS', detail: { gate: 'editorial', detail: 'ok' }, item_version: 1 }, { item_id: id, reviewer_role: 'editorial_verifier', status: 'PASS', detail: { gate: 'verdict', detail: 'fixture' }, item_version: 1 }])
    return id
  }
  const good = await item(), unsigned = await item({ c: cNo }), race = await item(), edited = await item(), heldFx = await item(), verifiedOnly = await item()
  const dec = (s: any, id: string, body: object) => s.post(`/api/diagnostic/items/${encodeURIComponent(id)}/review`, body)

  console.log('\nStudents and anonymous callers are kept out')
  const anon = (await import('./lib/e2eSession')).createSession(admin, 'nobody@example.invalid')
  for (const p of ['/app/tests/review', `/app/tests/review/${good}`, '/app/tests/review/batches', '/app/tests/review/challenges', '/app/tests/review/preview', '/app/tests/manifest']) {
    const r = await anon.req(p); check(`anonymous ${p} goes to sign-in`, r.status >= 300 && r.status < 400 && /login/.test(loc(r)), `${r.status} ${loc(r)}`)
  }
  for (const p of ['/app/tests/review', `/app/tests/review/${good}`, `/app/tests/review/${good}/preview`, '/app/tests/review/preview', '/app/tests/review/batches', '/app/tests/review/challenges', '/app/tests/manifest']) {
    const r = await stu.s.req(p); const body = await r.text()
    check(`student ${p} gets an unavailable page`, r.status === 404 && body.includes('Page not found') && !body.includes('HTTP fixture') && !body.includes('Worked solution'), String(r.status))
  }
  for (const [path, body] of [[`/api/diagnostic/items/${good}/review`, { decision: 'approve', expectedVersion: 1 }], [`/api/diagnostic/items/${good}/edit`, { expectedVersion: 1, patch: { stem: 'x'.repeat(40) } }], [`/api/diagnostic/items/${good}/reverify`, {}], [`/api/diagnostic/items/${good}/family`, { action: 'holdout', held: true, reason: 'x y z' }]] as const) {
    const s = await stu.s.post(path, body), a = await anon.post(path, body)
    check(`student cannot call ${path.split('/').pop()}`, s.status === 403 && !JSON.stringify(s.body).includes('key') && a.status === 401, `${s.status}/${a.status} ${JSON.stringify(s.body).slice(0, 80)}`)
  }
  check('nothing changed after the student attempts', (await admin.from('assessment_items').select('review_status, held_out').eq('id', good).single()).data?.review_status === 'verified' && (await count('item_review_decisions', q => q.eq('item_id', good))) === 0)
  const tests = await (await stu.s.req('/app/tests')).text()
  check('the student Tests page carries no reviewer route, fixture question or key', !tests.includes('/app/tests/review') && !tests.includes('/app/tests/manifest') && !tests.includes('HTTP fixture'))

  console.log('\nQueue totals and filters')
  const q = await (await rev.s.req('/app/tests/review?state=verified')).text()
  const total = await count('assessment_items', x => x.eq('review_status', 'verified'))
  check('reviewer sees the queue', q.includes('Question review'))
  check('the matching total is the whole filtered set, not the first page', q.includes(`of ${total} matching item`) && total > 25, `expected "of ${total}"`)
  for (const [s, label] of [['draft', 'Draft'], ['verified', 'Automatically checked'], ['reviewed', 'Human reviewed'], ['deprecated', 'Retired']] as const) {
    const c = await count('assessment_items', x => x.eq('review_status', s))
    check(`state total "${label}" equals the database (${c})`, new RegExp(`<strong>${c}</strong><span>${label}</span>`).test(q.replace(/<!-- -->/g, '')))
  }
  const p2 = await (await rev.s.req('/app/tests/review?state=verified&page=2')).text()
  check('page 2 shows the next slice', p2.includes('Showing 26–50') && !p2.includes('Showing 1–25'))
  const { data: quantReadings } = await admin.from('curriculum_readings').select('id').eq('topic_id', 'fsa')
  const fsaVerified = await count('assessment_items', x => x.eq('review_status', 'verified').in('lm_id', (quantReadings ?? []).map(r => r.id)))
  const f = await (await rev.s.req('/app/tests/review?state=verified&topic=fsa')).text()
  check(`topic filter total matches (${fsaVerified})`, f.includes(`of ${fsaVerified} matching item`) || (fsaVerified === 0 && f.includes('No items match')))
  check('plain state words, no "gold" or "verifier-passed"', !/gold|verifier-passed/i.test(q))
  check('legacy items with no recorded decision are reported, not treated as approved', /marked <strong>Human reviewed<\/strong> but/.test(q) || /no recorded reviewer decision/.test(q))

  console.log('\nItem workspace, decision and links')
  const page = (await (await rev.s.req(`/app/tests/review/${good}`)).text()).replace(/<!-- -->/g, '')
  const wanted = ['Question', 'Key', 'Curriculum mapping', 'Automatic checks for version 1', 'Family and similar questions', 'Versions and history', 'Approve and publish']
  check('workspace shows item, key, mapping, checks, family, history and the decision', wanted.every(t => page.includes(t)), `missing: ${wanted.filter(t => !page.includes(t)).join(', ')}`)
  check('an item with all requirements shows no blockers', page.includes('Everything required to publish is in place'))
  const pu = (await (await rev.s.req(`/app/tests/review/${unsigned}`)).text()).replace(/<!-- -->/g, '')
  check('a blocked item names the reason', pu.includes('Publication is blocked') && pu.includes('signed off'))
  const links = [...new Set([...q.matchAll(/href="(\/app\/[^"#]+)"/g)].map(m => m[1].replace(/&amp;/g, '&')).concat([...page.matchAll(/href="(\/app\/[^"#]+)"/g)].map(m => m[1].replace(/&amp;/g, '&'))))].filter(h => !h.startsWith('/app/tests/review?') || true)
  let bad: string[] = []
  for (const h of links.slice(0, 40)) { const r = await rev.s.req(h); if (r.status >= 400) bad.push(`${h} ${r.status}`) }
  check(`every reviewer link on the queue and item pages resolves (${Math.min(links.length, 40)} checked)`, bad.length === 0, bad.join('; '))
  check('the challenge workflow link works', (await rev.s.req('/app/tests/review/challenges')).status === 200 && page.includes('/app/tests/review/challenges'))

  let r = await dec(rev.s, unsigned, { decision: 'approve', expectedVersion: 1 })
  check('approving an unsigned-concept item is refused with its reasons', r.status === 409 && r.body.code === 'BLOCKED' && JSON.stringify(r.body.blockers).includes('signed off'))
  r = await dec(rev.s, good, { decision: 'approve', expectedVersion: 1, note: 'checked' }); check('approve publishes', r.status === 200 && r.body.status === 'reviewed')
  r = await dec(rev.s, good, { decision: 'approve', expectedVersion: 1 }); check('a repeated approve is safe', r.status === 200 && r.body.repeated === true && (await count('item_review_decisions', x => x.eq('item_id', good))) === 1)
  r = await dec(rev.s, good, { decision: 'reject', expectedVersion: 1, note: 'nope' }); check('a conflicting decision is refused', r.status === 409)
  r = await dec(rev.s, race, { decision: 'approve' }); check('a decision without the version seen is refused', r.status === 400)
  const burst = await Promise.all(Array.from({ length: 6 }, (_, i) => dec(rev.s, race, { decision: i % 2 ? 'reject' : 'approve', expectedVersion: 1, note: 'burst' })))
  check('simultaneous opposing requests record one decision', (await count('item_review_decisions', x => x.eq('item_id', race))) === 1 && burst.every(b => b.status === 200 || b.status === 409), burst.map(b => b.status).join(','))

  console.log('\nEditing keeps published versions')
  await dec(rev.s, edited, { decision: 'approve', expectedVersion: 1, note: 'ok' })
  const before = (await admin.from('assessment_items').select('stem, key_index').eq('id', edited).single()).data!
  r = await rev.s.post(`/api/diagnostic/items/${edited}/edit`, { expectedVersion: 1, patch: { stem: 'A different question that changes what is being asked in a material way', key_index: 2 }, note: 'fix' })
  check('editing a published item makes a new candidate version', r.status === 200 && r.body.mode === 'new_version'); if (r.body.itemId) items.push(r.body.itemId)
  const after = (await admin.from('assessment_items').select('stem, key_index, review_status').eq('id', edited).single()).data!
  check('the published version is unchanged and still human reviewed', after.stem === before.stem && after.key_index === before.key_index && after.review_status === 'reviewed')
  check('the new version page shows the history chain', (await (await rev.s.req(`/app/tests/review/${r.body.itemId}`)).text()).includes(edited))

  console.log('\nPreview cannot write student records')
  const tables = ['assessment_attempts', 'assessment_responses', 'evidence_events', 'plan_blocks', 'repair_threads', 'task_events', 'form_items', 'item_review_decisions']
  const b0 = await Promise.all(tables.map(t => count(t)))
  for (const p of [`/app/tests/review/${verifiedOnly}/preview`, '/app/tests/review/preview?go=1&state=verified&n=10']) { const rr = await rev.s.req(p); const html = await rr.text(); check(`preview ${p.split('?')[0].split('/').slice(-1)[0]} renders with the draft label`, rr.status === 200 && html.includes('nothing here is saved')) }
  const b1 = await Promise.all(tables.map(t => count(t)))
  check('no response, evidence, progress, repair, task or paper row was created', JSON.stringify(b0) === JSON.stringify(b1), `${JSON.stringify(b0)} vs ${JSON.stringify(b1)}`)
  check('the preview component makes no network calls at all', !/fetch\(|XMLHttpRequest|sendBeacon/.test(readFileSync('src/components/reviewer/DraftPreview.tsx', 'utf8')))

  console.log('\nOnly reviewed, un-held items reach students')
  await dec(rev.s, heldFx, { decision: 'approve', expectedVersion: 1, note: 'ok' })
  const hold = await rev.s.post(`/api/diagnostic/items/${heldFx}/family`, { action: 'holdout', held: true, reason: 'reserved for mock A' })
  check('a reviewer can hold an item out', hold.status === 200 && (await admin.from('assessment_items').select('held_out').eq('id', heldFx).single()).data?.held_out === true)
  const pool = (await loadEligibleItemPool(stu.id, [outcome!.reading_id], 'weekly_cumulative')).map(p => p.id)
  check('the approved fixture is eligible', pool.includes(good))
  check('an automatically checked item is not', !pool.includes(verifiedOnly) && !pool.includes(unsigned))
  check('a held-out reviewed item is not', !pool.includes(heldFx))
  const rel = await rev.s.post(`/api/diagnostic/items/${heldFx}/family`, { action: 'holdout', held: false })
  check('releasing the hold-out makes it eligible again', rel.status === 200 && (await loadEligibleItemPool(stu.id, [outcome!.reading_id], 'weekly_cumulative')).some(p => p.id === heldFx))
  const grp = await rev.s.post(`/api/diagnostic/items/${good}/family`, { action: 'group', withItemIds: [race, 'does-not-exist'] })
  check('grouping with a missing item is refused', grp.status === 404)
}

main().catch(e => { console.error(e); process.exitCode = 1 }).finally(async () => {
  // Delete by recorded id. Items first (versions reference earlier versions in one statement), then concepts and users.
  await admin.from('assessment_items').delete().in('id', items)
  await admin.from('curriculum_concepts').delete().in('id', concepts)
  await admin.from('user_roles').delete().in('user_id', users)
  for (const id of users) await admin.auth.admin.deleteUser(id).catch(() => {})
  finish()
})
