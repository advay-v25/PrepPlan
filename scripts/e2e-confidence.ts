/**
 * Confidence engine live: marks, evidence verdicts, verification of the student's mark,
 * manual overrides behind a warning. Dedicated +e2e account only.
 *
 *   npm run dev
 *   npx tsx scripts/e2e-confidence.ts
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)
import { getE2EEmail, verifyAndGetE2EUser, resetE2EUser, assertBlankOnboarding, E2E_BASE_URL } from '../src/lib/testing/e2eIdentity'
import { createSession, completeOnboarding, makeCheck } from './lib/e2eSession'

const { check, finish } = makeCheck()
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const MANIFEST_ID = '11111111-1111-1111-1111-111111111111'

async function tracker(s: ReturnType<typeof createSession>) {
  const t = (await s.json('/api/curriculum/readiness')).body?.tracker
  const rows = (t?.topics ?? []).flatMap((x: any) => x.modules.flatMap((m: any) => m.rows))
  return { t, rows, mods: (t?.topics ?? []).flatMap((x: any) => x.modules) }
}

async function main() {
  console.log('\nConfidence engine\n')
  const s = createSession(admin, getE2EEmail())
  check('signed in', await s.signIn())
  const uid = await verifyAndGetE2EUser(admin)
  await resetE2EUser(admin, uid)
  await assertBlankOnboarding(admin, uid)
  await completeOnboarding(s, admin)
  await admin.from('confidence_marks').delete().eq('user_id', uid)
  await admin.from('evidence_overrides').delete().eq('user_id', uid)

  // --- auth, method and input guards
  const post = (p: string, b: unknown) => fetch(`${E2E_BASE_URL}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })
  check('marks require authentication', (await post('/api/curriculum/marks', { scopeType: 'outcome', scopeId: 'r028-a', level: 'solid' })).status === 401)
  check('overrides require authentication', (await post('/api/curriculum/overrides', { action: 'revoke', outcomeId: 'r028-a' })).status === 401)
  check('marks are POST only', (await s.req('/api/curriculum/marks')).status === 405)
  check('overrides are POST only', (await s.req('/api/curriculum/overrides')).status === 405)
  check('an unknown mark level is refused', (await s.post('/api/curriculum/marks', { scopeType: 'outcome', scopeId: 'r028-a', level: 'brilliant' })).status === 400)
  check('an unknown outcome is a 404', (await s.post('/api/curriculum/marks', { scopeType: 'outcome', scopeId: 'nope', level: 'solid' })).status === 404)
  // Ethics gained real structure this session, so there is no longer a structure-pending reading to exercise
  // this against; 'an unknown outcome is a 404' above covers the same not-found guard.
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
  check('the tables are not writable without a session (RLS)', (await anon.from('confidence_marks').insert({ user_id: uid, scope_type: 'outcome', scope_id: 'r028-a', level: 'solid' })).error !== null)

  // --- marks
  const before = await tracker(s)
  const totals0 = JSON.stringify(before.t.totals)
  check('outcomes start unmarked with no evidence', before.rows.every((r: any) => r.selfMark === null && r.verdict === 'none'))
  const m1 = await s.post('/api/curriculum/marks', { scopeType: 'outcome', scopeId: 'r028-a', level: 'solid' })
  const m2 = await s.post('/api/curriculum/marks', { scopeType: 'outcome', scopeId: 'r028-b', level: 'shaky' })
  const m3 = await s.post('/api/curriculum/marks', { scopeType: 'reading', scopeId: 'r028', level: 'fairly_sure' })
  check('marks save', m1.body?.ok && m2.body?.ok && m3.body?.ok)
  const after1 = await tracker(s)
  const a = after1.rows.find((r: any) => r.outcomeId === 'r028-a')
  check('a mark with no evidence is "not enough evidence", never verified', a.selfMark === 'solid' && a.markCheck === 'unassessed')
  check('marking never changes the band or the counts', JSON.stringify(after1.t.totals) === totals0 && a.band === 'untested')
  await s.post('/api/curriculum/marks', { scopeType: 'outcome', scopeId: 'r028-a', level: 'shaky' })
  check('a mark can be changed, one row per outcome', ((await admin.from('confidence_marks').select('*').eq('user_id', uid).eq('scope_id', 'r028-a')).data ?? []).length === 1
    && (await tracker(s)).rows.find((r: any) => r.outcomeId === 'r028-a').selfMark === 'shaky')
  await s.post('/api/curriculum/marks', { scopeType: 'outcome', scopeId: 'r028-a', level: 'solid' })

  // --- evidence: very confident and wrong -> concept miss
  // Scoped to r028: this suite's marks and assertions are all about that one reading's outcomes, and an
  // unscoped diagnostic now draws from the whole FSA bank (built later this session) rather than
  // concentrating on r028 the way it did when r028 was effectively the only reading with any items.
  const start = await s.post('/api/diagnostic/attempt', { manifestId: MANIFEST_ID, purpose: 'module_diagnostic', constraints: { maxQuestions: 6 }, requestedScope: { modules: ['r028'] } })
  check('a diagnostic starts', start.body?.ok === true)
  for (let i = 0; i < 30; i++) {
    const next = await s.json(`/api/diagnostic/attempt/${start.body.attemptId}`)
    const item = next.body?.nextItem
    if (!item) break
    const { data: k } = await admin.from('assessment_items').select('key_index').eq('id', item.id).maybeSingle()
    await s.post(`/api/diagnostic/attempt/${start.body.attemptId}/response`, { itemId: item.id, selectedOptionIndex: ((k?.key_index ?? 0) + 1) % item.options.length, confidence: 'high' })
  }
  check('it scores', (await s.post(`/api/diagnostic/attempt/${start.body.attemptId}/submit`)).body?.ok === true)

  const after2 = await tracker(s)
  const withEvidence = after2.rows.filter((r: any) => r.verdict !== 'none')
  check('sure-and-wrong answers read as concept misses', withEvidence.length > 0 && withEvidence.every((r: any) => r.verdict === 'concept_miss'), JSON.stringify(withEvidence.map((r: any) => r.verdict)))
  check('a concept miss is a Repair with the misconception reason', withEvidence.every((r: any) => r.band === 'repair' && /sure and wrong/i.test(r.rationale)))
  const aa = after2.rows.find((r: any) => r.outcomeId === 'r028-a')
  const bb = after2.rows.find((r: any) => r.outcomeId === 'r028-b')
  if (aa.verdict !== 'none') check('marked Solid + concept miss = overconfident, onto the revision list', aa.markCheck === 'overconfident' && aa.needsRevision === true, JSON.stringify([aa.markCheck, aa.needsRevision]))
  if (bb.verdict !== 'none') check('marked Shaky + concept miss = the student knew; no revision penalty', bb.markCheck === 'verified' && bb.needsRevision === false, JSON.stringify([bb.markCheck, bb.needsRevision]))
  const mod = after2.mods.find((m: any) => m.id === 'r028')
  check('the reading-level mark is checked against its outcomes', mod.selfMark === 'fairly_sure' && ['overconfident', 'unassessed', 'verified'].includes(mod.markCheck) && mod.verdict !== 'none', JSON.stringify([mod.markCheck, mod.verdict]))

  // --- manual override behind a warning
  const target = withEvidence[0]
  const noAck = await s.post('/api/curriculum/overrides', { action: 'set', outcomeId: target.outcomeId, band: 'maintain', reason: 'I know this now' })
  check('a manual change without acknowledging the warning is refused', noAck.status === 409 && noAck.body?.code === 'warning_required', JSON.stringify(noAck.body))
  check('a manual change needs a reason', (await s.post('/api/curriculum/overrides', { action: 'set', outcomeId: target.outcomeId, band: 'maintain', reason: ' ', acknowledged: true })).status === 400)
  check('an invalid band is refused', (await s.post('/api/curriculum/overrides', { action: 'set', outcomeId: target.outcomeId, band: 'genius', reason: 'x y z', acknowledged: true })).status === 400)
  const totalsBefore = JSON.stringify((await tracker(s)).t.totals)
  const set = await s.post('/api/curriculum/overrides', { action: 'set', outcomeId: target.outcomeId, band: 'maintain', reason: 'Revised it and I know it now', acknowledged: true })
  check('with the warning acknowledged it is saved', set.body?.ok === true, JSON.stringify(set.body))
  const t3 = await tracker(s)
  const ov = t3.rows.find((r: any) => r.outcomeId === target.outcomeId)
  check('it is tagged manual with the student\'s reason', ov.override?.band === 'maintain' && /know it now/.test(ov.override.reason))
  check('the evidence band and the counts are unchanged by it', ov.band === 'repair' && JSON.stringify(t3.t.totals) === totalsBefore)
  const page = await (await s.req(`/app/curriculum/fsa/${target.readingId}`)).text()
  check('the reading page shows the manual change beside the evidence', page.includes('Manual change') && page.includes('The evidence is unchanged'))
  check('the reading page offers the reading-level mark and its check', page.includes('How confident are you in this reading?'))
  await s.post('/api/curriculum/overrides', { action: 'set', outcomeId: target.outcomeId, band: 'verify', reason: 'Actually still shaky', acknowledged: true })
  check('only one manual change is active per outcome', ((await admin.from('evidence_overrides').select('id').eq('user_id', uid).eq('outcome_id', target.outcomeId).is('revoked_at', null)).data ?? []).length === 1)
  check('the earlier change is kept for the record, not deleted', ((await admin.from('evidence_overrides').select('id').eq('user_id', uid).eq('outcome_id', target.outcomeId)).data ?? []).length === 2)
  check('it can be removed', (await s.post('/api/curriculum/overrides', { action: 'revoke', outcomeId: target.outcomeId })).body?.ok === true
    && (await tracker(s)).rows.find((r: any) => r.outcomeId === target.outcomeId).override === null)

  await admin.from('confidence_marks').delete().eq('user_id', uid)
  await admin.from('evidence_overrides').delete().eq('user_id', uid)
  finish()
}
main().catch(e => { console.error(e); process.exit(1) })
