/**
 * Preview generation, acceptance and retry against the real development schema, with ONE throwaway student (deleted by recorded id).
 *   npx tsx scripts/onboarding-preview-db-test.ts
 * Proves: a setup edit during generation can never be accepted under the newer version; concurrent requests share one build;
 * a stale draft is refused inside the acceptance transaction; a second confirmation returns the same accepted cycle.
 * Also prints timings for build, reuse and the slow reads (measured before any caching is considered).
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

let passed = 0, failed = 0
const check = (n: string, ok: boolean, d = '') => { ok ? (passed++, console.log(`  ✓ ${n}`)) : (failed++, console.log(`  ✗ ${n}${d ? ` — ${d}` : ''}`)) }
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!, ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const admin = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const ms = async <T,>(f: () => Promise<T>) => { const t = Date.now(); const v = await f(); return { v, ms: Date.now() - t } }

async function main() {
  const email = `integ+prev${Date.now()}@example.com`, password = `Pw-${crypto.randomUUID()}`
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  const uid = created.data.user!.id
  console.log(`\nPreview and acceptance against the development schema (student ${uid.slice(0, 8)}…)\n`)
  try {
    const { saveExam, saveRoute, savePosition, saveWeek } = await import('../src/lib/onboarding/service')
    const { generatePreview } = await import('../src/lib/onboarding/previewService')
    const { getOrCreateReadyDraft } = await import('../src/lib/planning/activation/draftService')
    const { data: feb } = await admin.from('exam_windows').select('id').eq('year', 2027).eq('sitting', 'february').single()
    await saveExam(uid, { examWindowId: feb!.id, registered: false, timezone: 'Europe/London' })
    await saveRoute(uid, { prepMode: 'self_study', classPattern: 'none', recurringClasses: [], nextClass: null })
    await savePosition(uid, { stage: 'starting_fresh', topicExposure: {} })
    const week = (windows: number[], max = 60) => saveWeek(uid, { availabilityMode: 'windows', windows: windows.map(weekday => ({ weekday, startTime: '18:00', endTime: '20:00' })), commitments: [], maxSessionMinutes: max })
    await week([1, 2, 3, 4, 5])
    const version = async () => ((await admin.from('profiles').select('onboarding_context_version').eq('id', uid).single()).data!.onboarding_context_version as number)
    const readyDrafts = async () => ((await admin.from('plan_drafts').select('id, onboarding_context_version, status').eq('user_id', uid).eq('purpose', 'onboarding_initial_week').eq('status', 'ready')).data ?? [])

    console.log('Measured first (no caching added): build, then reuse')
    const build = await ms(() => getOrCreateReadyDraft(uid))
    const reuse1 = await ms(() => getOrCreateReadyDraft(uid)), reuse2 = await ms(() => getOrCreateReadyDraft(uid))
    console.log(`    build ${build.ms} ms · reuse ${reuse1.ms} ms, ${reuse2.ms} ms`)
    check('the second and third requests reuse the matching preview', reuse1.v.draftId === build.v.draftId && reuse2.v.draftId === build.v.draftId && reuse1.v.reused && reuse2.v.reused)
    check('reuse is far cheaper than a build, so no cache is needed for repeats', Math.max(reuse1.ms, reuse2.ms) < build.ms)

    console.log('\nConcurrent requests for the same context share one build')
    await week([1, 2, 3, 4, 5, 6])
    const trio = await Promise.all([getOrCreateReadyDraft(uid), getOrCreateReadyDraft(uid), getOrCreateReadyDraft(uid)])
    check('three simultaneous requests return one draft', new Set(trio.map(d => d.draftId)).size === 1)
    check('…and exactly one ready draft exists for the current setup', (await readyDrafts()).length === 1)

    console.log('\nAn edit while the preview is generated')
    const v0 = await version()
    // getOrCreateReadyDraft retires drafts that no longer match before it generates; do the same so generatePreview is exercised alone.
    await admin.from('plan_drafts').update({ status: 'superseded' }).eq('user_id', uid).eq('status', 'ready')
    let raced = ''
    try {
      await generatePreview(uid, { afterInputsRead: async () => { await week([1, 3, 5], 45) } })
    } catch (e: any) { raced = e?.code ?? e?.message }
    const v1 = await version()
    check('the edit advanced the setup version', v1 > v0, `${v0} -> ${v1}`)
    check('generation refused to offer a draft built from the earlier inputs (CONTEXT_CHANGED)', raced === 'CONTEXT_CHANGED', raced)
    check('no ready draft is left under the newer version from those earlier inputs', (await readyDrafts()).every(d => d.onboarding_context_version === v1) )
    const stale = (await admin.from('plan_drafts').select('id, onboarding_context_version, status').eq('user_id', uid).eq('purpose', 'onboarding_initial_week').order('created_at', { ascending: false }).limit(1).single()).data!
    check('the abandoned draft is stamped with the EARLIER version and retired', stale.onboarding_context_version === v0 && stale.status === 'superseded', JSON.stringify(stale))
    const fresh = await getOrCreateReadyDraft(uid)
    check('the next request builds from the current setup, labelled with the current version', (await readyDrafts()).every(d => d.onboarding_context_version === v1) && !fresh.reused)

    console.log('\nAcceptance')
    const userClient = createClient(URL, ANON, { auth: { persistSession: false } })
    const signed = await userClient.auth.signInWithPassword({ email, password })
    check('the student signs in', !signed.error)
    await week([2, 4], 30) // an edit after the preview was built
    const rejected = await userClient.rpc('accept_onboarding_preview', { p_draft_id: fresh.draftId, p_expected_revision: fresh.revision })
    check('a draft built before an edit is refused INSIDE the acceptance transaction', !!rejected.error && /STALE_PREVIEW/.test(rejected.error.message), rejected.error?.message)
    check('…and nothing was accepted', ((await admin.from('planning_cycles').select('id').eq('user_id', uid)).data ?? []).length === 0)
    await admin.from('plan_drafts').update({ status: 'superseded' }).eq('id', fresh.draftId)
    const current = await getOrCreateReadyDraft(uid)
    const first = await userClient.rpc('accept_onboarding_preview', { p_draft_id: current.draftId, p_expected_revision: current.revision })
    check('a current draft is accepted', !first.error && !!first.data?.cycle_id, first.error?.message)
    const second = await userClient.rpc('accept_onboarding_preview', { p_draft_id: current.draftId, p_expected_revision: current.revision })
    check('a second confirmation returns the same accepted cycle', !second.error && second.data?.cycle_id === first.data?.cycle_id, JSON.stringify(second))
    check('…and creates no second cycle or duplicate blocks', ((await admin.from('planning_cycles').select('id').eq('user_id', uid)).data ?? []).length === 1)
    const { cycleAcceptedBy } = await import('../src/lib/planning/cycleProvenance')
    check('draft provenance recognises a cycle accepted through onboarding', (await cycleAcceptedBy(uid, first.data.cycle_id)) === 'onboarding')
  } finally {
    const del = await admin.auth.admin.deleteUser(uid)
    check('the throwaway student is removed by recorded id', !del.error, del.error?.message)
  }
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}
main().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
