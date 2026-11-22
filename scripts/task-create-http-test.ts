/** Phase 7B §2: the manual-task receipt contract through the ACTUAL route, and (separately) a database commit whose RPC reply is lost before the service
 *  sees it. Owned throwaway students only; cleanup is by recorded ids.
 *    E2E_BASE_URL=http://localhost:3172 npx tsx scripts/task-create-http-test.ts */
import { randomUUID } from 'node:crypto'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)
import { createAdminClient } from '../src/lib/supabase/admin'
import { createStudent, preflightServer, makeCheck } from './lib/e2eSession'
import { addDays, todayInZone } from '../src/lib/planning/studyWeek'
import { createManualTask } from '../src/lib/planning/taskService'

const db = createAdminClient(), { check, finish } = makeCheck(), owned: string[] = []
const rows = async (uid: string, title: string) => (await db.from('plan_blocks').select('id, title, execution, revision, local_date, cancelled_at').eq('user_id', uid).eq('title', title)).data ?? []
const events = async (id: string) => (await db.from('task_events').select('id').eq('task_id', id).eq('event_type', 'created')).data?.length ?? 0
const receipts = async (key: string) => (await db.from('task_create_receipts').select('key, request, result').eq('key', key)).data ?? []

async function main() {
  await preflightServer()
  const a = await createStudent(db, 'p7tc', { onboard: true, register: id => owned.push(id) })
  const b = await createStudent(db, 'p7tcb', { onboard: true, register: id => owned.push(id) })
  const cyc = (await db.from('planning_cycles').select('id, timezone, starts_at_local, ends_at_local').eq('user_id', a.id).eq('status', 'active').single().throwOnError()).data!
  const today = todayInZone(cyc.timezone), day = today > cyc.ends_at_local ? today : today
  const base = (title: string, extra: Record<string, unknown> = {}) => ({ title, date: day, startMinutes: null, durationMinutes: 30, ...extra })

  // 1 create once, response treated as lost, same key + payload again
  const k1 = randomUUID(), T1 = `Receipt one ${k1.slice(0, 6)}`
  const first = await a.s.post('/api/tasks', { key: k1, ...base(T1, { detail: 'original detail' }) })
  const again = await a.s.post('/api/tasks', { key: k1, ...base(T1, { detail: 'original detail' }) })
  const r1 = await rows(a.id, T1)
  check('create, lose the reply, retry: one task, one creation event, one receipt; the retry says it replayed', first.body.ok && !first.body.replayed && again.body.ok && again.body.replayed === true && r1.length === 1 && (await events(r1[0].id)) === 1 && (await receipts(`task-${k1}`)).length === 1)
  check('both answers name the same task', first.body.task.id === again.body.task.id && again.body.task.id === `task-${k1}`)

  // 2 mismatches refuse and write nothing
  const before = (await db.from('plan_blocks').select('id', { count: 'exact', head: true }).eq('user_id', a.id)).count
  const variants: [string, Record<string, unknown>][] = [['title', { title: `${T1} x` }], ['detail', { detail: 'other' }], ['priority', { priority: 'optional' }], ['start time', { startMinutes: 19 * 60 }], ['duration', { durationMinutes: 45 }]]
  for (const [what, v] of variants) {
    const r = await a.s.post('/api/tasks', { key: k1, ...base(T1, { detail: 'original detail' }), ...v })
    check(`a different ${what} under the same key is refused (409 KEY_REUSED), nothing written`, r.status === 409 && r.body.code === 'KEY_REUSED' && (await db.from('plan_blocks').select('id', { count: 'exact', head: true }).eq('user_id', a.id)).count === before, JSON.stringify(r.body).slice(0, 120))
  }
  const other = await b.s.post('/api/tasks', { key: k1, ...base(T1, { detail: 'original detail' }) })
  check("another student cannot use this student's key", other.status === 409 && other.body.code === 'KEY_REUSED' && (await rows(b.id, T1)).length === 0)

  // 3 replay after supported commands
  const T2 = `Receipt two ${k1.slice(0, 6)}`, k2 = randomUUID()
  const c2 = await a.s.post('/api/tasks', { key: k2, ...base(T2) })
  const id2 = c2.body.task.id as string
  const done = await a.s.json(`/api/tasks/${id2}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'execution', execution: 'completed', expectedRevision: c2.body.task.revision, actualDurationMinutes: 20 }) })
  const rp = await a.s.post('/api/tasks', { key: k2, ...base(T2) })
  const row2 = (await rows(a.id, T2))[0]
  check('after the task is completed, the retry returns the ORIGINAL creation and the task stays completed', done.body.ok && rp.body.replayed === true && rp.body.task.execution === 'not_started' && rp.body.current?.execution === 'completed' && row2.execution === 'completed' && (await rows(a.id, T2)).length === 1)
  const del = await a.s.json(`/api/tasks/${id2}?expectedRevision=${row2.revision}`, { method: 'DELETE' })
  const rd = await a.s.post('/api/tasks', { key: k2, ...base(T2) })
  const gone = (await rows(a.id, T2)).filter(r => !r.cancelled_at)
  check('after the task is cancelled or deleted, the retry replays with the original result and does NOT bring it back', del.body.ok && rd.body.replayed === true && rd.body.task.title === T2 && gone.length === 0, JSON.stringify({ del: del.body, current: rd.body.current?.cancelled_at ?? rd.body.current }).slice(0, 200))
  check('its receipt and creation history survive the deletion', (await receipts(`task-${k2}`)).length === 1)

  // 4 a later booking does not defeat a known replay, but a new key over it is refused with links
  const T3 = `Receipt three ${k1.slice(0, 6)}`, k3 = randomUUID(), slot = 20 * 60
  const c3 = await a.s.post('/api/tasks', { key: k3, ...base(T3, { startMinutes: slot, acceptWarnings: true }) })
  await db.from('calendar_commitments').insert({ user_id: a.id, label: 'Late booking', kind: 'other', recurrence: 'none', status: 'active', is_protected: true, starts_at: new Date(`${day}T00:00:00Z`).toISOString(), ends_at: new Date(`${day}T23:59:00Z`).toISOString() })
  const rb = await a.s.post('/api/tasks', { key: k3, ...base(T3, { startMinutes: slot, acceptWarnings: true }) })
  check('a booking added later does not turn a known replay into a refusal', c3.body.ok && rb.body.ok && rb.body.replayed === true, JSON.stringify(rb.body).slice(0, 160))
  const fresh = await a.s.post('/api/tasks', { key: randomUUID(), ...base(`Over the booking ${k1.slice(0, 6)}`, { startMinutes: slot, acceptWarnings: true }) })
  check('a NEW key over that protected time is refused with the booking named and nothing written', fresh.status === 409 && fresh.body.code === 'CONFLICT' && Array.isArray(fresh.body.conflicts) && fresh.body.conflicts.length > 0, JSON.stringify(fresh.body).slice(0, 200))

  // 5 two tabs, one key
  const T4 = `Receipt four ${k1.slice(0, 6)}`, k4 = randomUUID()
  const both = await Promise.all([a.s.post('/api/tasks', { key: k4, ...base(T4) }), a.s.post('/api/tasks', { key: k4, ...base(T4) })])
  const r4 = await rows(a.id, T4)
  check('the same key from two tabs at once gives one task, one creation event and one receipt; both tabs get that task', both.every(x => x.body.ok) && new Set(both.map(x => x.body.task.id)).size === 1 && both.filter(x => !x.body.replayed).length === 1 && r4.length === 1 && (await events(r4[0].id)) === 1 && (await receipts(`task-${k4}`)).length === 1, JSON.stringify(both.map(x => x.body.replayed)))

  // 6 refusals that must survive
  const past = await a.s.post('/api/tasks', { key: randomUUID(), ...base('Yesterday', { date: addDays(today, -1) }) })
  check('a past day is still refused', past.status === 400 && past.body.code === 'PAST')
  const sys = await a.s.post('/api/tasks', { key: randomUUID(), ...base('Sneaky repair', { taskType: 'repair' }) })
  check('a system type is still refused', sys.status === 400 && sys.body.code === 'BAD_TYPE' && (await rows(a.id, 'Sneaky repair')).length === 0)
  const badKey = await a.s.post('/api/tasks', { key: 'not-a-key', ...base('No key') })
  check('a malformed key is refused before anything is read or written', badKey.status === 400)

  // 7 the database COMMITS and the reply is lost before the service sees it (service layer, scoped to this call)
  const realFetch = globalThis.fetch, T5 = `Receipt five ${k1.slice(0, 6)}`, k5 = `task-${randomUUID()}`
  let hit = 0
  globalThis.fetch = (async (input: any, init: any) => {
    const u = typeof input === 'string' ? input : input?.url ?? String(input)
    const res = await realFetch(input, init)
    if (/rpc\/apply_task_create/.test(u) && hit++ === 0) { await res.text(); throw new TypeError('fetch failed') }
    return res
  }) as typeof fetch
  let unknown: any = null
  try { await createManualTask(a.id, { key: k5, title: T5, date: day, startMinutes: null, durationMinutes: 30, acceptWarnings: true }) } catch (e) { unknown = e } finally { globalThis.fetch = realFetch }
  const committed = await rows(a.id, T5)
  check('a committed write whose reply was lost is reported as UNKNOWN, never as "nothing was added"', unknown?.code === 'OUTCOME_UNKNOWN' && unknown?.status === 502 && !/nothing was (added|changed)/i.test(unknown?.message ?? ''), String(unknown?.message))
  check('...and the database really did commit it (task, event, receipt)', committed.length === 1 && (await events(committed[0].id)) === 1 && (await receipts(k5)).length === 1)
  const replay = await createManualTask(a.id, { key: k5, title: T5, date: day, startMinutes: null, durationMinutes: 30, acceptWarnings: true })
  check('retrying under the same key returns the saved task, still one row', replay.needsConfirmation === false && replay.replayed === true && (await rows(a.id, T5)).length === 1)

  // 8 no accepted cycle: refused, never an orphan
  await db.from('planning_cycles').update({ status: 'closed' }).eq('id', cyc.id)
  const nc = await a.s.post('/api/tasks', { key: randomUUID(), ...base('No cycle task') })
  const known = await a.s.post('/api/tasks', { key: k1, ...base(T1, { detail: 'original detail' }) })
  check('with no accepted plan week a new task is refused (409 NO_CYCLE) and nothing is written', nc.status === 409 && nc.body.code === 'NO_CYCLE' && (await rows(a.id, 'No cycle task')).length === 0, JSON.stringify(nc.body).slice(0, 120))
  check('...but a key already saved still replays', known.body.ok && known.body.replayed === true)
}
main().then(() => finish()).catch(e => { console.error(e); process.exitCode = 1 }).finally(async () => { for (const id of owned) await db.auth.admin.deleteUser(id).catch(() => {}); console.log(`cleanup: ${owned.length} owned student(s) removed`) })
