import { createAdminClient } from '../supabase/admin'
import type { PreviewItem } from '../../components/reviewer/DraftPreview'

/** Reads items for a reviewer preview. Read-only; callers must already have passed the reviewer guard. */
export async function loadPreviewItems(f: { ids?: string[]; batch?: string; reading?: string; topic?: string; states?: string[]; n?: number }): Promise<PreviewItem[]> {
  const admin = createAdminClient()
  let q: any = admin.from('assessment_items').select('id, item_version, review_status, stem, options, key_index, per_option_feedback, item_card, lm_id').order('id')
  if (f.ids?.length) q = q.in('id', f.ids)
  else {
    q = q.in('review_status', f.states?.length ? f.states : ['draft', 'verified', 'reviewed'])
    if (f.batch) q = q.eq('batch_id', f.batch)
    if (f.reading) q = q.eq('lm_id', f.reading)
    if (f.topic) {
      const { data: rs } = await admin.from('curriculum_readings').select('id').eq('topic_id', f.topic)
      q = q.in('lm_id', (rs ?? []).map(r => r.id as string))
    }
  }
  const { data } = await q.limit(Math.min(90, Math.max(1, f.n ?? 20)))
  return ((data ?? []) as any[]).map(i => ({
    id: i.id, version: i.item_version, state: i.review_status, stem: i.stem, options: i.options, keyIndex: i.key_index,
    feedback: i.per_option_feedback ?? {}, solution: i.item_card?.solution ?? null, diagnoses: i.item_card?.distractorDiagnoses ?? [],
  }))
}
