/**
 * The LOS readiness tracker reacts to real diagnostic evidence.
 *
 *   npm run dev
 *   npx tsx scripts/e2e-readiness.ts
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)
import { getE2EEmail, verifyAndGetE2EUser, resetE2EUser, assertBlankOnboarding, E2E_BASE_URL } from './lib/e2eIdentity'
import { createSession, completeOnboarding, makeCheck } from './lib/e2eSession'

const { check, finish } = makeCheck()
import { declareBank } from './lib/bankMode'
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

async function main() {
  await declareBank(admin, 'e2e-readiness', ['r028'])
  const s = createSession(admin, getE2EEmail())
  check('signed in', await s.signIn())
  const uid = await verifyAndGetE2EUser(admin)
  await resetE2EUser(admin, uid)
  await assertBlankOnboarding(admin, uid)
  await completeOnboarding(s, admin)

  console.log('\nBefore any evidence')
  const noAuth = await fetch(`${E2E_BASE_URL}/api/curriculum/readiness`)
  check('the readiness API requires authentication', noAuth.status === 401)
  const before = await s.json('/api/curriculum/readiness')
  const t0 = before.body?.tracker
  check('the tracker loads', before.body?.ok === true && !!t0, JSON.stringify(before.body).slice(0, 150))
  check('nothing is classified as Maintain without evidence', t0?.totals.maintain === 0 && t0?.totals.repair === 0 && t0?.totals.verify === 0)
  check('every tracked outcome is Untested', t0?.totals.untested === t0?.totals.total && t0?.totals.total > 0, JSON.stringify(t0?.totals))
  check('the list is the full 2027 syllabus, with honest depth', t0?.depth.readings === 102 && t0?.depth.trackedReadings === 102 && t0?.depth.outcomes === 343 && t0?.depth.withEvidence === 0, JSON.stringify(t0?.depth))
  const pageBefore = await s.req('/app/curriculum?view=readiness')
  const htmlBefore = await pageBefore.text()
  check('Curriculum renders the readiness view by default', pageBefore.status === 200 && htmlBefore.includes('Readiness'))
  check('and says nothing is classified yet', htmlBefore.includes('Nothing is classified yet'))
  check('it never shows a readiness percentage or pass probability', !/pass probability|readiness score|\d+%\s*ready/i.test(htmlBefore))

  console.log('\nAfter a diagnostic answered wrong with high confidence')
  const start = await s.post('/api/tests/start', { kind: 'reading', readingId: 'r028', baseline: true })
  check('an attempt starts', start.body?.ok === true, JSON.stringify(start.body))
  const attemptId = start.body.attemptId
  for (let i = 0; i < 30; i++) {
    const next = await s.json(`/api/diagnostic/attempt/${attemptId}`)
    const item = next.body?.nextItem
    if (!item) break
    const { data: k } = await admin.from('assessment_items').select('key_index').eq('id', item.id).maybeSingle()
    await s.post(`/api/diagnostic/attempt/${attemptId}/response`, {
      itemId: item.id, selectedOptionIndex: ((k?.key_index ?? 0) + 1) % item.options.length, confidence: 'high',
    })
  }
  const submit = await s.post(`/api/diagnostic/attempt/${attemptId}/submit`)
  check('it scores', submit.body?.ok === true, JSON.stringify(submit.body).slice(0, 150))

  const after = await s.json('/api/curriculum/readiness')
  const t1 = after.body?.tracker
  check('the same outcomes now read as Repair, live, with no refresh step', (t1?.totals.repair ?? 0) > 0, JSON.stringify(t1?.totals))
  check('Repair rows lead the study order', t1?.studyOrder?.[0]?.band === 'repair')
  check('a Repair row carries the method and its proof of mastery',
    /12/.test(t1?.studyOrder?.[0]?.questionRange ?? '') && /next-day retest/.test(t1?.studyOrder?.[0]?.proof ?? ''))
  check('a repair with no task planned reads as Not started, not as done', t1?.studyOrder?.[0]?.progress === 'not_started', t1?.studyOrder?.[0]?.progress)
  check('untested outcomes elsewhere are left untested', (t1?.totals.untested ?? 0) >= 0 && t1?.totals.total === t0?.totals.total)

  const html = await (await s.req('/app/curriculum?view=readiness')).text()
  check('the page shows the Repair band and the working order', html.includes('Repair') && html.includes('Work in this order'))
  check('the page names the concept to address', (t1?.studyOrder ?? []).slice(0, 1).every((r: any) => html.includes(r.name.slice(0, 20).replace(/&/g, '&amp;'))))
  const repairOutcomes = (t1?.studyOrder ?? []).filter((r: any) => r.band === 'repair')
  check('evidence lands on mapped 2027 outcomes (FSA readings 27-29 and 33)', repairOutcomes.length > 0 && repairOutcomes.every((r: any) => /^r0(27|28|29|33)-/.test(r.outcomeId)), JSON.stringify(repairOutcomes.map((r: any) => r.outcomeId)))
  const target = repairOutcomes[0]
  const readingHtml = await (await s.req(`/app/curriculum/fsa/${target?.readingId}`)).text()
  check('the reading page shows that outcome as Repair', readingHtml.includes('Repair'))
  const subjectHtml = await (await s.req('/app/curriculum/fsa')).text()
  check('the subject page shows the reading with its Repair count', /\d+ Repair/.test(subjectHtml))
  const overviewHtml = await (await s.req('/app/curriculum')).text()
  check('the overview shows the subject band mix', /\d+ Repair/.test(overviewHtml))
  const untestedElsewhere = (t1?.topics ?? []).filter((t: any) => t.id !== 'fsa').every((t: any) => t.counts.repair + t.counts.verify + t.counts.maintain === 0)
  check('other subjects stay untested', untestedElsewhere)
  const filtered = await s.req('/app/curriculum?view=readiness&band=repair')
  check('the band filter renders', filtered.status === 200)
  const roadmapView = await s.req('/app/curriculum?view=roadmap')
  check('the PrepPlan view still renders', roadmapView.status === 200)

  finish()
}
main().catch(e => { console.error(e); process.exit(1) })
