import { createAdminClient } from '../supabase/admin'
import { perRequest } from './perRequest'
import { readAll } from '../supabase/readAll'

/**
 * Two reads nearly every page needs (the student's time zone and active cycle id), shared within one server request so a page that asks for them from
 * six places makes one request each. A failed read rejects; it is never turned into a default zone or "no cycle". Outside a request each call reads afresh.
 */
export const profileTimezone = perRequest(async (userId: string): Promise<string | null> =>
  ((await createAdminClient().from('profiles').select('timezone').eq('id', userId).maybeSingle().throwOnError()).data?.timezone as string | null | undefined) ?? null, id => id)

export const activeCycleId = perRequest(async (userId: string): Promise<string | null> =>
  ((await createAdminClient().from('planning_cycles').select('id').eq('user_id', userId).eq('status', 'active').maybeSingle().throwOnError()).data?.id as string | undefined) ?? null, id => id)

/** The whole concept-to-outcome map (reference data, read in full and paged): shared by the tracker and the completed-scope reader. */
export const conceptOutcomeMap = perRequest(async (): Promise<{ concept_id: string; outcome_id: string }[]> =>
  readAll<{ concept_id: string; outcome_id: string }>((a, z) => createAdminClient().from('concept_outcome_map').select('concept_id, outcome_id').order('concept_id').order('outcome_id').range(a, z)), () => 'all')
