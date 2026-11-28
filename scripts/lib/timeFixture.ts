/**
 * TIME FIXTURE (test-only). The application reads the real clock, so "a week later" cannot be waited for. This moves ONE run-owned student's whole
 * recorded history back by an exact number of whole weeks (weekday-preserving), in one transaction, so cycles, task dates, event timestamps, evidence
 * and repair history all stay consistent with each other and "today" simply falls later in the student's story.
 *
 * What it can prove: the application's own eligibility rules (re-check spacing, cycle containment, closure) answering from consistent older history.
 * What it cannot prove: that a real calendar week elapsed, any cron/reminder recurrence, or anything about other students.
 * It writes ONLY dated columns, including the dated plan-time field `repair_threads.next_recheck_due_at` (shifted together with everything else, never set independently to force eligibility). It never writes a status, a score or an answer. Class-specific dates ARE shifted too (class_sessions.class_date, calendar_commitments recurrence bounds and timestamps, commitment_exceptions, mock_appointments); the trigger bypass means constraints enforced by triggers on those tables are not exercised by the shift. It disables triggers for the transaction
 * (session_replication_role = replica) because history triggers rightly refuse to edit superseded work; that bypass is confined to the student id passed in.
 */
import { createRequire } from 'node:module'
import path from 'node:path'
// createRequire from the project root works under both tsx (ESM) and Playwright's CommonJS transpile.
const { connect } = createRequire(path.join(process.cwd(), 'package.json'))('./scripts/db.cjs') as { connect: () => { connect(): Promise<void>; query(q: string, p?: unknown[]): Promise<{ rows: any[]; rowCount: number }>; end(): Promise<void> } }

type Spec = { table: string; where: string; ts?: string[]; date?: string[]; extra?: string }
const SPECS: Spec[] = [
  { table: 'planning_cycles', where: 'user_id = $1', ts: ['starts_at', 'ends_at', 'created_at'], date: ['starts_at_local', 'ends_at_local'] },
  { table: 'plan_blocks', where: 'user_id = $1', ts: ['starts_at', 'cancelled_at'], date: ['local_date'], extra: "day = case when local_date is null then day else (local_date - $2::int)::text end" },
  { table: 'task_events', where: 'user_id = $1', ts: ['created_at'],
    extra: "payload = case when payload->>'kind' = 'learning_log' and payload->>'local_date' is not null then jsonb_set(payload, '{local_date}', to_jsonb((payload->>'local_date')::date - $2::int)) else payload end" },
  { table: 'evidence_events', where: 'user_id = $1', ts: ['created_at'] },
  { table: 'assessment_attempts', where: 'user_id = $1', ts: ['started_at', 'completed_at', 'submitted_at', 'deadline_at', 'result_viewed_at'] },
  { table: 'assessment_responses', where: 'user_id = $1', ts: ['created_at', 'answered_at'] },
  { table: 'repair_threads', where: 'user_id = $1', ts: ['latest_evidence_at', 'next_recheck_due_at', 'created_at', 'updated_at', 'latest_check_at', 'closed_at'] },
  { table: 'repair_thread_events', where: 'thread_id in (select id from public.repair_threads where user_id = $1)', ts: ['created_at'] },
  { table: 'repair_check_threads', where: 'user_id = $1', ts: ['created_at'] },
  { table: 'coach_proposals', where: 'user_id = $1', ts: ['created_at', 'executed_at', 'applied_at', 'decided_at', 'expires_at'], date: ['target_week_start', 'target_week_end'] },
  { table: 'weekly_reviews', where: 'user_id = $1', ts: ['closed_at', 'created_at'] },
  { table: 'weekly_transition_drafts', where: 'user_id = $1', ts: ['created_at', 'expires_at'] },
  { table: 'cycle_assessment_choices', where: 'user_id = $1', ts: ['decided_at'], date: ['week_start'] },
  { table: 'paper_scope_snapshots', where: 'user_id = $1', ts: ['created_at'] },
  { table: 'learning_activities', where: 'user_id = $1', ts: ['created_at'] },
  { table: 'learning_log_commands', where: 'user_id = $1', ts: ['created_at'] },
  { table: 'planned_log_commands', where: 'user_id = $1', ts: ['created_at'] },
  { table: 'block_scope_confirmations', where: 'user_id = $1', ts: ['created_at'] },
  { table: 'task_execution_commands', where: 'user_id = $1', ts: ['created_at'] },
  // Class-led journeys: taught occurrences, recurrence bounds and exceptions move with the cycles so "which class was in which week" is preserved.
  { table: 'class_sessions', where: 'user_id = $1', ts: ['logged_at'], date: ['class_date'] },
  { table: 'calendar_commitments', where: 'user_id = $1', ts: ['starts_at', 'ends_at', 'created_at'], date: ['starts_on', 'ends_on'] },
  { table: 'commitment_exceptions', where: 'user_id = $1', ts: ['created_at'], date: ['occurrence_date', 'new_date'] },
  { table: 'mock_appointments', where: 'user_id = $1', ts: ['created_at', 'updated_at'], date: ['planned_date'] },
]

export type TimeShiftReceipt = { userId: string; days: number; at: string; tables: Record<string, number> }

export async function shiftStudentTimeline(userId: string, weeks: number, owned: string[]): Promise<TimeShiftReceipt> {
  if (!owned.includes(userId)) throw new Error('time fixture refused: not a run-owned student')
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > 8) throw new Error('time fixture refused: whole weeks only (1–8)')
  const days = weeks * 7
  const c = connect(); await c.connect()
  const tables: Record<string, number> = {}
  try {
    await c.query('begin'); await c.query('set local session_replication_role = replica'); await c.query("set local timezone = 'UTC'")   // whole-day shifts of instants must not depend on the connection's zone (DST)
    for (const sp of SPECS) {
      const sets = [...(sp.ts ?? []).map(x => `${x} = ${x} - make_interval(days => $2::int)`), ...(sp.date ?? []).map(x => `${x} = ${x} - $2::int`), ...(sp.extra ? [sp.extra] : [])]
      if (!sets.length) continue
      tables[sp.table] = (await c.query(`update public.${sp.table} set ${sets.join(', ')} where ${sp.where}`, [userId, days])).rowCount
    }
    await c.query('commit')
  } catch (e) { await c.query('rollback').catch(() => {}); throw e } finally { await c.end() }
  return { userId, days, at: new Date().toISOString(), tables }
}
