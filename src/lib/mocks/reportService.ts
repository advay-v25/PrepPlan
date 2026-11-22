import { randomUUID } from 'node:crypto'
import { createAdminClient } from '../supabase/admin'
import { readAll } from '../supabase/readAll'
import { todayInZone } from '../planning/studyWeek'
import { parseReportInput, rowToReport, type MockReport, type MockReportInput } from './report'
import { profileTimezone } from '../ops/sharedReads'

/** Owner-checked, idempotent commands over public.mock_reports. Every call carries the authenticated student's id from the route; the database re-checks. */
export class ReportError extends Error { constructor(message: string, readonly code: string, readonly status: number, readonly extra?: Record<string, unknown>) { super(message); this.name = 'ReportError' } }

const STATUS: Record<string, [number, string]> = {
  NOT_FOUND: [404, 'That report was not found.'], WITHDRAWN: [409, 'That report was withdrawn.'], KEY_REUSED: [409, 'That retry does not match the action it was started with. Nothing was changed.'],
  STALE_VERSION: [409, 'The report changed on another screen or device. Reload it and apply your edit again; nothing was overwritten.'], STALE: [409, 'The plan you reviewed is out of date. Review the updated plan; nothing was changed.'],
}

async function timezoneOf(userId: string) {
  return (await profileTimezone(userId)) ?? 'UTC'
}

export function validKey(key: unknown): key is string { return typeof key === 'string' && key.length >= 8 && key.length <= 80 && /^[A-Za-z0-9._:-]+$/.test(key) }

export async function saveReport(userId: string, a: { action: 'create' | 'edit' | 'withdraw'; key: string; reportId?: string | null; expectedVersion?: number | null; input?: MockReportInput }): Promise<{ report: MockReport; replayed: boolean }> {
  if (!validKey(a.key)) throw new ReportError('Missing or invalid request key.', 'INVALID', 400)
  let payload: Record<string, unknown> = {}
  if (a.action !== 'withdraw') {
    const parsed = parseReportInput(a.input, todayInZone(await timezoneOf(userId)))
    if (!parsed.ok) throw new ReportError(parsed.message, 'INVALID', 400)
    payload = parsed.payload
  }
  const { data, error } = await createAdminClient().rpc('save_mock_report', { p_user: userId, p_key: a.key, p_action: a.action, p_report_id: a.reportId ?? null, p_expected_version: a.expectedVersion ?? null, p_payload: payload })
  if (error) console.error('[save_mock_report]', error.message)
  if (error || !data) throw new ReportError('Save not confirmed. Nothing was partly applied; send it again with the same request, or check Calendar first.', 'SAVE_UNCONFIRMED', 503)
  const r = data as any
  if (r.ok === true) return { report: rowToReport(r.report), replayed: Boolean(r.replayed) }
  const [status, message] = STATUS[String(r.code)] ?? [r.code === 'INVALID' ? 400 : 409, String(r.message ?? 'That could not be applied.')]
  throw new ReportError(String(r.message ?? message), String(r.code), status, r.currentVersion ? { currentVersion: r.currentVersion } : undefined)
}

export async function getReport(userId: string, id: string): Promise<MockReport | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null
  const { data } = await createAdminClient().from('mock_reports').select('*').eq('id', id).eq('user_id', userId).maybeSingle().throwOnError()
  return data ? rowToReport(data) : null
}

export async function listReports(userId: string, includeWithdrawn = false): Promise<MockReport[]> {
  const admin = createAdminClient()
  const rows = await readAll<any>((a, z) => { let q = admin.from('mock_reports').select('*').eq('user_id', userId); if (!includeWithdrawn) q = q.eq('status', 'active'); return q.order('taken_on', { ascending: false }).order('id').range(a, z) })
  return rows.map(rowToReport)
}

/** Old free-text "taken" mock outcomes that have no structured report yet: offered for optional structuring. Their original text is shown, never parsed or rewritten. */
export async function listUnstructuredOutcomes(userId: string) {
  const admin = createAdminClient()
  const [outcomes, reports] = await Promise.all([
    readAll<any>((a, z) => admin.from('mock_outcomes').select('id, planned_date, actual_date, kind, label, reported_result, notes').eq('user_id', userId).eq('outcome', 'taken').order('id').range(a, z)),
    readAll<any>((a, z) => admin.from('mock_reports').select('id, legacy_outcome_id').eq('user_id', userId).not('legacy_outcome_id', 'is', null).order('id').range(a, z)),
  ])
  const done = new Set(reports.map(r => r.legacy_outcome_id as string))
  return outcomes.filter(o => !done.has(o.id as string)).map(o => ({ id: o.id as string, date: (o.actual_date ?? o.planned_date) as string, label: (o.label ?? null) as string | null, reportedResult: (o.reported_result ?? null) as string | null, notes: (o.notes ?? null) as string | null }))
}

export const newKey = () => randomUUID()
