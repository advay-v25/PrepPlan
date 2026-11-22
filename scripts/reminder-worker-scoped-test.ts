/**
 * The REAL reminder rules and claim guards (processClaimedReminders / syncReminders), exercised on ONE throwaway student's own jobs.
 * The global claim RPC is not used (it would claim every user's due jobs); this test claims its own rows exactly the way the RPC does (status sending + lease),
 * then runs the service. The transport is a controlled fake: no email is sent. Requires no server.
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'; dotenv.config({ path: '.env.local', quiet: true } as any)
import { createStudent, makeCheck } from './lib/e2eSession'
import { processClaimedReminders, syncReminders, savePrefs, loadPrefs, UncertainDelivery, reviewIsReady, type Transport } from '../src/lib/reminders/service'

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const { check, finish } = makeCheck()
const owned: string[] = []
const sent: string[] = []
const transport = (mode: 'ok' | 'reject' | 'uncertain' = 'ok'): Transport => ({ async send(m) { if (mode === 'reject') throw new Error('provider rejected (422)'); if (mode === 'uncertain') throw new UncertainDelivery('timeout after send'); sent.push(m.idempotencyKey); return { id: 'fake-1' } } })
const NOON = new Date('2026-11-17T12:00:00Z')   // 12:00 London in November
const NIGHT = new Date('2026-11-17T23:30:00Z')

;(async () => {
  try {
    const st = await createStudent(admin, 'rw', { onboard: true, register: id => owned.push(id) })
    const uid = st.id
    const tz = (await admin.from('profiles').select('timezone').eq('id', uid).single()).data!.timezone as string
    const appt = async (date: string) => (await admin.from('mock_appointments').insert({ user_id: uid, kind: 'provider_mock', planned_date: date, status: 'planned' }).select('id').single()).data!.id as string
    // claim exactly as claim_reminder_jobs does, for this student only
    const setPrefs = async (p: Record<string, unknown>) => { const r = await admin.from('reminder_prefs').update(p).eq('user_id', uid); if (r.error) throw r.error }
    const claim = async (id: string, leaseSeconds = 120) => (await admin.from('reminder_jobs').update({ status: 'sending', attempts: 1, lease_until: new Date(Date.now() + leaseSeconds * 1000).toISOString() }).eq('id', id).eq('status', 'pending').select('*').single()).data
    const job = async (kind: string, ref: string, key: string) => {
      const r = await admin.from('reminder_jobs').insert({ user_id: uid, kind, ref_id: ref, job_key: key, send_at: new Date(NOON.getTime() - 60_000).toISOString(), link: '/app/calendar', status: 'pending' }).select('id').single()
      if (!r.error) return r.data.id as string
      const ex = (await admin.from('reminder_jobs').update({ status: 'pending', cancelled_reason: null, lease_until: null }).eq('job_key', key).select('id').single()).data!   // the sync may already have created it
      return ex.id as string
    }
    const status = async (id: string) => (await admin.from('reminder_jobs').select('status, cancelled_reason, attempts, last_error').eq('id', id).single()).data!
    const run = async (id: string, now: Date, mode: 'ok' | 'reject' | 'uncertain' = 'ok') => processClaimedReminders(transport(mode), [await claim(id)], now)
    await savePrefs(uid, { assessmentReminders: true, weeklyReviewReminders: true, quietStart: '21:00', quietEnd: '08:00' })

    console.log('Mock reminders')
    const d = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10)   // inside the two-day scheduling window
    const far = new Date(Date.now() + 9 * 86_400_000).toISOString().slice(0, 10)
    let a = await appt(d); let j = await job('assessment_upcoming', a, `assessment_upcoming:${a}:${d}`)
    check('a planned mock, opted in, outside quiet hours: sent once with the job key as the idempotency key', (await run(j, NOON)).sent === 1 && sent.includes(`assessment_upcoming:${a}:${d}`) && (await status(j)).status === 'sent')
    a = await appt(d); j = await job('assessment_upcoming', a, `assessment_upcoming:${a}:${d}`)
    check('inside quiet hours (21:00–08:00 wraps midnight) it is held until they end, not sent', (await run(j, NIGHT)).later === 1 && (await status(j)).status === 'pending')
    const held = (await admin.from('reminder_jobs').select('send_at').eq('id', j).single()).data!.send_at as string
    check('and rescheduled to 08:00 local the next morning', new Date(held).toISOString() === '2026-11-18T08:00:00.000Z' || /T08:00:00\.000Z$/.test(new Date(held).toISOString()), held)
    await savePrefs(uid, { quietStart: '10:00', quietEnd: '10:00' })
    a = await appt(d); j = await job('assessment_upcoming', a, `assessment_upcoming:${a}:${d}`)
    check('equal start and end means no quiet period under the current policy: sent even at night', (await run(j, NIGHT)).sent === 1)
    await savePrefs(uid, { quietStart: '21:00', quietEnd: '08:00' })
    a = await appt(d); j = await job('assessment_upcoming', a, `assessment_upcoming:${a}:${d}`)
    await setPrefs({ quiet_start: '11:00', quiet_end: '13:00' })   // changed elsewhere after the job was created, before any sync
    check('quiet hours changed AFTER the job was created are honoured at send time (12:00 is now quiet)', (await run(j, NOON)).later === 1)
    await setPrefs({ quiet_start: '21:00', quiet_end: '08:00' })
    a = await appt(d); j = await job('assessment_upcoming', a, `assessment_upcoming:${a}:${d}`)
    await admin.from('mock_appointments').update({ planned_date: far }).eq('id', a)
    check('a mock moved to another date cancels the old-date job (no_longer_relevant)', (await run(j, NOON)).cancelled === 1 && (await status(j)).cancelled_reason === 'no_longer_relevant')
    await admin.from('mock_appointments').update({ planned_date: d }).eq('id', a)
    await syncReminders(uid)
    check('moved BACK to its original date, the same-key job is revived (not left cancelled) and then sends once', (await status(j)).status === 'pending' && (await run(j, NOON)).sent === 1)
    a = await appt(d); j = await job('assessment_upcoming', a, `assessment_upcoming:${a}:${d}`)
    await admin.from('mock_appointments').update({ status: 'cancelled' }).eq('id', a)
    check('a cancelled mock sends nothing', (await run(j, NOON)).cancelled === 1)

    console.log('\nPreferences, exam, review')
    a = await appt(d); j = await job('assessment_upcoming', a, `assessment_upcoming:${a}:${d}`)
    await setPrefs({ assessment_reminders: false })
    check('opt-out before send cancels (opted_out)', (await run(j, NOON)).cancelled === 1 && (await status(j)).cancelled_reason === 'opted_out')
    await setPrefs({ assessment_reminders: true })
    a = await appt(d); j = await job('assessment_upcoming', a, `assessment_upcoming:${a}:${d}`)
    await admin.from('exam_completion').upsert({ user_id: uid, sat_on: '2026-11-16' })
    const before = sent.length
    check('after "I sat the exam" nothing is sent (exam_complete)', (await run(j, NOON)).cancelled === 1 && sent.length === before)
    await admin.from('exam_completion').delete().eq('user_id', uid)
    const cyc = (await admin.from('planning_cycles').select('id, ends_at_local').eq('user_id', uid).eq('status', 'active').single()).data!
    j = await job('weekly_review_ready', cyc.id as string, `weekly_review_ready:${cyc.id}:${cyc.ends_at_local}`)
    check('a weekly-review reminder whose cycle is still ACTIVE but whose review gate is not ready is cancelled, not sent', await (async () => { const t = await run(j, new Date()); const st2 = await status(j); return t.cancelled === 1 && st2.cancelled_reason === 'no_longer_relevant' })(), JSON.stringify(await status(j)))
    check('reviewIsReady: only a ready gate for that same cycle counts', !reviewIsReady(null, 'c') && !reviewIsReady({ status: 'active', cycle: { id: 'c' }, gate: { kind: 'not_ready' } } as any, 'c') && reviewIsReady({ status: 'active', cycle: { id: 'c' }, gate: { kind: 'paper_scored' } } as any, 'c') && !reviewIsReady({ status: 'active', cycle: { id: 'other' }, gate: { kind: 'paper_scored' } } as any, 'c'))

    console.log('\nDelivery outcomes and claims')
    a = await appt(d); j = await job('assessment_upcoming', a, `assessment_upcoming:${a}:${d}`)
    const rej = await run(j, NOON, 'reject'); const sr = await status(j)
    check('a known provider rejection is a failure that returns to pending with the error recorded', rej.failed === 1 && sr.status === 'pending' && /rejected/.test(sr.last_error ?? ''))
    a = await appt(d); j = await job('assessment_upcoming', a, `assessment_upcoming:${a}:${d}`)
    const un = await run(j, NOON, 'uncertain')
    check('an uncertain delivery is recorded as uncertain', un.uncertain === 1 && (await status(j)).status === 'uncertain')
    const again = await claim(j)
    check('and an uncertain job is never claimed or re-sent automatically', again === null)
    // PROVIDER ACCEPTED, THEN THE RECORD IS LOST: the transport succeeds, but while it is in flight the job row stops being the 'uncertain' dispatch marker
    // (a concurrent writer / failed persistence). The worker must NOT turn the job back into something re-sendable, and must report it as uncertain.
    a = await appt(d); j = await job('assessment_upcoming', a, `assessment_upcoming:${a}:${d}`)
    const sentBefore = sent.length
    const during = await status(j); void during
    const lossy: Transport = { async send(m) { sent.push(m.idempotencyKey); await admin.from('reminder_jobs').update({ status: 'cancelled', cancelled_reason: 'concurrent' }).eq('id', j); return { id: 'prov-1' } } }
    const lost = await processClaimedReminders(lossy, [await claim(j)], NOON)
    check('provider accepted but the outcome could not be recorded: counted as uncertain, never as a retryable failure', lost.uncertain === 1 && lost.failed === 0 && sent.length === sentBefore + 1)
    check('and a later claim never picks it up, so it cannot be sent again', (await claim(j)) === null && (await status(j)).status !== 'pending')
    // the dispatch marker itself: while the provider call is in flight the job is already NOT claimable, and a crash there leaves it visibly uncertain ("dispatching").
    a = await appt(d); j = await job('assessment_upcoming', a, `assessment_upcoming:${a}:${d}`)
    let inFlight: { status: string; last_error: string | null } | null = null, claimable: unknown = 'unset'
    const peek: Transport = { async send(m) { sent.push(m.idempotencyKey); inFlight = await status(j); claimable = await claim(j); throw new UncertainDelivery('timeout after the request left') } }
    await processClaimedReminders(peek, [await claim(j)], NOON)
    check('during the provider call the job is a durable "dispatching" marker that no other worker can claim', inFlight!.status === 'uncertain' && inFlight!.last_error === 'dispatching' && claimable === null, JSON.stringify(inFlight))
    check('a timeout after acceptance ends uncertain with the not-retried message', (await status(j)).status === 'uncertain' && /not retried/.test((await status(j)).last_error ?? ''))
    a = await appt(d); j = await job('assessment_upcoming', a, `assessment_upcoming:${a}:${d}`)
    const claimA = await claim(j, 1)                       // worker A, lease about to expire
    await new Promise(r => setTimeout(r, 1500))
    await admin.from('reminder_jobs').update({ lease_until: new Date(Date.now() + 120_000).toISOString() }).eq('id', j)   // worker B re-claimed after expiry (new lease)
    const late = await processClaimedReminders(transport(), [claimA], NOON)
    check('a late worker whose lease was replaced cannot overwrite the newer claim (lostClaim, status unchanged)', late.lostClaim >= 1 && late.sent === 0 && (await status(j)).status === 'sending')
    const before2 = sent.length
    a = await appt(d); j = await job('assessment_upcoming', a, `assessment_upcoming:${a}:${d}`)
    const c1 = await claim(j), c2 = await claim(j)
    check('two workers cannot both claim one pending job', !!c1 && c2 === null)
    await processClaimedReminders(transport(), [c1], NOON)
    check('exactly one send happened for that job', sent.length === before2 + 1)

    console.log('\nPreference writes')
    const r = await savePrefs(uid, { weeklyReviewReminders: false, quietStart: '22:15' })
    check('a patch writes only its fields and returns the saved row with sync state', r.prefs?.weeklyReviewReminders === false && r.prefs?.quietStart === '22:15' && r.prefs?.assessmentReminders === true && r.sync === 'ok')
    let bad = false; try { await savePrefs(uid, { quietEnd: '7am' }) } catch { bad = true }
    check('an invalid time is rejected and nothing changes', bad && (await loadPrefs(uid)).quietEnd === '08:00')

    console.log('\nAccount deletion before send')
    a = await appt(d); j = await job('assessment_upcoming', a, `assessment_upcoming:${a}:${d}`)
    const claimed = await claim(j)
    await admin.auth.admin.deleteUser(uid); owned.splice(0)
    const gone = await processClaimedReminders(transport(), [claimed], NOON)
    check('a job claimed before the account was deleted sends nothing', gone.sent === 0 && !sent.includes(`assessment_upcoming:${a}:${d}`))
  } finally {
    for (const id of owned.splice(0)) { const r = await admin.auth.admin.deleteUser(id); if (r.error) console.error('CLEANUP FAILED', r.error.message) }
  }
  finish()
})().catch(async e => { console.error('Crashed:', e); for (const id of owned.splice(0)) await admin.auth.admin.deleteUser(id).catch(() => {}); process.exit(1) })
