import { createAdminClient } from '../supabase/admin'
import { readAll } from '../supabase/readAll'

/**
 * Personal-data export contract. Every table the student owns directly (`user_id`) is listed with the stable unique key used to page it, so pagination
 * is deterministic (order by that key) and no row is skipped or repeated at a page boundary. Rows owned through a parent are listed in PARENT_OWNED.
 * `scripts/account-export-schema-test.ts` compares both lists, EXCLUDED_TABLES and the live schema, so new personal data cannot be forgotten.
 */
export const OWNED_TABLES: Record<string, string[]> = {
  assessment_attempts: ['id'], assessment_responses: ['id'], attempt_item_progress: ['attempt_id', 'item_id'], attempt_score_adjustments: ['id'], availability_rules: ['id'],
  availability_windows: ['id'], block_scope_confirmations: ['id'], calendar_commitments: ['id'], checkpoint_commands: ['user_id', 'key'], checkpoint_suggestion_tasks: ['user_id', 'checkpoint_id', 'suggestion_id'],
  class_log_updates: ['user_id', 'idempotency_key'], class_schedules: ['id'], class_sessions: ['id'], coach_messages: ['id'], coach_model_calls: ['id'], coach_proposals: ['id'], commitment_exceptions: ['id'],
  confidence_marks: ['user_id', 'scope_type', 'scope_id'], curriculum_notes: ['user_id', 'scope_type', 'scope_id'], cycle_assessment_choices: ['user_id', 'week_start'], evidence_events: ['id'],
  evidence_overrides: ['id'], exam_attempts: ['id'], exam_completion: ['user_id'], exam_completion_history: ['id'], flashcards: ['id'], flashcard_commands: ['user_id', 'request_key'], flashcard_draft_requests: ['id'], item_challenges: ['id'], learning_activities: ['id'],
  learning_log_commands: ['user_id', 'idempotency_key'], mock_appointments: ['id'], mock_outcomes: ['id'], mock_rehearsals: ['id'], mock_reports: ['id'], mock_report_commands: ['user_id', 'key'], non_negotiables: ['id'], onboarding_sessions: ['id'],
  paper_scope_snapshots: ['id'], plan_blocks: ['id'], plan_drafts: ['id'], planning_cycles: ['id'], practice_run_receipts: ['user_id', 'request_key'], practice_runs: ['id'],
  redistribution_receipts: ['id'], reminder_jobs: ['id'], reminder_prefs: ['user_id'], repair_check_threads: ['check_task_id', 'thread_id'], repair_queue: ['id'], repair_threads: ['id'],
  roadmap_milestones: ['id'], study_roadmaps: ['id'], task_create_receipts: ['key'], task_events: ['id'], task_execution_commands: ['task_id', 'expected_revision'], task_feedback: ['id'], task_scope_groups: ['id'],
  task_split_commands: ['task_id', 'expected_revision'], test_records: ['id'], user_entry_uncertainty: ['user_id', 'topic_id'], user_materials: ['id'], user_metrics: ['id'],
  user_module_state: ['user_id', 'lm_id'], user_rate_estimate: ['user_id'] /* one row per student, no primary key */, user_roles: ['user_id', 'role'], user_sources: ['id'],
  user_topic_exposure: ['user_id', 'topic_id'], weekly_reviews: ['id'], weekly_transition_drafts: ['id'],
}

/** Rows with no `user_id` that belong to the student through a parent row. */
export const PARENT_OWNED: { table: string; parent: string; fk: string; key: string[] }[] = [
  { table: 'repair_thread_events', parent: 'repair_threads', fk: 'thread_id', key: ['id'] },
  { table: 'class_session_items', parent: 'class_sessions', fk: 'session_id', key: ['id'] },
  { table: 'practice_run_sets', parent: 'practice_runs', fk: 'run_id', key: ['run_id', 'block_no'] },
  { table: 'source_mappings', parent: 'user_sources', fk: 'user_source_id', key: ['id'] },
]

/** Tables that reference people or owned rows but are deliberately NOT in the personal download, each with its reason. */
export const EXCLUDED_TABLES: Record<string, string> = {
  assessment_forms: 'PrepPlan-built paper forms (shared question content); your attempts and answers are included and name the form by id.',
  beta_invitations: 'Operational admission record; holds the invited address, not study data.',
  onboarding_drafts: 'Operational one-time setup claim; your saved setup is included.',
}

const NOT_INCLUDED = [
  'Question wording, answer keys and explanations: they are PrepPlan content, not your data. Your answers, confidence and results are included and refer to questions by id.',
  'PrepPlan-built paper forms, invitation and admission records (operational, not study data).',
  'Authentication secrets and tokens: never exported.',
  'Backups held by the database provider: they age out on the provider\'s schedule (see the privacy page).',
  'A one-way record that an account deletion happened, if you later delete the account.',
  'This is a download for you, not a backup you can re-import.',
]

const order = (key: string[]) => key
const page = (table: string, key: string[], filter: (q: any) => any) => readAll<any>((a, z) => {
  let q = filter(createAdminClient().from(table).select('*'))
  for (const k of order(key)) q = q.order(k, { ascending: true })
  return q.range(a, z)
})

/**
 * The student's own data as one JSON document. Read-only; reads only rows owned by `userId`. CONSISTENCY: each table is read page by page in key order,
 * one after another, while the account may still be changing, so this is NOT a single point-in-time snapshot: `startedAt`/`finishedAt` bound the reads and
 * `counts` records what each table returned. Any failed page throws, so a partial archive is never returned as complete.
 */
export async function buildExport(userId: string, email: string | null) {
  const startedAt = new Date().toISOString()
  const admin = createAdminClient()
  const { data: profile } = await admin.from('profiles').select('*').eq('id', userId).maybeSingle().throwOnError()
  const tables: Record<string, unknown[]> = {}
  for (const [t, key] of Object.entries(OWNED_TABLES)) tables[t] = await page(t, key, q => q.eq('user_id', userId))
  for (const c of PARENT_OWNED) {
    const parents = (tables[c.parent] as { id: string }[]).map(r => r.id)
    const rows: unknown[] = []
    for (let i = 0; i < parents.length; i += 100) rows.push(...await page(c.table, c.key, q => q.in(c.fk, parents.slice(i, i + 100))))
    tables[c.table] = rows
  }
  const counts = Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length]))
  return {
    schema: 'roadmap-export-2', startedAt, finishedAt: new Date().toISOString(), account: { id: userId, email }, profile, counts,
    consistency: 'Tables are read one after another while your account may be changing; this is not a single point-in-time snapshot.',
    tables, notIncluded: NOT_INCLUDED, excludedTables: EXCLUDED_TABLES,
  }
}
