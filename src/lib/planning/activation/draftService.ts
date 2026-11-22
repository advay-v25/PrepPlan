import { createAdminClient } from '../../supabase/admin'
import { draftFingerprint, generatePreview } from '../../onboarding/previewService'
import { getStudyWeekContext } from '../schedule'

/**
 * Versioned, idempotent access to the baseline/current-week draft.
 *
 * A draft is identified by what it was built from: the student's setup
 * version and the week it covers (plan_drafts.context_fingerprint, backed by
 * a unique index on ready onboarding drafts per setup version). Asking twice
 * returns the same draft; changed setup, policy or local day supersedes the old one.
 * Nothing here writes plan_blocks — tasks only exist after the atomic
 * acceptance RPC (accept_onboarding_preview).
 */

export type DraftTask = {
  id: string; title: string; duration: number; duration_minutes: number; detail: string
  task_type: string; local_date: string; lm_id: string | null; repair_thread_id: string | null
  priority: string; placement: string; rationale: string
}

export type SkippedModule = { moduleId: string; name: string; purpose: 'diagnostic' | 'revisionary'; reason: 'insufficient_bank'; available: number; required: number }
export type PaperSummary = { kind: 'paper' | 'none'; reason: 'no_scope' | 'insufficient_bank' | 'below_minimum_paper' | 'mock_chosen' | null; purpose: 'diagnostic' | 'revisionary' | 'mixed' | null; skipped: SkippedModule[] }
export type ReadyDraft = { draftId: string; revision: number; tasks: DraftTask[]; reused: boolean; paper: PaperSummary }

const NO_PAPER_INFO: PaperSummary = { kind: 'none', reason: 'no_scope', purpose: null, skipped: [] }

const PURPOSE = 'onboarding_initial_week'

function tasksFromDraft(draftJson: any): DraftTask[] {
  return ((draftJson?.tasks ?? []) as any[]).map(t => ({
    id: t.id, title: t.title, duration: t.duration_minutes, duration_minutes: t.duration_minutes,
    detail: t.metadata?.detail ?? '', task_type: t.metadata?.task_type ?? 'study',
    local_date: t.scheduled_date, lm_id: t.metadata?.lm_id ?? null,
    repair_thread_id: t.metadata?.repair_thread_id ?? null, priority: t.metadata?.priority ?? 'core',
    placement: t.metadata?.placement ?? 'day_preferred', rationale: t.metadata?.rationale ?? '',
  }))
}

async function findMatchingReady(userId: string, fingerprint: string): Promise<ReadyDraft | null> {
  const admin = createAdminClient()
  const { data, error } = await admin.from('plan_drafts')
    .select('id, revision, draft_json')
    .eq('user_id', userId).eq('purpose', PURPOSE).eq('status', 'ready').eq('context_fingerprint', fingerprint)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (error) throw new Error(`Could not read drafts: ${error.message}`)
  return data ? { draftId: data.id as string, revision: data.revision as number, tasks: tasksFromDraft(data.draft_json), reused: true, paper: (data.draft_json as any)?.paper ?? NO_PAPER_INFO } : null
}

/** Ready drafts that no longer match the current setup/week are superseded, along with their unused draft roadmaps. */
async function supersedeOtherReady(userId: string, keepFingerprint: string) {
  const admin = createAdminClient()
  const { data: stale, error } = await admin.from('plan_drafts')
    .select('id, roadmap_id').eq('user_id', userId).eq('purpose', PURPOSE).eq('status', 'ready')
    .neq('context_fingerprint', keepFingerprint)
  if (error) throw new Error(`Could not read stale drafts: ${error.message}`)
  // Also catches ready drafts created before fingerprints existed.
  const { data: unstamped } = await admin.from('plan_drafts')
    .select('id, roadmap_id').eq('user_id', userId).eq('purpose', PURPOSE).eq('status', 'ready').is('context_fingerprint', null)
  const all = [...(stale ?? []), ...(unstamped ?? [])]
  if (all.length === 0) return
  const ids = [...new Set(all.map(d => d.id as string))]
  const roadmapIds = [...new Set(all.map(d => d.roadmap_id as string | null).filter((x): x is string => !!x))]
  const up = await admin.from('plan_drafts').update({ status: 'superseded' }).in('id', ids).eq('user_id', userId)
  if (up.error) throw new Error(`Could not supersede stale drafts: ${up.error.message}`)
  if (roadmapIds.length) {
    // Only draft roadmaps: an active roadmap is never touched here.
    await admin.from('study_roadmaps').update({ status: 'superseded' }).in('id', roadmapIds).eq('user_id', userId).eq('status', 'draft')
  }
}

const inflight = new Map<string, Promise<ReadyDraft>>()

/** Concurrent callers for the same setup version and week share one build (two tabs, a double click, a retry). */
export async function getOrCreateReadyDraft(userId: string): Promise<ReadyDraft> {
  // The setup can move while a preview is built; start again from the new setup, a few times at most.
  for (let attempt = 0; ; attempt++) {
    try { return await getOrBuild(userId) } catch (e: any) { if (e?.code !== 'CONTEXT_CHANGED' || attempt >= 2) throw e }
  }
}

async function getOrBuild(userId: string): Promise<ReadyDraft> {
  const admin = createAdminClient()
  const [{ data: profile }, ctx] = await Promise.all([
    admin.from('profiles').select('onboarding_context_version').eq('id', userId).maybeSingle(),
    getStudyWeekContext(userId),
  ])
  const fingerprint = draftFingerprint((profile?.onboarding_context_version ?? 1) as number, ctx.week.startDate, ctx.today)
  const key = `${userId}:${fingerprint}`
  const running = inflight.get(key)
  if (running) return running
  const job = build(userId, fingerprint).finally(() => inflight.delete(key))
  inflight.set(key, job)
  return job
}

async function build(userId: string, fingerprint: string): Promise<ReadyDraft> {
  const existing = await findMatchingReady(userId, fingerprint)
  if (existing) return existing

  await supersedeOtherReady(userId, fingerprint)

  try {
    const created = await generatePreview(userId)
    return { draftId: created.draftId, revision: created.revision, tasks: created.tasks as DraftTask[], reused: false, paper: created.paper }
  } catch (e: any) {
    // Two concurrent requests race to the unique index; the loser reads the winner's draft.
    if (e?.code === '23505') {
      const winner = await findMatchingReady(userId, fingerprint)
      if (winner) return winner
    }
    throw e
  }
}
