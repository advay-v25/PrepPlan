/** Simulated PostgREST failures/history through the production selector, not authenticated journey proof. */
import assert from 'node:assert/strict'
import { previewAdaptiveItem, startAdaptiveItem } from '../src/lib/tests/adaptiveItemPractice'

const originalFetch = globalThis.fetch
const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL, originalKey = process.env.SUPABASE_SECRET_KEY
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1'
process.env.SUPABASE_SECRET_KEY = 'test-only'
let failHistory = false, exposed = true, replay = false
const requests: string[] = []
const item = { id: 'easy', lm_id: 'r032', outcome_id: 'r032-a', concept_id: 'concept', family_id: 'family', item_version: 1, key_index: 0 }
globalThis.fetch = async (input) => {
  const url = new URL(String(input)), table = url.pathname.split('/').at(-1)!
  requests.push(table)
  const response = (data: unknown) => Response.json(data)
  switch (table) {
    case 'curriculum_manifests': return response([{ id: 'manifest', capabilities: { blueprint_available: true } }])
    case 'curriculum_readings': return response({ id: 'r032', title: 'Inventories' })
    case 'assessment_responses': case 'assessment_attempts': return response([])
    case 'adaptive_item_runs': {
      const offset = Number(url.searchParams.get('offset') ?? 0)
      if (failHistory && offset === 500) return Response.json({ message: 'later history page unavailable' }, { status: 503 })
      return response(Array.from({ length: 501 }, (_, n) => ({ id: `run-${n}` })).slice(offset, offset + 500))
    }
    case 'adaptive_item_steps': return response(exposed ? [{ item_id: 'sibling', family_id: 'family', seq: 1 }] : [])
    case 'curriculum_concepts': return response([{ id: 'concept' }])
    case 'student_eligible_items': return response([item, { ...item, id: 'easy-variant' }])
    case 'reading_los': return response([{ id: 'r032-a', reading_id: 'r032' }])
    case 'concept_outcome_map': return response([{ concept_id: 'concept', outcome_id: 'r032-a' }])
    case 'item_confirmed_difficulty': return response(['easy', 'easy-variant'].map(id => ({ item_id: id, item_version: 1, level: 'foundation' })))
    case 'adaptive_item_receipts': return response(replay ? {
      payload_hash: (await import('node:crypto')).createHash('sha256').update(JSON.stringify({ readingId: 'r032', outcomeIds: ['r032-a'], policy: 'adaptive-item.1' })).digest('hex'),
      result: { ok: true, runId: 'saved-run' },
    } : null)
    default: throw new Error(`Unexpected database operation: ${table}`)
  }
}

try {
  const input = { readingId: 'r032', outcomeIds: ['r032-a'] }
  failHistory = true
  assert.equal((await previewAdaptiveItem('student', input)).state, 'unavailable', 'failed later history is not fresh inventory')
  failHistory = false
  assert.equal((await previewAdaptiveItem('student', input)).state, 'shortage', 'a sibling delivered in prior adaptive practice is excluded')
  exposed = false
  const recovered = await previewAdaptiveItem('student', input)
  assert.equal(recovered.state, 'start', 'retry recovers from a failed read without persisting shortage')
  assert.equal(recovered.deliverableEasy, 1, 'two wordings from one family deliver only one fresh question')
  failHistory = true; replay = true; requests.length = 0
  const receipt = await startAdaptiveItem('student', input, 'saved-key')
  assert.equal(receipt.runId, 'saved-run')
  assert.equal(receipt.replay, true)
  assert.deepEqual(requests, ['adaptive_item_receipts'], 'a committed start replays without requiring inventory')
  console.log('PASS adaptive service: paged history failure/recovery, sibling exclusion, receipt before inventory')
} finally {
  globalThis.fetch = originalFetch
  if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl
  if (originalKey === undefined) delete process.env.SUPABASE_SECRET_KEY; else process.env.SUPABASE_SECRET_KEY = originalKey
}
