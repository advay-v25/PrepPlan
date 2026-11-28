import { createAdminClient } from '../supabase/admin'
import { profileRow } from '../ops/sharedReads'
import { EMPTY_ENTRY, UNCERTAINTY_LEVELS, MOCK_KINDS, type EntryContext, type MockKind, type UncertaintyLevel } from './entryContext'

/** The student's reported starting position beyond coverage. A student who has reported none of it gets the empty context, never an invented one. */
export async function loadEntryContext(userId: string): Promise<EntryContext> {
  const admin = createAdminClient()
  const [{ data: profile }, { data: rows }] = await Promise.all([
    profileRow(userId).then(data => ({ data })),
    admin.from('user_entry_uncertainty').select('topic_id, level, lm_ids').eq('user_id', userId).throwOnError(),
  ])
  if (!profile) return EMPTY_ENTRY
  const uncertainty: EntryContext['uncertainty'] = {}
  for (const r of rows ?? []) {
    if ((UNCERTAINTY_LEVELS as readonly string[]).includes(r.level as string)) {
      uncertainty[r.topic_id as string] = { level: r.level as UncertaintyLevel, lmIds: (r.lm_ids ?? []) as string[] }
    }
  }
  const kind = (MOCK_KINDS as readonly string[]).includes(profile.mock_kind as string) ? (profile.mock_kind as MockKind) : null
  return {
    stage: (profile.stage ?? null) as string | null,
    mock: profile.mock_date && kind ? {
      date: profile.mock_date as string, kind,
      label: (profile.mock_label ?? null) as string | null,
      startTime: profile.mock_start_time ? String(profile.mock_start_time).slice(0, 5) : null,
      durationMinutes: (profile.mock_duration_minutes ?? null) as number | null,
    } : null,
    uncertainty,
    reportedAt: (profile.entry_reported_at ?? null) as string | null,
  }
}
