/**
 * Rehearsal start under concurrency. Two explicit tracks (printed up front):
 *   fixture bank:  npx tsx scripts/rehearsal-start-race-test.ts --confirm-target=<ref> --bank=<fixture-bank record from `npm run fixture:bank -- create … --rehearsal=auto`>
 *   actual bank:   npx tsx scripts/rehearsal-start-race-test.ts --confirm-target=<ref>
 * Ordinary throwaway students, deleted by recorded id. The fixture record is validated, never created or removed here.
 * The forced interleaving uses the `betweenReads` seam: a competing start reserves BOTH forms after this request read "no open rehearsal"
 * and before it loads the (now smaller) held-out pool.
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import fs from 'node:fs'
dotenv.config({ path: '.env.local', quiet: true } as any)
import { createStudent, makeCheck } from './lib/e2eSession'
import { declareBank } from './lib/bankMode'
import { startRehearsal, decideRehearsal } from '../src/lib/rehearsal/service'

const { check, finish } = makeCheck()
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const arg = (k: string) => (process.argv.find(a => a.startsWith(`--${k}=`)) ?? '').split('=').slice(1).join('=')
const made: string[] = []
const addDays = (d: string, n: number) => new Date(new Date(`${d}T12:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10)
const today = new Date().toISOString().slice(0, 10)

async function appt(uid: string, n: number, over: Record<string, unknown> = {}) {
  const r = await admin.from('mock_appointments').insert({ user_id: uid, kind: 'internal_rehearsal', planned_date: addDays(today, n), label: `Rehearsal ${n}`, ...over }).select('id').single()
  if (r.error) throw new Error(r.error.message)
  return r.data!.id as string
}
const rows = async (uid: string) => ({
  rehearsals: ((await admin.from('mock_rehearsals').select('id, status, appointment_id').eq('user_id', uid)).data ?? []),
  attempts: ((await admin.from('assessment_attempts').select('id, rehearsal_id, session_no, started_at, deadline_at, form_id').eq('user_id', uid).not('rehearsal_id', 'is', null)).data ?? []),
})

async function main() {
  const bankFile = arg('bank')
  const target = arg('confirm-target')
  if (!target || target !== process.env.NEXT_PUBLIC_SUPABASE_URL!.replace(/^https:\/\/|\.supabase\.co.*$/g, '')) throw new Error('Pass --confirm-target=<the disposable project ref>.')
  let fixtureItems: string[] = []
  if (bankFile) {
    await declareBank(admin, 'rehearsal-start-race', [], 0, 'heldout')   // validates the WHOLE record (held-out pool, all present, reviewed, fixture-only) or exits
    fixtureItems = (JSON.parse(fs.readFileSync(bankFile, 'utf8')).items ?? []).map((i: any) => (typeof i === 'string' ? i : i.id))
  } else console.log(`Track: ACTUAL bank (no fixture record). Target ${target}.`)

  try {
    const st = await createStudent(admin, 'rr', { onboard: true }); made.push(st.id)
    const cap = (await decideRehearsal(st.id, null)).decision
    console.log(`Eligibility for this student: state=${cap.state}, fresh held-out=${cap.freshHeldOut}`)

    if (!bankFile) {
      console.log('\nActual bank: a genuine shortfall starts nothing and says why')
      const a = await appt(st.id, 3)
      const r = await startRehearsal(st.id, a)
      check('insufficient coverage is reported, not started', !r.ok && r.code === 'insufficient' && /Nothing was started/.test(r.message), JSON.stringify(r).slice(0, 160))
      const x = await rows(st.id)
      check('no rehearsal, form or attempt was created', x.rehearsals.length === 0 && x.attempts.length === 0)
      const own = await decideRehearsal(st.id, a)
      check('the decision offers a useful next step (Calendar)', !!own.decision.next?.href && own.decision.reasons.length > 0)
      return
    }
    if (cap.state !== 'start') throw new Error(`Fixture track needs a held-out pool that can build a rehearsal; this student's decision is ${cap.state} (${cap.freshHeldOut} fresh). The fixture record does not cover every topic.`)

    console.log('\n1. Forced interleaving: a competing start reserves inside the gap')
    const a1 = await appt(st.id, 3)
    let winner: Awaited<ReturnType<typeof startRehearsal>> | null = null
    const loser = await startRehearsal(st.id, a1, async () => { winner = await startRehearsal(st.id, a1) })
    check('the competing start reserved a rehearsal', winner !== null && (winner as any).ok === true, JSON.stringify(winner))
    check('the losing request resolves the same open rehearsal instead of reporting a shortfall', loser.ok === true && (loser as any).rehearsalId === (winner as any)?.rehearsalId && (loser as any).resumed === true, JSON.stringify(loser).slice(0, 200))
    const x1 = await rows(st.id)
    check('exactly one rehearsal, two forms, two attempts', x1.rehearsals.length === 1 && x1.attempts.length === 2 && new Set(x1.attempts.map(a => a.form_id)).size === 2 && new Set(x1.attempts.map(a => a.session_no)).size === 2)
    check('both session clocks are unset (no deadline until a session is started)', x1.attempts.every(a => a.deadline_at === null))
    if (fixtureItems.length) {
      const used = ((await admin.from('form_items').select('item_id').in('form_id', x1.attempts.map(a => a.form_id))).data ?? []).map(r => r.item_id as string)
      const fx = new Set(fixtureItems)
      check('the reserved forms use the intended fixture items', used.length > 0 && used.every(i => fx.has(i)), `${used.filter(i => fx.has(i)).length} of ${used.length} are fixture items`)
    }

    console.log('\n2. Many concurrent starts on a fresh appointment')
    for (const n of [4, 5]) {
      const a = await appt(st.id, n + 10)
      await admin.from('mock_rehearsals').update({ status: 'cancelled' }).eq('user_id', st.id).neq('appointment_id', a)   // free the held-out pool for the next round
      const res = await Promise.all([1, 2, 3, 4, 5].map(() => startRehearsal(st.id, a)))
      const ids = new Set(res.map(r => (r as any).rehearsalId))
      const mine = (await rows(st.id)).rehearsals.filter(r => r.appointment_id === a)
      check(`round ${n - 3}: all five concurrent starts return ONE rehearsal`, res.every(r => r.ok) && ids.size === 1 && mine.length === 1, JSON.stringify(res.map(r => r.ok ? 'ok' : (r as any).code)))
    }

    console.log('\n3. Other appointments and ownership')
    const other = await createStudent(admin, 'rr2', { onboard: true }); made.push(other.id)
    const foreign = await appt(other.id, 6)
    const f = await startRehearsal(st.id, foreign)
    check('another student’s appointment is refused and creates nothing for either', !f.ok && (await rows(other.id)).rehearsals.length === 0 && (await rows(st.id)).rehearsals.every(r => r.appointment_id !== foreign))
    const cancelled = await appt(st.id, 7, { status: 'cancelled' })
    const c = await startRehearsal(st.id, cancelled)
    check('a cancelled appointment is closed, not started', !c.ok && c.code === 'closed')
    const before = await rows(st.id)
    const second = await appt(st.id, 8)
    const s2 = await startRehearsal(st.id, second)
    const after = await rows(st.id)
    check('a second appointment never resumes the first’s reservation and leaves its forms alone', (!s2.ok || (s2 as any).rehearsalId !== before.rehearsals[0]?.id) && before.attempts.every(a => after.attempts.some(b => b.id === a.id && b.form_id === a.form_id)), JSON.stringify(s2).slice(0, 160))
  } finally {
    for (const id of made) {
      const att = ((await admin.from('assessment_attempts').select('id, form_id').eq('user_id', id)).data ?? [])
      const ids = att.map(a => a.id as string), forms = att.map(a => a.form_id as string)
      if (ids.length) { await admin.from('assessment_responses').delete().in('attempt_id', ids); await admin.from('evidence_events').delete().in('attempt_id', ids); await admin.from('assessment_attempts').delete().in('id', ids) }
      if (forms.length) { await admin.from('form_items').delete().in('form_id', forms); await admin.from('assessment_forms').delete().in('id', forms) }
      await admin.from('mock_rehearsals').delete().eq('user_id', id)
      await admin.auth.admin.deleteUser(id).catch(() => {})
    }
  }
}
main().then(() => finish()).catch(e => { console.error('FAILED:', e.message); process.exit(1) })
