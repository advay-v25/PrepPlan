import { createHash } from 'node:crypto'
import { createAdminClient } from '../supabase/admin'
import { readAll } from '../supabase/readAll'
import { toLevel } from '../curriculum/confidence'
import { CONFIG, type Level, type Observation, type Profile, type ProfileHistory } from './difficultyPolicy'

/**
 * Learner evidence for the difficulty policy, read from the evidence ledger only. An observation is eligible when it is a valid, scored,
 * evidence-mode (never practice) answer to a human-approved question whose family is KNOWN AND CONFIRMED, from a weekly/reading/subject
 * paper whose reserved form froze a REVIEWER-CONFIRMED level. Voided/disputed answers, repair re-checks, rehearsals and every earlier form
 * without frozen difficulty are excluded. Timing and interruption are never inputs; an unanswered question has no evidence row at all.
 */
const KINDS = ['weekly', 'reading', 'subject']
const SCORED = ['scored', 'rescored', 'partially_voided']

export type DifficultyEvidence = {
  /** Changes whenever scored evidence, its validity or a rescoring changes. Read BEFORE the evidence, like the scope source. */
  version: string
  byReading: Map<string, Observation[]>
  history: Map<string, ProfileHistory>
}

export async function evidenceVersion(userId: string): Promise<string> {
  const { data, error } = await createAdminClient().rpc('difficulty_evidence_version', { p_user: userId })
  if (error || typeof data !== 'string') throw new Error('Could not read the evidence revision')
  return data
}

export async function loadDifficultyEvidence(userId: string, readingIds: string[], now: Date = new Date()): Promise<DifficultyEvidence> {
  const version = await evidenceVersion(userId)
  const admin = createAdminClient()
  const since = new Date(now.getTime() - CONFIG.windowDays * 86_400_000 * 2).toISOString()   // generous read; the policy applies the exact window
  const attempts = await readAll<{ id: string; form_id: string; attempt_kind: string; status: string; completed_at: string | null; delivered_coverage: any }>((a, z) =>
    admin.from('assessment_attempts').select('id, form_id, attempt_kind, status, completed_at, delivered_coverage').eq('user_id', userId).in('attempt_kind', KINDS).in('status', SCORED).order('id').range(a, z))
  const byId = new Map(attempts.map(a => [a.id, a]))
  const history = new Map<string, ProfileHistory>()
  for (const a of [...attempts].sort((x, y) => String(x.completed_at ?? '').localeCompare(String(y.completed_at ?? '')) || x.id.localeCompare(y.id))) {
    const rs = a.delivered_coverage?.difficulty?.readings as { readingId: string; profile: Profile }[] | undefined
    for (const r of rs ?? []) history.set(r.readingId, [...(history.get(r.readingId) ?? []), { profile: r.profile, at: a.completed_at ?? '', id: a.id }])
  }
  const byReading = new Map<string, Observation[]>(readingIds.map(r => [r, []]))
  if (!attempts.length) return { version, byReading, history }

  const events = await readAll<any>((a, z) => admin.from('evidence_events')
    .select('id, attempt_id, item_id, is_correct, self_reported_confidence, created_at, item:assessment_items(family_id, outcome_id, lm_id, family:item_families(construction_status))')
    .eq('user_id', userId).eq('validity', 'valid').eq('evidence_mode', 'evidence').not('is_correct', 'is', null).gte('created_at', since).order('id').range(a, z))
  const forms = [...new Set(events.map(e => byId.get(e.attempt_id)?.form_id).filter(Boolean) as string[])]
  const levels = forms.length ? await readAll<{ form_id: string; item_id: string; difficulty_level: Level | null; difficulty_basis: string | null }>((a, z) =>
    admin.from('form_items').select('form_id, item_id, difficulty_level, difficulty_basis').in('form_id', forms).eq('difficulty_basis', 'confirmed').order('form_id').order('item_id').range(a, z)) : []
  const level = new Map(levels.map(l => [`${l.form_id}:${l.item_id}`, l.difficulty_level as Level]))
  for (const e of events) {
    const att = byId.get(e.attempt_id), it = e.item
    if (!att || !it?.family_id || it.family?.construction_status !== 'confirmed' || !it.outcome_id) continue
    const lv = level.get(`${att.form_id}:${e.item_id}`)
    if (!lv || lv === 'stretch' || !byReading.has(it.lm_id)) continue
    byReading.get(it.lm_id)!.push({ id: e.id, familyId: it.family_id, attemptId: e.attempt_id, at: e.created_at, correct: Boolean(e.is_correct), confidence: toLevel(e.self_reported_confidence), level: lv, outcomeId: it.outcome_id, readingId: it.lm_id })
  }
  return { version, byReading, history }
}

/** Seed for the tie-break: stable for an unchanged decision and inventory, different once questions are consumed or the evidence moves. */
export const selectionSeed = (parts: (string | number | null | undefined)[]) => createHash('sha256').update(parts.map(p => String(p ?? '')).join('|')).digest('hex').slice(0, 24)
