import { createAdminClient } from '../supabase/admin'
import { loadExamStatus } from '../exam/status'
import { listAppointments, type AppointmentSummary } from '../planning/checkpointService'
import { getWeeklyReviewState } from '../planning/weeklyReview/service'
import { desiredReminders, sendDecision, type Prefs } from './rules'

/** The complete current review gate (the same one the weekly review reads), not merely "the cycle is still active". */
export function reviewIsReady(review: Awaited<ReturnType<typeof getWeeklyReviewState>> | null, cycleId: string | null): boolean {
  return !!review && review.status === 'active' && (cycleId === null || review.cycle.id === cycleId) && ['paper_scored', 'external_mock', 'rehearsal', 'no_paper_allowed'].includes(review.gate.kind)
}
export type Transport = { send(m: { to: string; subject: string; text: string; link: string; idempotencyKey: string }): Promise<{ id: string }> }
/** Thrown by a transport when it cannot tell whether the message was delivered (timeout after the request left). Never auto-retried. */
export class UncertainDelivery extends Error {}

const DEFAULT_PREFS: Prefs = { assessmentReminders: false, weeklyReviewReminders: false, quietStart: '21:00', quietEnd: '08:00' }
export async function loadPrefs(userId: string): Promise<Prefs> {
  // A failed read is an error, never "the defaults" (which would read as opted out).
  const { data, error } = await createAdminClient().from('reminder_prefs').select('assessment_reminders, weekly_review_reminders, quiet_start, quiet_end').eq('user_id', userId).maybeSingle()
  if (error) throw new Error('Your reminder choices could not be read.')
  return data ? { assessmentReminders: !!data.assessment_reminders, weeklyReviewReminders: !!data.weekly_review_reminders, quietStart: String(data.quiet_start).slice(0, 5), quietEnd: String(data.quiet_end).slice(0, 5) } : DEFAULT_PREFS
}
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
/** Is a sender configured? Preferences save either way; delivery only happens when this is true and the worker runs. */
export const deliveryConfigured = () => Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL)

/**
 * Atomic PATCH: only the supplied fields are written, in one upsert (INSERT .. ON CONFLICT DO UPDATE SET <supplied columns>; unsupplied columns on a
 * first insert take the table defaults, which equal DEFAULT_PREFS). There is no read-modify-write, so two tabs changing different fields cannot lose each other.
 * The saved row is then re-read. Reconciling the reminder jobs is a separate, retryable step: if it fails the preference STAYS saved and `sync` says so.
 */
export async function savePrefs(userId: string, p: Partial<Prefs>): Promise<{ prefs: Prefs | null; sync: 'ok' | 'pending' | 'unknown' }> {
  if ((p.quietStart && !HHMM.test(p.quietStart)) || (p.quietEnd && !HHMM.test(p.quietEnd))) throw new Error('Quiet hours must look like 21:00.')
  const row: Record<string, unknown> = { user_id: userId, updated_at: new Date().toISOString() }
  if (p.assessmentReminders !== undefined) row.assessment_reminders = p.assessmentReminders
  if (p.weeklyReviewReminders !== undefined) row.weekly_review_reminders = p.weeklyReviewReminders
  if (p.quietStart !== undefined) row.quiet_start = p.quietStart
  if (p.quietEnd !== undefined) row.quiet_end = p.quietEnd
  const { error } = await createAdminClient().from('reminder_prefs').upsert(row, { onConflict: 'user_id' })
  if (error) throw new Error('Your reminder choices could not be saved. Nothing was changed.')
  // The write has COMMITTED. A failed re-read is "saved, response unconfirmed" (prefs null), never a failed save; the caller reloads.
  let prefs: Prefs
  try { prefs = await loadPrefs(userId) } catch (e) { console.error('[reminders] re-read after save', (e as Error).message); return { prefs: null, sync: 'unknown' } }
  try {
    if (!prefs.assessmentReminders && !prefs.weeklyReviewReminders) { await cancelAll(userId, 'opted_out'); return { prefs, sync: 'ok' } }
    // An unreadable source (exam, appointments, review state) means the follow-up did not run: saved, follow-up pending, never a manufactured "ok".
    return { prefs, sync: (await syncReminders(userId)).unknown ? 'unknown' : 'ok' }
  } catch (e) { console.error('[reminders] sync after save', (e as Error).message); return { prefs, sync: 'pending' } }
}
async function cancelAll(userId: string, reason: string) {
  const { error } = await createAdminClient().from('reminder_jobs').update({ status: 'cancelled', cancelled_reason: reason, updated_at: new Date().toISOString() }).eq('user_id', userId).in('status', ['pending', 'sending'])
  if (error) throw error   // the caller reports saved-but-follow-up-pending
}

/** Brings this student's pending reminders in line with their plan RIGHT NOW: creates what is wanted (idempotent by job key), cancels what is obsolete. */
export async function syncReminders(userId: string, now = new Date()) {
  const admin = createAdminClient()
  const prefs = await loadPrefs(userId)
  const { data: p } = await admin.from('profiles').select('timezone').eq('id', userId).maybeSingle().throwOnError()
  const tz = (p?.timezone as string) || 'UTC'
  // A source that cannot be read is UNKNOWN, not "no appointment / exam not sat / review not ready": on any failure change nothing (no cancel, no create, no revive).
  const scheduled: Promise<AppointmentSummary[]> = prefs.assessmentReminders ? listAppointments(userId, 0) : Promise.resolve([])
  const inputs = await Promise.all([
    loadExamStatus(userId, now),
    scheduled,
    prefs.weeklyReviewReminders ? getWeeklyReviewState(userId, now) : null,
  ] as const).catch(() => null)
  if (!inputs) return { wanted: 0, cancelled: 0, unknown: true }
  const [exam, appointments, review] = inputs
  const appts = appointments.filter(a => a.status === 'planned')
  const reviewReady = reviewIsReady(review, review && review.status === 'active' ? review.cycle.id : null)
  const want = desiredReminders({
    now, tz, prefs, examSat: exam?.phase === 'sat',
    appointments: appts.map(a => ({ id: a.id, title: a.title, date: a.date, internal: a.kind === 'internal_rehearsal', href: a.rehearsal?.primary?.href ?? a.href })),
    review: review && review.status === 'active' ? { cycleId: review.cycle.id, endsAt: review.cycle.endsAt, ready: reviewReady } : null,
  })
  const keys = new Set(want.map(w => w.jobKey))
  const { data: open } = await admin.from('reminder_jobs').select('id, job_key').eq('user_id', userId).eq('status', 'pending').throwOnError()
  for (const o of open ?? []) if (!keys.has(o.job_key as string)) await admin.from('reminder_jobs').update({ status: 'cancelled', cancelled_reason: 'obsolete', updated_at: now.toISOString() }).eq('id', o.id as string).eq('status', 'pending').throwOnError()
  for (const w of want) {
    // Identity is the job key: an existing job (sent, cancelled or pending) is never duplicated; only a pending one follows a new send time.
    const { error } = await admin.from('reminder_jobs').insert({ user_id: userId, kind: w.kind, ref_id: w.refId, job_key: w.jobKey, send_at: w.sendAt.toISOString(), link: w.link })
    if (error && error.code === '23505') {
      await admin.from('reminder_jobs').update({ send_at: w.sendAt.toISOString(), link: w.link, updated_at: now.toISOString() }).eq('job_key', w.jobKey).eq('status', 'pending').throwOnError()
      // Opting back in (or moving a mock back to its date) revives a job that only OUR cancellation (opt-out / obsolete / no longer relevant) stopped; a sent, uncertain or exam-sat job is never revived, so nothing is sent twice.
      await admin.from('reminder_jobs').update({ status: 'pending', cancelled_reason: null, send_at: w.sendAt.toISOString(), link: w.link, updated_at: now.toISOString() }).eq('user_id', userId).eq('job_key', w.jobKey).eq('status', 'cancelled').in('cancelled_reason', ['opted_out', 'obsolete', 'no_longer_relevant']).throwOnError()
    } else if (error) throw error
  }
  return { wanted: want.length, cancelled: (open ?? []).filter(o => !keys.has(o.job_key as string)).length, unknown: false }
}

/** Sends what is due. Each job is claimed by exactly one worker; relevance is re-checked from live state; delivery outcome is recorded as it really was. */
export async function runDueReminders(transport: Transport, now = new Date(), limit = 25) {
  const { data: jobs, error } = await createAdminClient().rpc('claim_reminder_jobs', { p_limit: limit, p_lease_seconds: 120 })
  if (error) throw error
  return processClaimedReminders(transport, (jobs ?? []) as any[], now)
}

/**
 * The per-job rules, separated from the global claim so they can be exercised on one student's own claimed jobs. Every state change is guarded by the claim's
 * lease: a worker whose lease expired (and whose job another worker re-claimed) cannot overwrite the newer claim's outcome.
 */
export async function processClaimedReminders(transport: Transport, jobs: any[], now = new Date()) {
  const admin = createAdminClient()
  const tally = { sent: 0, cancelled: 0, later: 0, failed: 0, uncertain: 0, lostClaim: 0 }
  for (const j of jobs) {
    const set = async (patch: Record<string, unknown>) => {
      let q = admin.from('reminder_jobs').update({ ...patch, updated_at: new Date().toISOString(), lease_until: null }).eq('id', j.id).eq('status', 'sending')
      if (j.lease_until) q = q.eq('lease_until', j.lease_until)
      const r = await q.select('id'); if (r.error) throw r.error
      if (!(r.data ?? []).length) { tally.lostClaim++; return false }
      return true
    }
    try {
      const sync = await syncReminders(j.user_id, now)
      if (sync.unknown) { if (await set({ status: 'pending', send_at: new Date(now.getTime() + 10 * 60_000).toISOString(), attempts: Math.max(0, j.attempts - 1), last_error: 'plan state unreadable; held, not decided' })) tally.later++; continue }
      const { data: fresh } = await admin.from('reminder_jobs').select('status, lease_until').eq('id', j.id).maybeSingle().throwOnError()
      if (fresh?.status !== 'sending' || (j.lease_until && fresh.lease_until !== j.lease_until)) { tally.lostClaim++; continue }
      const { data: prof } = await admin.from('profiles').select('timezone').eq('id', j.user_id).maybeSingle().throwOnError()
      const prefs = await loadPrefs(j.user_id), exam = await loadExamStatus(j.user_id, now)    // a failed read throws: the job returns to pending, nothing is decided
      const optedIn = j.kind === 'assessment_upcoming' ? prefs.assessmentReminders : prefs.weeklyReviewReminders
      const stillPlanned = await stillWanted(j.user_id, j.job_key, now)
      const d = sendDecision({ prefsOk: optedIn, stillPlanned, examSat: exam?.phase === 'sat', now, tz: (prof?.timezone as string) || 'UTC', quiet: prefs })
      if (d.action === 'cancel') { if (await set({ status: 'cancelled', cancelled_reason: d.reason })) tally.cancelled++; continue }
      if (d.action === 'later') { if (await set({ status: 'pending', send_at: d.at.toISOString(), attempts: Math.max(0, j.attempts - 1) })) tally.later++; continue }
      const { data: u } = await admin.auth.admin.getUserById(j.user_id)
      if (!u?.user?.email) { if (await set({ status: 'failed', last_error: 'no email address' })) tally.failed++; continue }
      const text = await describe(j)
      // DISPATCH BOUNDARY. One atomic, lease-guarded write moves the job out of anything a worker can claim BEFORE the provider is called: 'uncertain' with
      // last_error 'dispatching' means "handed to the provider, outcome not yet recorded". A worker whose lease already expired (and whose job was re-claimed) fails
      // this write and sends nothing. From here a crash, a timeout or a failed recording can never lead to an automatic resend: the job stays visible as uncertain.
      // The provider idempotency key narrows duplicates but is not relied on for exactly-once; a mail the provider accepted cannot be recalled.
      if (!(await set({ status: 'uncertain', last_error: 'dispatching' }))) continue
      const settle = async (patch: Record<string, unknown>) => {      // the record of what the provider said: retried, never allowed to re-send
        for (let i = 0; i < 3; i++) {
          const r = await admin.from('reminder_jobs').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', j.id).eq('status', 'uncertain').select('id')
          if (!r.error) return (r.data ?? []).length > 0
        }
        return false
      }
      let accepted: { id?: string | null } | null = null, failure: Error | null = null
      try { accepted = await transport.send({ to: u.user.email, subject: text.subject, text: text.body, link: j.link, idempotencyKey: j.job_key }) } catch (e) { failure = e as Error }
      if (!failure) { if (await settle({ status: 'sent', sent_at: new Date().toISOString(), provider_id: accepted?.id ?? null, last_error: null })) tally.sent++; else { tally.uncertain++; console.error('[reminders] delivered but could not be recorded; left uncertain, not retried', j.id) } }
      else if (failure instanceof UncertainDelivery) { await settle({ last_error: 'delivery could not be confirmed; not retried automatically' }); tally.uncertain++ }
      else {   // a definite provider refusal: nothing was accepted, so a retry is safe
        const retry = j.attempts < 3
        if (await settle({ status: retry ? 'pending' : 'failed', send_at: new Date(now.getTime() + 10 * 60_000).toISOString(), last_error: String(failure.message).slice(0, 200) })) tally.failed++
        else { tally.uncertain++; console.error('[reminders] refusal could not be recorded; left uncertain, not retried', j.id) }
      }
    } catch (e) {
      console.error('[reminders] job error', j.id, (e as Error).message)
      let q = admin.from('reminder_jobs').update({ status: 'pending', lease_until: null, last_error: String((e as Error).message).slice(0, 200), updated_at: new Date().toISOString() }).eq('id', j.id).eq('status', 'sending')
      if (j.lease_until) q = q.eq('lease_until', j.lease_until)
      await q
      tally.failed++
    }
  }
  return tally
}

async function stillWanted(userId: string, jobKey: string, now: Date): Promise<boolean> {
  const admin = createAdminClient()
  const kind = jobKey.split(':')[0], ref = jobKey.split(':')[1]
  if (kind === 'assessment_upcoming') {
    const date = jobKey.split(':')[2]
    const { data } = await admin.from('mock_appointments').select('id').eq('id', ref).eq('user_id', userId).eq('status', 'planned').eq('planned_date', date).maybeSingle().throwOnError()
    return !!data
  }
  // Weekly review: the actual current gate for THAT cycle, re-evaluated now (an active cycle alone is not eligibility). A read failure throws.
  return reviewIsReady(await getWeeklyReviewState(userId, now), ref)
}
async function describe(j: any): Promise<{ subject: string; body: string }> {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? ''
  const admin = createAdminClient()
  let subject = j.kind === 'weekly_review_ready' ? 'Your weekly review is ready' : 'Coming up in PrepPlan', line = ''
  if (j.kind === 'assessment_upcoming') {
    const { data: a } = await admin.from('mock_appointments').select('label, kind, planned_date').eq('id', j.ref_id).maybeSingle()
    if (a) { subject = `Coming up: ${a.label ?? (a.kind === 'internal_rehearsal' ? 'PrepPlan rehearsal' : 'your mock')} on ${a.planned_date}`; line = `${a.label ?? 'Your mock'} is planned for ${a.planned_date}.` }
  } else line = 'Your week has ended and the review is ready. It takes a few minutes and sets up next week.'
  return { subject, body: `${line}\n\nOpen it: ${base}${j.link}\n\nYou are getting this because you turned reminders on. Turn them off any time in Settings.` }
}
