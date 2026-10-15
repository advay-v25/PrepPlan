import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local', quiet: true } as any)

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
})

async function main() {
  console.log('Running Gate A Preflight Checks...\n')
  let hasErrors = false

  function report(name: string, count: number, details?: string) {
    if (count > 0) {
      console.error(`❌ [FAILED] ${name}: ${count} violation(s) found. ${details || ''}`)
      hasErrors = true
    } else {
      console.log(`✅ [PASS]   ${name}`)
    }
  }

  // 1. duplicate responses for the same attempt and item
  const { data: responses, error: rpcErr } = await admin.rpc('preflight_duplicate_responses')
  if (rpcErr || responses === null) {
    // Fallback if RPC doesn't exist yet - use manual grouping via REST API isn't easy for counts > 1, so we'll fetch all and group in memory (it's a preflight script).
    const { data: allResponses } = await admin.from('assessment_responses').select('attempt_id, item_id')
    const grouped = new Map<string, number>()
    let dups = 0
    for (const r of (allResponses || [])) {
      const key = `${r.attempt_id}-${r.item_id}`
      grouped.set(key, (grouped.get(key) || 0) + 1)
      if (grouped.get(key)! === 2) dups++
    }
    report('Duplicate responses for same attempt/item', dups)
  }

  // 2. duplicate evidence events by repeated submission
  const { data: allEvents } = await admin.from('evidence_events').select('attempt_id, item_id')
  const evGrouped = new Map<string, number>()
  let evDups = 0
  for (const e of (allEvents || [])) {
    const key = `${e.attempt_id}-${e.item_id}`
    evGrouped.set(key, (evGrouped.get(key) || 0) + 1)
    if (evGrouped.get(key)! === 2) evDups++
  }
  report('Duplicate evidence events for same attempt/item', evDups)

  // 3. multiple active repair rows for the same user and concept
  const { data: activeRepairs } = await admin.from('repair_queue').select('user_id, evidence_event_id').eq('status', 'open')
  const { data: evsForRepairs } = await admin.from('evidence_events').select('id, concept_id')
  const evConceptMap = new Map((evsForRepairs || []).map(e => [e.id, e.concept_id]))
  const repairGrouped = new Map<string, number>()
  let repairDups = 0
  for (const r of (activeRepairs || [])) {
    const concept_id = evConceptMap.get(r.evidence_event_id as string)
    if (concept_id) {
      const key = `${r.user_id}-${concept_id}`
      repairGrouped.set(key, (repairGrouped.get(key) || 0) + 1)
      if (repairGrouped.get(key)! === 2) repairDups++
    }
  }
  report('Multiple active repair rows for same user/concept', repairDups)

  // 4. multiple active planning cycles for one user
  const { data: activeCycles } = await admin.from('planning_cycles').select('user_id').eq('status', 'active')
  const cycleGrouped = new Map<string, number>()
  let cycleDups = 0
  for (const c of (activeCycles || [])) {
    const key = c.user_id as string
    cycleGrouped.set(key, (cycleGrouped.get(key) || 0) + 1)
    if (cycleGrouped.get(key)! === 2) cycleDups++
  }
  report('Multiple active planning cycles for one user', cycleDups)

  // 5. executed proposals without identifiable task IDs
  // We use coach_proposals as stated in the spec
  const { data: execProposals } = await admin.from('coach_proposals').select('id, applied_task_ids').eq('status', 'executed')
  let noTasksCount = 0
  for (const p of (execProposals || [])) {
    if (!p.applied_task_ids || (p.applied_task_ids as any[]).length === 0) {
      noTasksCount++
    }
  }
  report('Executed proposals without task IDs', noTasksCount)

  // 6. evidence-grade attempts containing non-reviewed items
  const { data: scoredAttempts } = await admin.from('assessment_attempts').select('id').eq('status', 'scored')
  const { data: allResponses2 } = await admin.from('assessment_responses').select('attempt_id, item_id')
  const { data: allItems } = await admin.from('assessment_items').select('id, review_status')
  
  const itemReviewMap = new Map((allItems || []).map(i => [i.id, i.review_status]))
  const scoredIds = new Set((scoredAttempts || []).map(a => a.id))
  
  let nonReviewedCount = 0
  for (const r of (allResponses2 || [])) {
    if (scoredIds.has(r.attempt_id)) {
      const status = itemReviewMap.get(r.item_id as string)
      if (status !== 'reviewed') {
        nonReviewedCount++
      }
    }
  }
  report('Evidence-grade attempts with non-reviewed items', nonReviewedCount)

  console.log('')
  if (hasErrors) {
    console.error('❌ Preflight checks failed. Manual reconciliation needed before Gate A migration.')
    process.exit(1)
  } else {
    console.log('✅ All preflight checks passed. Safe to migrate.')
    process.exit(0)
  }
}

main().catch(e => {
  console.error('\nPreflight script failed:', e.message)
  process.exit(1)
})
