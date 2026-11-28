import { createAdminClient } from '../supabase/admin'
import { perRequest } from './perRequest'
import { readAll } from '../supabase/readAll'

/**
 * Two reads nearly every page needs (the student's time zone and active cycle id), shared within one server request so a page that asks for them from
 * six places makes one request each. A failed read rejects; it is never turned into a default zone or "no cycle". Outside a request each call reads afresh.
 */
/**
 * The student's own profile row, read once per server request with every column a page's loaders ask for. Read-only display paths use this instead of each
 * selecting its own columns (a Home render used to read `profiles` six times). Write paths and anything that must see its own write keep their own fresh read.
 */
const PROFILE_COLUMNS = 'id, onboarding_status, display_name, exam_date, registered, exam_window_id, exam_year, exam_sitting, timezone, class_pattern, week_availability_mode, reminder_at, prep_mode, study_mode, classes_completed_at, stage, mock_date, mock_kind, mock_label, mock_start_time, mock_duration_minutes, entry_reported_at'
export const profileRow = perRequest(async (userId: string) =>
  (await createAdminClient().from('profiles').select(PROFILE_COLUMNS).eq('id', userId).maybeSingle().throwOnError()).data as Record<string, any> | null, id => id)

export const profileTimezone = async (userId: string): Promise<string | null> => ((await profileRow(userId))?.timezone as string | null | undefined) ?? null

/** The active cycle (id, window and zone), read once per server request; render-path readers share it instead of each selecting its own columns. */
export type ActiveCycle = { id: string; status: string; starts_at: string | null; starts_at_local: string; ends_at_local: string; timezone: string | null }
export const activeCycleRow = perRequest(async (userId: string): Promise<ActiveCycle | null> =>
  ((await createAdminClient().from('planning_cycles').select('id, status, starts_at, starts_at_local, ends_at_local, timezone').eq('user_id', userId).eq('status', 'active').maybeSingle().throwOnError()).data as ActiveCycle | null), id => id)

export const activeCycleId = async (userId: string): Promise<string | null> => (await activeCycleRow(userId))?.id ?? null

/**
 * The student's weekly commitment series (any status): a handful of rows (work, commute, class patterns). Three loaders each selected their own columns of
 * the same rows. One-off commitments are NOT here: they stay range-bounded reads, never "every one ever created".
 */
export type WeeklySeries = { id: string; label: string | null; kind: string; status: string; is_protected: boolean | null; recurrence: string; weekdays: number[] | null; start_time: string | null; end_time: string | null; starts_on: string | null; ends_on: string | null }
export const weeklySeries = perRequest(async (userId: string): Promise<WeeklySeries[]> =>
  ((await createAdminClient().from('calendar_commitments').select('id, label, kind, status, is_protected, recurrence, weekdays, start_time, end_time, starts_on, ends_on')
    .eq('user_id', userId).eq('recurrence', 'weekly').throwOnError()).data ?? []) as WeeklySeries[], id => id)

/**
 * Every plan block the student owns, read once per server request with the union of columns that the history-wide readers need. Only readers that ALREADY
 * depend on the full history in the same request (getStudyActivity reads all of it) derive their rows from this; a reader that would be the only one asking
 * keeps its own narrow select, so a small question never pulls a whole history.
 */
export type OwnedBlock = {
  id: string; outcome_id: string | null; lm_id: string | null; execution: string; task_type: string; cancelled_at: string | null; local_date: string | null
  cycle_id: string | null; title: string; revision: number; scope_group_id: string | null; learning_activity_id: string | null; continued_from_task_id: string | null
  repair_thread_id: string | null; concept_id: string | null; class_session_id: string | null; duration_minutes: number | null; updated_at: string | null; priority: string | null; estimate_provisional: boolean | null; activity: any
}
export const ownedBlocks = perRequest(async (userId: string): Promise<OwnedBlock[]> =>
  readAll<OwnedBlock>((a, z) => createAdminClient().from('plan_blocks')
    .select('id,outcome_id,lm_id,execution,task_type,cancelled_at,local_date,cycle_id,title,revision,scope_group_id,learning_activity_id,continued_from_task_id,repair_thread_id,concept_id,class_session_id,duration_minutes,updated_at,priority,estimate_provisional,activity:learning_activities!plan_blocks_learning_activity_id_fkey(activity_type)')
    .eq('user_id', userId).order('id').range(a, z)), id => id)

/** The whole concept-to-outcome map (reference data, read in full and paged): shared by the tracker and the completed-scope reader. */
export const conceptOutcomeMap = perRequest(async (): Promise<{ concept_id: string; outcome_id: string }[]> =>
  readAll<{ concept_id: string; outcome_id: string }>((a, z) => createAdminClient().from('concept_outcome_map').select('concept_id, outcome_id').order('concept_id').order('outcome_id').range(a, z)), () => 'all')

/** The recap of the review that opened a cycle: the adaptation note and the catch-up status both read it, once per request. Render-path readers only. */
export const openingReviewRecap = perRequest(async (userId: string, cycleId: string): Promise<unknown> =>
  (await createAdminClient().from('weekly_reviews').select('recap').eq('user_id', userId).eq('next_cycle_id', cycleId).maybeSingle().throwOnError()).data?.recap ?? null, (u: string, c: string) => `${u}|${c}`)

/** Every completion scope the student confirmed (paged): study activity and the closed-week observations read the same rows. */
export const scopeConfirmations = perRequest((userId: string) => readAll<{ block_id: string; outcome_id: string }>((a, z) => createAdminClient().from('block_scope_confirmations')
  .select('block_id,outcome_id').eq('user_id', userId).order('block_id').order('outcome_id').range(a, z)), id => id)
