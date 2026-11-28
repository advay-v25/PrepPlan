import { createAdminClient } from '../supabase/admin'
import { readAll } from '../supabase/readAll'
import { refCache } from '../ops/refCache'

/**
 * Static curriculum reference reads that several loaders asked for with different column lists. Each is one read, kept for the cache's short window in
 * production (see refCache); an error is never cached, readAll and throwOnError reject and the next call reads again.
 */
export const allOutcomes = () => refCache('ref.outcomes', () =>
  readAll<{ id: string; reading_id: string; code: string; title: string }>((a, z) => createAdminClient().from('reading_los').select('id, reading_id, code, title').order('id').range(a, z)))

export const topicWeightRows = () => refCache('ref.topic-weights', async () =>
  ((await createAdminClient().from('topics').select('id, exam_weight_min, exam_weight_max').throwOnError()).data ?? []) as { id: string; exam_weight_min: number | string; exam_weight_max: number | string }[])
