/**
 * Seeds the CFA Level I curriculum graph.
 *
 * Idempotent: re-running updates names, effort bands and edges without
 * disturbing the three FSA modules that already carry concepts and items.
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import { EDGES, MODULES, TOPICS } from '../src/lib/curriculum/catalogue'

dotenv.config({ path: '.env.local', quiet: true } as any)

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
})

async function main() {
  console.log(`Seeding ${TOPICS.length} topics, ${MODULES.length} modules, ${EDGES.length} edges\n`)

  const { error: topicErr } = await admin.from('topics').upsert(
    TOPICS.map(t => ({
      id: t.id, name: t.name,
      exam_weight_min: t.weightMin, exam_weight_max: t.weightMax,
      default_sequence: t.sequence, summary: t.summary,
    })),
    { onConflict: 'id' }
  )
  if (topicErr) throw new Error(`topics: ${topicErr.message}`)
  console.log(`  topics      ${TOPICS.length}`)

  const { error: moduleErr } = await admin.from('learning_modules').upsert(
    MODULES.map(m => ({
      id: m.id,
      topic_id: m.topic,
      topic_ref: m.topic,
      name: m.name,
      summary: m.summary,
      effort_band: m.effortBand,
      // effort_units is the legacy NOT NULL column. It is kept in step with the
      // band so nothing still reading it sees a contradiction.
      effort_units: m.effortBand,
      difficulty_weight: m.difficulty,
      sequence_hint: m.sequence,
      is_active: true,
    })),
    { onConflict: 'id' }
  )
  if (moduleErr) throw new Error(`modules: ${moduleErr.message}`)
  console.log(`  modules     ${MODULES.length}`)

  const { error: edgeErr } = await admin.from('lm_edges').upsert(
    EDGES.map(e => ({ from_lm: e.from, to_lm: e.to, kind: e.kind, rationale: e.rationale })),
    { onConflict: 'from_lm,to_lm,kind' }
  )
  if (edgeErr) throw new Error(`edges: ${edgeErr.message}`)
  console.log(`  edges       ${EDGES.length}`)

  const { count } = await admin.from('learning_modules').select('id', { count: 'exact', head: true })
  console.log(`\nlearning_modules now holds ${count} rows.`)
}

main().catch(e => { console.error('\nSeed failed:', e.message); process.exit(1) })
