import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)
import { createAdminClient } from '../src/lib/supabase/admin'
import {
  REHEARSAL_BLUEPRINT_VERSION,
  SESSION_MINUTES,
  SESSION_QUESTIONS,
  SESSION_TOPICS,
  planRehearsal,
  rehearsalAllocations,
  type RehearsalItem,
  type TopicWeight,
} from '../src/lib/rehearsal/blueprint'
import { getCapacityReport } from '../src/lib/tests/capacityReport'

async function main() {
  const db = createAdminClient()
  const { data: topics, error } = await db
    .from('topics')
    .select('id, name, exam_weight_min, exam_weight_max')
    .order('id')
  if (error || !topics?.length) {
    const message = error?.message ?? 'No topic weights were returned.'
    console.log(`Live rehearsal inventory: UNAVAILABLE (${message})`)
    process.exitCode = 1
    return
  }

  const weights: TopicWeight[] = topics.map(t => ({
    id: t.id as string,
    min: Number(t.exam_weight_min),
    max: Number(t.exam_weight_max),
  }))
  const [s1Alloc, s2Alloc] = rehearsalAllocations(weights)
  const totalS1 = Object.values(s1Alloc).reduce((a, b) => a + b, 0)
  const totalS2 = Object.values(s2Alloc).reduce((a, b) => a + b, 0)
  assert.equal(totalS1, SESSION_QUESTIONS)
  assert.equal(totalS2, SESSION_QUESTIONS)

  // Canonical live held-out capacity (never hardcoded to zero)
  let liveStatus: 'AVAILABLE' | 'UNAVAILABLE' = 'UNAVAILABLE'
  let liveError: string | null = null
  let report: Awaited<ReturnType<typeof getCapacityReport>> | null = null
  try {
    report = await getCapacityReport()
    liveStatus = 'AVAILABLE'
  } catch (e: any) {
    liveError = String(e?.message ?? e)
  }

  const byTopicReport = new Map((report?.topics ?? []).map(t => [t.id, t]))
  const matrix = [
    ...SESSION_TOPICS[0].map(id => ({ session: 1, id, wanted: s1Alloc[id] })),
    ...SESSION_TOPICS[1].map(id => ({ session: 2, id, wanted: s2Alloc[id] })),
  ].map(row => {
    const t = byTopicReport.get(row.id)
    const name = (topics.find(x => x.id === row.id)?.name as string) ?? row.id
    const approvedHeldOut = t?.approvedHeldOut ?? null
    const approvedHeldOutFamilies = t?.familiesHeldOut ?? null
    return {
      session: row.session,
      topicId: row.id,
      topicName: name,
      requiredFamilies: row.wanted,
      draftedHeldOut: null,
      approvedHeldOut,
      approvedHeldOutFamilies,
      perStudentFreshFamilies: null,
      minimumAdditionalApprovedFamilies: approvedHeldOutFamilies === null ? null : Math.max(0, row.wanted - approvedHeldOutFamilies),
    }
  })

  // Pure blueprint contract checks:
  // 1. Complete 180-family fixture set
  const completePool: RehearsalItem[] = matrix.flatMap(m =>
    Array.from({ length: m.requiredFamilies }, (_, idx) => ({
      id: `ho-${m.topicId}-${idx}`,
      lm_id: `r-${m.topicId}-${idx % 3}`,
      outcome_id: `o-${m.topicId}-${idx}`,
      concept_id: `c-${m.topicId}-${idx}`,
      intended_difficulty: 'standard',
      cognition: 'apply',
      item_form: 'scenario',
      key_index: idx % 3,
      family_id: `fam-ho-${m.topicId}-${idx}`,
      item_version: 1,
      level: 'standard',
      topic_id: m.topicId,
    }))
  )
  const okPlan = planRehearsal(completePool, weights, () => 0.25)
  assert.equal(okPlan.ready, true)
  assert.equal(okPlan.sessions[0].length, 90)
  assert.equal(okPlan.sessions[1].length, 90)
  assert.equal(okPlan.shortfalls[0].length, 0)
  assert.equal(okPlan.shortfalls[1].length, 0)

  // 2. One-topic-short fixture set (fsa 3 short)
  const shortPool = completePool.filter(i => !(i.topic_id === 'fsa' && Number(i.id.split('-').pop()) < 3))
  const shortPlan = planRehearsal(shortPool, weights, () => 0.25)
  assert.equal(shortPlan.ready, false)
  assert.equal(shortPlan.shortfalls[0].find(s => s.topicId === 'fsa')?.deliverable, s1Alloc.fsa - 3)
  assert.equal(shortPlan.shortfalls[1].length, 0)

  // 3. Family-overlap fixture set (same family_id across 2 topics in S1 and S2 -> cannot reuse family)
  const overlapPool = completePool.map(i =>
    i.id === 'ho-eq-0' ? { ...i, family_id: 'fam-ho-eth-0' } : i
  )
  const overlapPlan = planRehearsal(overlapPool, weights, () => 0.25)
  assert.equal(overlapPlan.ready, false)
  assert.ok(overlapPlan.shortfalls[1].some(s => s.topicId === 'eq' && s.deliverable === s2Alloc.eq - 1))

  const fullRehearsalsDeliverable = report?.serving.mock.fullMocksServable ?? null
  console.log(`Rehearsal blueprint ${REHEARSAL_BLUEPRINT_VERSION}: S1=${totalS1}q (${SESSION_MINUTES}m), S2=${totalS2}q (${SESSION_MINUTES}m)`)
  console.log(`Bank-wide full rehearsal capacity upper bound: ${fullRehearsalsDeliverable ?? 'UNAVAILABLE'} (liveInventory=${liveStatus})`)
  console.log('Pure fixture checks (complete=ready, 1-topic-short=S1 shortfall, family-overlap=S2 shortfall): PASS')

  if (process.argv.includes('--write-artifacts')) {
    mkdirSync('docs/evidence', { recursive: true })
    writeFileSync(
      'docs/evidence/phase4-rehearsal-matrix.json',
      JSON.stringify({
        generatedAt: new Date().toISOString(),
        blueprintVersion: REHEARSAL_BLUEPRINT_VERSION,
        sessionQuestions: SESSION_QUESTIONS,
        sessionMinutes: SESSION_MINUTES,
        liveInventoryStatus: liveStatus,
        liveInventoryError: liveError,
        manifest: report?.manifest ?? null,
        bankWideFullRehearsalUpperBound: fullRehearsalsDeliverable,
        perStudentFullRehearsalsDeliverable: null,
        topics: matrix,
      }, null, 2) + '\n'
    )
  }
}

main()
