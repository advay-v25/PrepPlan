import { createAdminClient } from '../supabase/admin'
import { MAX_ASSESSMENT_QUESTIONS, MIN_PAPER_QUESTIONS } from './limits'

/**
 * The only way a student paper (weekly, reading, subject, module, mock) is reserved. One database transaction validates
 * ownership, the open week, every question's exact approved version / hold-out / freshness / family, then writes the blueprint,
 * form, pinned items, attempt, scope snapshot and Calendar block link together. A retry or a concurrent call resumes the
 * same attempt. Re-checks use their own command (`start_repair_check`), which applies the same defect rule.
 */
export type ReserveInput = {
  userId: string
  manifestId: string
  /** assessment_attempts.attempt_kind; null for the free-form module papers. */
  kind: 'weekly' | 'reading' | 'subject' | 'mock' | 'module' | 'other' | 'practice' | null
  /** One open attempt per (user, kind, openKey). null = no supported identity (never deduplicated). */
  openKey: string | null
  cycleId: string | null
  paperKind: 'diagnostic' | 'revisionary' | 'mixed' | null
  /** assessment_blueprints.purpose */
  purpose: string
  itemIds: string[]
  requestedScope: unknown
  constraints: unknown
  requested: unknown
  coverage: unknown
  scopeSnapshot?: unknown
  scopeLabel?: string
  scopeRevision?: string | null
  timeLimitMinutes?: number | null
  /** Claim this exact Calendar paper block, or (weekly) the cycle's unclaimed paper block. */
  linkBlockId?: string | null
  linkWeekly?: boolean
  /** `paper_scope_source` read BEFORE the scope was built; the reservation refuses if the plan changed since. */
  scopeSource?: string | null
  minQuestions?: number
  /** difficulty-policy: the evidence revision and per-item confirmed levels the student reviewed; re-checked under the student's lock. */
  evidenceVersion?: string | null
  levels?: Record<string, string> | null
}

export type ReserveResult =
  | { ok: true; attemptId: string; resumed: boolean; questions: number }
  | { ok: false; code: 'bank_insufficient' | 'bank_changed' | 'decision_changed' | 'scope_changed' | 'cycle_changed' | 'block_claimed' | 'failed'; message: string; defects?: { itemId: string; code: string }[]; deliverable?: number }

export const DEFECT_TEXT: Record<string, string> = {
  NOT_FOUND: 'a question was removed', NOT_REVIEWED: 'a question is no longer human reviewed', HELD_OUT: 'a question was held out',
  NO_APPROVAL: 'a question has no recorded approval for its current version', SEEN: 'you have already answered a question',
  UNKNOWN_FAMILY: 'a question has no known family, so it cannot count as independent evidence',
  SEEN_FAMILY: 'a question is a variant of one you have answered', DUPLICATE_FAMILY: 'two questions were variants of each other', DUPLICATE_ITEM: 'a question was listed twice',
}

/** The JSON form of a paper, as `_reserve_paper_json` expects it. */
export const paperJson = (i: ReserveInput) => ({
  kind: i.kind, openKey: i.openKey, cycle: i.cycleId, paperKind: i.paperKind, purpose: i.purpose, manifest: i.manifestId, itemIds: i.itemIds, min: i.minQuestions ?? MIN_PAPER_QUESTIONS,
  requestedScope: i.requestedScope, constraints: i.constraints, requested: i.requested, coverage: i.coverage, scope: i.scopeSnapshot ?? null, scopeLabel: i.scopeLabel ?? null,
  scopeRevision: i.scopeRevision ?? null, timeLimit: i.timeLimitMinutes ?? null, linkBlock: i.linkBlockId ?? null, linkWeekly: i.linkWeekly ?? false, scopeSource: i.scopeSource ?? null,
})

export async function reserveAttempt(i: ReserveInput): Promise<ReserveResult> {
  if (i.itemIds.length > MAX_ASSESSMENT_QUESTIONS) return { ok: false, code: 'failed', message: `A paper cannot exceed ${MAX_ASSESSMENT_QUESTIONS} questions.` }
  const checked = i.evidenceVersion !== undefined || i.levels !== undefined
  const { data, error } = checked
    ? await createAdminClient().rpc('start_paper_checked', { p_user: i.userId, p_evidence: i.evidenceVersion ?? null, p_levels: i.levels ?? null, p_paper: paperJson(i) })
    : await createAdminClient().rpc('start_assessment_paper', {
      p_user: i.userId, p_kind: i.kind, p_open_key: i.openKey, p_cycle: i.cycleId, p_paper_kind: i.paperKind, p_purpose: i.purpose, p_manifest: i.manifestId,
      p_item_ids: i.itemIds, p_min: i.minQuestions ?? MIN_PAPER_QUESTIONS, p_requested_scope: i.requestedScope, p_constraints: i.constraints, p_requested: i.requested,
      p_coverage: i.coverage, p_scope: i.scopeSnapshot ?? null, p_scope_label: i.scopeLabel ?? null, p_scope_revision: i.scopeRevision ?? null,
      p_time_limit: i.timeLimitMinutes ?? null, p_link_block: i.linkBlockId ?? null, p_link_weekly: i.linkWeekly ?? false, p_scope_source: i.scopeSource ?? null,
    })
  if (error) {
    if (error.message?.includes('BLOCK_ALREADY_CLAIMED')) return { ok: false, code: 'block_claimed', message: 'That paper was already started. Open it from Tests.' }
    // A unique-slot loss from a racing insert: the winner exists, so resume it.
    if (error.code === '23505' && i.openKey) {
      const { data: w } = await createAdminClient().from('assessment_attempts').select('id, form_id').eq('user_id', i.userId).eq('open_key', i.openKey).in('status', ['ready', 'in_progress']).limit(1).maybeSingle()
      if (w) return { ok: true, attemptId: w.id as string, resumed: true, questions: i.itemIds.length }
    }
    console.error('[reserveAttempt]', error.message)
    return { ok: false, code: 'failed', message: 'Could not start the paper. Nothing was started.' }
  }
  const r = data as any
  if (r?.ok) return { ok: true, attemptId: r.attemptId, resumed: Boolean(r.resumed), questions: Number(r.questions ?? i.itemIds.length) }
  if (r?.code === 'SCOPE_CHANGED') return { ok: false, code: 'scope_changed', message: 'Your completed work changed since you reviewed it. Review the updated paper before starting. Nothing was started.' }
  if (r?.code === 'DECISION_CHANGED') return { ok: false, code: 'decision_changed', message: 'Your recent results or the question labels changed since you reviewed this paper. Review the updated paper before starting. Nothing was started.' }
  if (r?.code === 'CYCLE_CHANGED') return { ok: false, code: 'cycle_changed', message: 'Your open week changed. Review it, then start again.' }
  if (r?.code === 'BANK_INSUFFICIENT') return { ok: false, code: 'bank_insufficient', deliverable: r.deliverable, message: `Only ${r.deliverable} fresh approved question${r.deliverable === 1 ? '' : 's'} can be served; at least ${r.needed} are needed. Nothing was started.` }
  if (r?.code === 'BANK_CHANGED') {
    const defects = (r.defects ?? []) as { itemId: string; code: string }[]
    const why = [...new Set(defects.map(d => DEFECT_TEXT[d.code] ?? d.code))].join('; ')
    return { ok: false, code: 'bank_changed', defects, message: `The available questions changed while starting (${why}). Nothing was started; review the updated paper.` }
  }
  return { ok: false, code: 'failed', message: 'Could not start the paper. Nothing was started.' }
}
