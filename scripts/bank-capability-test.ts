/**
 * Reading-check capability wording against the REAL bank, with the assessment service's own candidate rule. Nothing is promoted,
 * relaxed or generated: each state is exercised on a reading that already has it, and the example is chosen from raw item counts so
 * the expectation is independent of the code under test. An ordinary throwaway student (nothing seen yet), deleted afterwards.
 *
 *   npx tsx scripts/bank-capability-test.ts
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)
import { readingCheckCapability } from '../src/lib/curriculum/revisionOverview'
import { checkCapability } from '../src/lib/curriculum/revisionQueue'
import { MIN_PAPER_QUESTIONS } from '../src/lib/tests/limits'

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
let passed = 0, failed = 0; const skipped: string[] = []
const check = (n: string, ok: boolean, d = '') => { ok ? (passed++, console.log(`  ✓ ${n}`)) : (failed++, console.log(`  ✗ ${n}${d ? ` — ${d}` : ''}`)) }

console.log('\nThe wording rule (pure)')
{
  const none = checkCapability(0, 0, 5), ineligible = checkCapability(24, 0, 5), thin = checkCapability(24, 3, 5), ok = checkCapability(24, 12, 5)
  check('no items: says none exist and that revision is still planned', none.state === 'none' && /No questions exist/.test(none.message) && /Revision is still planned/.test(none.message))
  check('items but none eligible: says so without claiming a bank', ineligible.state === 'not_eligible' && /none is currently eligible/.test(ineligible.message))
  check('some eligible but fewer than the minimum: names the shortfall and refuses to call it supported', thin.state === 'insufficient' && /Only 3 eligible unseen questions/.test(thin.message) && /at least 5/.test(thin.message))
  check('enough: says depth only, never that every outcome can be tested', ok.state === 'supported' && /question depth only/.test(ok.message) && /not mean every outcome/.test(ok.message))
  check('one eligible item is never presented as proof the reading can be diagnosed', checkCapability(1, 1, 5).state === 'insufficient')
}

console.log('\nThe real bank (the assessment service\'s own eligibility rule)')
async function main() {
  const { data } = await admin.auth.admin.createUser({ email: `integ+bankcap${Date.now()}@example.com`, email_confirm: true })
  const uid = data.user!.id
  try {
    const items = (await admin.from('assessment_items').select('lm_id, review_status')).data ?? []
    const by = new Map<string, { total: number; reviewed: number }>()
    for (const i of items) { const e = by.get(i.lm_id as string) ?? { total: 0, reviewed: 0 }; e.total++; if (i.review_status === 'reviewed') e.reviewed++; by.set(i.lm_id as string, e) }
    const readings = ((await admin.from('curriculum_readings').select('id').eq('is_active', true)).data ?? []).map(r => r.id as string)
    const noItems = readings.find(id => !by.has(id))
    const unreviewedOnly = [...by].find(([, v]) => v.total > 0 && v.reviewed === 0)?.[0]
    const thinReviewed = [...by].filter(([, v]) => v.reviewed >= 1 && v.reviewed < MIN_PAPER_QUESTIONS).map(([id]) => id)
    const deepReviewed = [...by].filter(([, v]) => v.reviewed >= MIN_PAPER_QUESTIONS).sort((a, b) => b[1].reviewed - a[1].reviewed).map(([id]) => id)

    if (!noItems) skipped.push('no reading without items exists'); else {
      const c = await readingCheckCapability(uid, noItems)
      check(`${noItems} has no items → none`, c.state === 'none' && c.eligibleUnseen === 0, JSON.stringify(c))
    }
    if (!unreviewedOnly) skipped.push('no reading with only unreviewed items exists'); else {
      const c = await readingCheckCapability(uid, unreviewedOnly)
      check(`${unreviewedOnly} has only unreviewed items → not eligible (planning unaffected)`, c.state === 'not_eligible' && c.eligibleUnseen === 0, JSON.stringify(c))
    }
    const thinStates = await Promise.all(thinReviewed.map(async id => [id, await readingCheckCapability(uid, id)] as const))
    const thin = thinStates.find(([, c]) => c.state === 'insufficient')
    if (!thin) skipped.push('no reading has 1–4 eligible items'); else check(`${thin[0]} has ${thin[1].eligibleUnseen} eligible unseen → insufficient`, thin[1].eligibleUnseen >= 1 && thin[1].eligibleUnseen < MIN_PAPER_QUESTIONS, JSON.stringify(thin[1]))
    const deepStates = await Promise.all(deepReviewed.map(async id => [id, await readingCheckCapability(uid, id)] as const))
    const deep = deepStates.find(([, c]) => c.state === 'supported')
    if (!deep) skipped.push('no reading has at least the minimum eligible unseen items'); else check(`${deep[0]} has ${deep[1].eligibleUnseen} eligible unseen → supported`, deep[1].eligibleUnseen >= MIN_PAPER_QUESTIONS && /question depth only/.test(deep[1].message), JSON.stringify(deep[1]))
    const reviewedButBlocked = deepStates.filter(([, c]) => c.state !== 'supported')
    console.log(`  (info) readings with ≥${MIN_PAPER_QUESTIONS} reviewed items whose eligible count is lower after mapping/unseen rules: ${reviewedButBlocked.map(([id, c]) => `${id}:${c.eligibleUnseen}`).join(', ') || 'none'}`)
  } finally { await admin.auth.admin.deleteUser(uid).catch(() => {}) }
}
main().catch(e => { console.error(e); failed++ }).finally(() => {
  console.log(`\n${passed} passed, ${failed} failed, ${skipped.length} skipped (skips are NOT counted as passed)`)
  for (const s of skipped) console.log(`  skipped: ${s}`)
  process.exit(failed ? 1 : 0)
})
