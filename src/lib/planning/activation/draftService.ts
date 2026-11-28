import { createAdminClient } from '../../supabase/admin'
import { draftFingerprint, generatePreview, type DraftCycle } from '../../onboarding/previewService'
import { REVIEW_BUFFER_MINUTES } from '../pulse/firstCycle'
import { todayInZone } from '../studyWeek'
import type { PaperPlan } from '../pulse/paper'

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
export type PaperSummary = { kind: 'paper' | 'none'; reason: Extract<PaperPlan, { kind: 'none' }>['reason'] | null; purpose: 'diagnostic' | 'revisionary' | 'mixed' | null; skipped: SkippedModule[] }
export type ReadyDraft = { draftId: string; revision: number; tasks: DraftTask[]; reused: boolean; paper: PaperSummary; cycle: DraftCycle }

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

/**
 * The ready draft of this setup version prepared on this local day, if it can still be offered: inside its review window it must still fit now; after it,
 * it is offered again only while it still leaves the whole review time. An obsolete one is retired so a fresh one is built.
 */
async function offerableReady(userId: string, version: number, today: string, now: Date): Promise<ReadyDraft | null> {
  const admin = createAdminClient()
  const { data, error } = await admin.from('plan_drafts')
    .select('id, revision, draft_json, timezone, roadmap_id')
    .eq('user_id', userId).eq('purpose', PURPOSE).eq('status', 'ready').like('context_fingerprint', `${draftFingerprint(version, '%', today)}`)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (error) throw new Error(`Could not read drafts: ${error.message}`)
  if (!data) return null
  const json = data.draft_json as any, cycle = json?.cycle as DraftCycle | undefined
  if (cycle && cycle.end >= today) {
    const at = new Date(now.getTime() < Date.parse(cycle.reference) ? now.getTime() : now.getTime() + REVIEW_BUFFER_MINUTES * 60_000).toISOString()
    // The database's own fit rules, the ones acceptance applies.
    const rows = ((json.tasks ?? []) as any[]).map(t => ({ ...t, task_type: t.metadata?.task_type }))
    const timed = rows.filter(t => t.metadata?.placement === 'timed' && t.metadata?.starts_at).map(t => ({ local_date: t.scheduled_date, starts_at: t.metadata.starts_at, duration_minutes: t.duration_minutes }))
    const zone = (data.timezone as string | null) ?? 'UTC'
    const [unfit, clash] = await Promise.all([
      admin.rpc('first_unfit_day', { p_user: userId, p_zone: zone, p_now: at, p_rows: rows, p_date_key: 'scheduled_date', p_minutes_key: 'duration_minutes', p_type_key: 'task_type', p_placement_key: '__none__' }).throwOnError(),
      admin.rpc('extra_window_conflict', { p_user: userId, p_zone: zone, p_now: at, p_items: timed }).throwOnError(),
    ])
    if (unfit.data === null && clash.data === false) return { draftId: data.id as string, revision: data.revision as number, tasks: tasksFromDraft(json), reused: true, paper: json.paper ?? NO_PAPER_INFO, cycle }
  }
  await retire(userId, [{ id: data.id as string, roadmap_id: data.roadmap_id as string | null }])
  return null
}

/** Retires drafts that are still ready. One accepted meanwhile is left exactly as it is, with its Roadmap. */
async function retire(userId: string, drafts: { id: string; roadmap_id: string | null }[]) {
  if (!drafts.length) return
  const admin = createAdminClient()
  const up = await admin.from('plan_drafts').update({ status: 'superseded' }).in('id', drafts.map(d => d.id)).eq('user_id', userId).eq('status', 'ready').select('roadmap_id')
  if (up.error) throw new Error(`Could not supersede stale drafts: ${up.error.message}`)
  const roadmapIds = [...new Set((up.data ?? []).map(d => d.roadmap_id as string | null).filter((x): x is string => !!x))]
  // Only draft roadmaps: an active roadmap is never touched here.
  if (roadmapIds.length) await admin.from('study_roadmaps').update({ status: 'superseded' }).in('id', roadmapIds).eq('user_id', userId).eq('status', 'draft').throwOnError()
}

/** Ready drafts that no longer match the current setup and day are superseded. `afterRead` exists for the contention test only. */
export async function supersedeOtherReady(userId: string, keepPattern: string, opts: { afterRead?: () => Promise<void> } = {}) {
  const admin = createAdminClient()
  const { data: stale, error } = await admin.from('plan_drafts')
    .select('id, roadmap_id, context_fingerprint').eq('user_id', userId).eq('purpose', PURPOSE).eq('status', 'ready')
  if (error) throw new Error(`Could not read stale drafts: ${error.message}`)
  await opts.afterRead?.()
  // `keepPattern` is a fingerprint with `%` for the week. Drafts without a fingerprint predate it and are retired too.
  const [head, tail] = keepPattern.split('%')
  const keeps = (f: string | null) => !!f && (tail === undefined ? f === keepPattern : f.startsWith(head) && f.endsWith(tail))
  await retire(userId, (stale ?? []).filter(d => !keeps(d.context_fingerprint as string | null)) as { id: string; roadmap_id: string | null }[])
}

const inflight = new Map<string, Promise<ReadyDraft>>()

/** Concurrent callers for the same setup version and week share one build (two tabs, a double click, a retry). */
export async function getOrCreateReadyDraft(userId: string, opts: { now?: Date } = {}): Promise<ReadyDraft> {
  // The setup can move while a preview is built; start again from the new setup, a few times at most.
  for (let attempt = 0; ; attempt++) {
    try { return await getOrBuild(userId, opts.now ?? new Date()) } catch (e: any) { if (e?.code !== 'CONTEXT_CHANGED' || attempt >= 2) throw e }
  }
}

async function getOrBuild(userId: string, now: Date): Promise<ReadyDraft> {
  const admin = createAdminClient()
  const { data: profile } = await admin.from('profiles').select('onboarding_context_version, timezone').eq('id', userId).maybeSingle().throwOnError()
  // The student's actual local date: one draft per setup version and day, whichever week it was able to use.
  const version = (profile?.onboarding_context_version ?? 1) as number, today = todayInZone((profile?.timezone as string | null) || 'UTC', now)
  const key = `${userId}:${draftFingerprint(version, '%', today)}`
  const running = inflight.get(key)
  if (running) return running
  const job = build(userId, version, today, now).finally(() => inflight.delete(key))
  inflight.set(key, job)
  return job
}

async function build(userId: string, version: number, today: string, now: Date): Promise<ReadyDraft> {
  const existing = await offerableReady(userId, version, today, now)
  if (existing) return existing

  await supersedeOtherReady(userId, draftFingerprint(version, '%', today))

  try {
    const created = await generatePreview(userId, { now })
    return { draftId: created.draftId, revision: created.revision, tasks: created.tasks as DraftTask[], reused: false, paper: created.paper, cycle: created.cycle }
  } catch (e: any) {
    // Two concurrent requests race to the unique index; the loser reads the winner's draft.
    if (e?.code === '23505') {
      const winner = await offerableReady(userId, version, today, now)
      if (winner) return winner
    }
    throw e
  }
}
