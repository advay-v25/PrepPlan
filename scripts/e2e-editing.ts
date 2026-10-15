/**
 * C2 exit test.
 *
 * The phase's stated bar: "two devices cannot silently overwrite each other,
 * and every accepted change has a visible history." Both are checked here
 * against the live endpoints, plus conflict refusal, split, undo, and
 * commitment recurrence with exceptions.
 *
 *   npm run dev
 *   npx tsx scripts/e2e-editing.ts --reset
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import { DEFAULT_DIAGNOSTIC_DAY, resolveStudyWeek, type Weekday } from '../src/lib/planning/studyWeek'

dotenv.config({ path: '.env.local', quiet: true } as any)

import { getE2EEmail, verifyAndGetE2EUser, resetE2EUser, E2E_BASE_URL } from '../src/lib/testing/e2eIdentity'

const BASE = E2E_BASE_URL
const EMAIL = getE2EEmail()

let passed = 0, failed = 0
const check = (n: string, ok: boolean, d = '') => { ok ? (passed++, console.log(`  ✓ ${n}`)) : (failed++, console.log(`  ✗ ${n}${d ? ` — ${d}` : ''}`)) }

const jar = new Map<string, string>()
function store(res: Response) {
  for (const line of ((res.headers as any).getSetCookie?.() ?? []) as string[]) {
    const [pair] = line.split(';'); const i = pair.indexOf('=')
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim())
  }
}
async function req(path: string, init: RequestInit = {}) {
  const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
  const res = await fetch(`${BASE}${path}`, { ...init, redirect: 'manual', headers: { ...(init.headers ?? {}), ...(cookie ? { cookie } : {}) } })
  store(res); return res
}
async function json(path: string, init: RequestInit = {}) {
  const res = await req(path, init); const t = await res.text()
  try { return { status: res.status, body: JSON.parse(t) } } catch { return { status: res.status, body: { raw: t.slice(0, 200) } } }
}
const send = (m: string) => (p: string, b?: unknown) =>
  json(p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) })
const post = send('POST'), patch = send('PATCH'), del = send('DELETE')

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

async function main() {
  console.log(`\nC2 exit test: calendar editing against ${BASE}\n`)

  const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email: EMAIL })
  let path = `/auth/confirm?token_hash=${(link!.properties as any).hashed_token}&type=magiclink&next=/app/calendar`
  for (let i = 0; i < 5; i++) {
    const res = await req(path); const loc = res.headers.get('location')
    if (!loc) break
    const u = new URL(loc, BASE); path = u.pathname + u.search
    if (path.startsWith('/app')) break
  }
  check('signed in', path.startsWith('/app'))

  const uid = await verifyAndGetE2EUser(admin)

  if (process.argv.includes('--reset')) {
    await admin.from('task_events').delete().eq('user_id', uid)
    await admin.from('commitment_exceptions').delete().eq('user_id', uid)
    await admin.from('calendar_commitments').delete().eq('user_id', uid)
    await admin.from('plan_blocks').delete().eq('user_id', uid)
    console.log('  (reset)')
  }

  const { data: profile } = await admin.from('profiles').select('diagnostic_day, timezone').eq('id', uid).maybeSingle()
  const anchor = (profile?.diagnostic_day ?? DEFAULT_DIAGNOSTIC_DAY) as Weekday
  const week = resolveStudyWeek({ anchorDay: anchor, timezone: profile?.timezone || 'UTC' })
  const day = week.days[2]
  const otherDay = week.days[3]

  // --- Creating -----------------------------------------------------------
  console.log('\nCreating')
  const created = await post('/api/tasks', { title: 'Quant drill', date: day, startMinutes: 10 * 60, durationMinutes: 60 })
  check('a task can be created', created.body?.ok === true, JSON.stringify(created.body).slice(0, 160))
  const taskId = created.body?.task?.id
  if (!taskId) return finish()
  check('it starts at revision 1', created.body.task.revision === 1, `rev ${created.body.task.revision}`)
  check('creation is recorded in history',
    (await admin.from('task_events').select('event_type').eq('task_id', taskId)).data?.some(e => e.event_type === 'created') === true)

  const short = await post('/api/tasks', { title: 'x', date: day })
  check('a task with no real name is refused', short.status === 400)

  // --- Concurrency: the exit test ----------------------------------------
  console.log('\nTwo devices editing the same task')
  const deviceA = created.body.task.revision   // both read the same revision
  const deviceB = created.body.task.revision

  const first = await patch(`/api/tasks/${taskId}`, { action: 'move', date: day, startMinutes: 14 * 60, durationMinutes: 60, expectedRevision: deviceA })
  check('the first device saves', first.body?.ok === true, JSON.stringify(first.body).slice(0, 160))
  check('and the revision advances', first.body?.task?.revision > deviceA, `${deviceA} → ${first.body?.task?.revision}`)

  const second = await patch(`/api/tasks/${taskId}`, { action: 'move', date: otherDay, startMinutes: 9 * 60, durationMinutes: 60, expectedRevision: deviceB })
  check('the second device is refused, not silently applied', second.status === 409 && second.body?.code === 'REVISION_MISMATCH',
    `${second.status} ${JSON.stringify(second.body).slice(0, 120)}`)
  check('and is handed the version that won', second.body?.current?.revision === first.body?.task?.revision,
    `current rev ${second.body?.current?.revision}`)

  const { data: afterRace } = await admin.from('plan_blocks').select('local_date, starts_at').eq('id', taskId).maybeSingle()
  check('the losing write did not land', afterRace?.local_date === day, `landed on ${afterRace?.local_date}`)

  const retry = await patch(`/api/tasks/${taskId}`, { action: 'move', date: otherDay, startMinutes: 9 * 60, durationMinutes: 60, expectedRevision: second.body.current.revision })
  check('retrying with the current revision succeeds', retry.body?.ok === true)

  const noRev = await patch(`/api/tasks/${taskId}`, { action: 'move', date: day, startMinutes: 600 })
  check('a write without a revision is refused outright', noRev.status === 400)

  // --- Protected commitments ---------------------------------------------
  console.log('\nProtected commitments')
  const cls = await post('/api/commitments', {
    label: 'CFA class', kind: 'class', recurrence: 'weekly',
    weekdays: [new Date(`${day}T00:00:00Z`).getUTCDay()], startTime: '18:00', endTime: '20:00', startsOn: week.startDate,
  })
  check('a weekly class can be created', cls.body?.ok === true, JSON.stringify(cls.body).slice(0, 160))
  const classId = cls.body?.commitment?.id

  let rev = retry.body.task.revision
  const onTop = await patch(`/api/tasks/${taskId}`, { action: 'move', date: day, startMinutes: 18 * 60 + 30, durationMinutes: 60, expectedRevision: rev })
  check('dropping a task on the class is refused', onTop.status === 409 && onTop.body?.code === 'CONFLICT',
    `${onTop.status} ${JSON.stringify(onTop.body).slice(0, 140)}`)
  check('the refusal names what is in the way', (onTop.body?.conflicts ?? []).some((c: any) => c.title === 'CFA class'))
  check('and offers alternatives', (onTop.body?.suggestions ?? []).length > 0, JSON.stringify(onTop.body?.suggestions))
  check('none of the alternatives clash with the class',
    (onTop.body?.suggestions ?? []).every((s: any) => s.date !== day || s.start + 60 <= 18 * 60 || s.start >= 20 * 60),
    JSON.stringify(onTop.body?.suggestions))

  const { data: stillThere } = await admin.from('plan_blocks').select('local_date, revision').eq('id', taskId).maybeSingle()
  check('the refused move changed nothing', stillThere?.revision === rev, `rev ${stillThere?.revision}, expected ${rev}`)

  const beside = await patch(`/api/tasks/${taskId}`, { action: 'move', date: day, startMinutes: 20 * 60, durationMinutes: 60, expectedRevision: rev })
  check('placing it immediately after the class is allowed', beside.body?.ok === true, JSON.stringify(beside.body).slice(0, 140))
  rev = beside.body?.task?.revision ?? rev

  // --- Occurrence exceptions ---------------------------------------------
  console.log('\nOne-off changes to a series')
  const skip = await patch(`/api/commitments/${classId}`, { scope: 'occurrence', occurrenceDate: day, kind: 'skipped' })
  check('a single class can be cancelled', skip.body?.ok === true, JSON.stringify(skip.body).slice(0, 140))

  const nowFree = await patch(`/api/tasks/${taskId}`, { action: 'move', date: day, startMinutes: 18 * 60 + 30, durationMinutes: 60, expectedRevision: rev })
  check('the slot the cancelled class held is now free', nowFree.body?.ok === true, JSON.stringify(nowFree.body).slice(0, 140))
  rev = nowFree.body?.task?.revision ?? rev

  const { data: series } = await admin.from('calendar_commitments').select('weekdays, start_time, status').eq('id', classId).maybeSingle()
  check('cancelling one class left the series intact',
    series?.status === 'active' && series?.start_time?.startsWith('18:00'), JSON.stringify(series))

  // --- Splitting ----------------------------------------------------------
  console.log('\nSplitting')
  const beforeSplit = await admin.from('plan_blocks').select('duration_minutes').eq('id', taskId).maybeSingle()
  const originalDuration = beforeSplit.data?.duration_minutes ?? 0
  const splitRes = await patch(`/api/tasks/${taskId}`, { action: 'split', expectedRevision: rev })
  check('a task can be split', splitRes.body?.ok === true, JSON.stringify(splitRes.body).slice(0, 160))
  const secondId = splitRes.body?.secondId
  if (secondId) {
    const { data: halves } = await admin.from('plan_blocks').select('id, duration_minutes').in('id', [taskId, secondId])
    const total = (halves ?? []).reduce((s, h) => s + (h.duration_minutes ?? 0), 0)
    check('the two halves preserve the original scope', total === originalDuration, `${total} vs ${originalDuration}`)
    check('the split is recorded on the original',
      (await admin.from('task_events').select('event_type').eq('task_id', taskId)).data?.some(e => e.event_type === 'split') === true)
  }

  // --- Execution ----------------------------------------------------------
  console.log('\nRecording what happened')
  const { data: freshA } = await admin.from('plan_blocks').select('revision').eq('id', taskId).maybeSingle()
  const partial = await patch(`/api/tasks/${taskId}`, { action: 'execution', execution: 'partial', expectedRevision: freshA!.revision })
  check('a task can be marked partly done', partial.body?.ok === true, JSON.stringify(partial.body).slice(0, 140))
  check('partial is stored as partial, not rounded up', partial.body?.task?.execution === 'partial')

  const badExec = await patch(`/api/tasks/${taskId}`, { action: 'execution', execution: 'finished', expectedRevision: partial.body.task.revision })
  check('an unknown execution state is refused', badExec.status === 400)

  // --- Undo ---------------------------------------------------------------
  console.log('\nUndo')
  const undone = await patch(`/api/tasks/${taskId}`, { action: 'undo' })
  check('the last change can be undone', undone.body?.ok === true, JSON.stringify(undone.body).slice(0, 140))
  check('and it restores the previous state', undone.body?.task?.execution !== 'partial', `execution ${undone.body?.task?.execution}`)
  check('the undo itself is recorded',
    (await admin.from('task_events').select('event_type').eq('task_id', taskId)).data?.some(e => e.event_type === 'undone') === true)

  // --- History ------------------------------------------------------------
  console.log('\nVisible history')
  const detail = await json(`/api/tasks/${taskId}`)
  check('history is readable through the API', detail.body?.ok === true && Array.isArray(detail.body.history))
  const events: any[] = detail.body?.history ?? []
  check('every kind of change left a trace', events.length >= 5, `${events.length} events`)
  check('placement changes record what it was before',
    events.filter(e => e.event_type === 'placement_changed').every(e => e.previous && Object.keys(e.previous).length > 0))
  check('history is newest first',
    events.every((e, i) => i === 0 || new Date(events[i - 1].created_at) >= new Date(e.created_at)))

  // --- Validation ---------------------------------------------------------
  console.log('\nValue guards')
  const { data: freshB } = await admin.from('plan_blocks').select('revision').eq('id', taskId).maybeSingle()
  const tooLong = await patch(`/api/tasks/${taskId}`, { action: 'move', date: day, startMinutes: 10 * 60, durationMinutes: 400, expectedRevision: freshB!.revision })
  check('an absurdly long sitting is refused', tooLong.status === 400, JSON.stringify(tooLong.body).slice(0, 120))
  const badAction = await patch(`/api/tasks/${taskId}`, { action: 'teleport', expectedRevision: freshB!.revision })
  check('an unknown action is refused', badAction.status === 400)

  // --- Deleting -----------------------------------------------------------
  console.log('\nRemoving')
  const { data: freshC } = await admin.from('plan_blocks').select('revision').eq('id', taskId).maybeSingle()
  const staleDelete = await del(`/api/tasks/${taskId}?expectedRevision=${freshC!.revision - 1}`)
  check('deleting with a stale revision is refused', staleDelete.status === 409, `${staleDelete.status}`)
  const deleted = await del(`/api/tasks/${taskId}?expectedRevision=${freshC!.revision}`)
  check('deleting with the current revision works', deleted.body?.ok === true)
  check('and it is gone', (await admin.from('plan_blocks').select('id').eq('id', taskId).maybeSingle()).data === null)

  finish()
}

function finish() {
  console.log(`\n${passed} passed, ${failed} failed\n`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch(e => { console.error('\nCrashed:', e); process.exit(1) })
