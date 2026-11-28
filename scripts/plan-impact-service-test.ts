/** Production impact reader over a controlled PostgREST transport. No hosted writes. */
import assert from 'node:assert/strict'
import { saveWithPlanImpact } from '../src/lib/onboarding/planImpact'
import { addDays } from '../src/lib/planning/studyWeek'
const oldFetch = globalThis.fetch, oldUrl = process.env.NEXT_PUBLIC_SUPABASE_URL, oldKey = process.env.SUPABASE_SECRET_KEY
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1'; process.env.SUPABASE_SECRET_KEY = 'test-only'
const today = new Date().toISOString().slice(0, 10), target = addDays(today, 1)
let version = 10, committed = false, missingCount = false, failProfile = false
globalThis.fetch = async input => {
  const u = new URL(String(input)), table = u.pathname.split('/').at(-1)
  const reply = (v: unknown) => Response.json(v)
  if (table === 'profiles') return failProfile ? Response.json({ message: 'profile unavailable' }, { status: 503 }) : reply({ onboarding_status: 'complete', onboarding_context_version: version, timezone: 'UTC', class_pattern: 'none' })
  if (table === 'planning_cycles') return reply([{ status: 'active', starts_at_local: today, ends_at_local: addDays(today, 6), timezone: 'UTC' }])
  if (table === 'calendar_commitments') return reply(u.searchParams.has('limit') ? null : [])
  if (table === 'commitment_exceptions' || table === 'mock_appointments') return reply([])
  if (table === 'availability_windows') return reply(Array.from({ length: 7 }, (_, weekday) => committed
    ? [{ weekday, start_time: '09:00', end_time: '09:30' }, { weekday, start_time: '11:00', end_time: '11:30' }]
    : [{ weekday, start_time: '09:00', end_time: '11:00' }]).flat())
  if (table === 'plan_blocks') {
    if (u.searchParams.get('select') === 'id') return new Response(null, { headers: missingCount ? {} : { 'Content-Range': '0-3/4' } })
    let rows = [
      { local_date: target, duration_minutes: 30, execution: 'not_started', placement: 'day_preferred', starts_at: null, cancelled_at: null, learning_activity_id: null },
      { local_date: target, duration_minutes: 45, execution: 'deferred', placement: 'day_preferred', starts_at: null, cancelled_at: null, learning_activity_id: null },
      { local_date: target, duration_minutes: 45, execution: 'cancelled', placement: 'day_preferred', starts_at: null, cancelled_at: new Date().toISOString(), learning_activity_id: null },
      { local_date: target, duration_minutes: 45, execution: 'completed', placement: 'day_preferred', starts_at: null, cancelled_at: null, learning_activity_id: 'logged-activity' },
    ]
    if (u.searchParams.get('cancelled_at') === 'is.null') rows = rows.filter(r => !r.cancelled_at)
    if (u.searchParams.get('learning_activity_id') === 'is.null') rows = rows.filter(r => !r.learning_activity_id)
    if (u.searchParams.get('execution')?.startsWith('not.in.')) rows = rows.filter(r => !['completed', 'skipped', 'deferred', 'cancelled'].includes(r.execution))
    return reply(rows)
  }
  throw Error(`Unexpected transport request: ${table}`)
}
try {
  const receipt: { version?: number } = {}
  const impact = await saveWithPlanImpact('student', async () => { committed = true; receipt.version = ++version }, receipt)
  assert.ok(impact && !('unavailable' in impact))
  assert.deepEqual(impact.overflowDays, [], 'deferred, cancelled and logged history do not occupy future study gaps')
  assert.equal(version, 11, 'impact reads cannot repeat the authoritative save')
  missingCount = true
  assert.deepEqual(await saveWithPlanImpact('student', async () => { version++ }), { unavailable: true }, 'a missing count is not an empty accepted week')
  assert.equal(version, 12)
  missingCount = false; failProfile = true
  assert.deepEqual(await saveWithPlanImpact('student', async () => { version++ }), { unavailable: true }, 'a failed profile read is not a first-time setup')
  assert.equal(version, 13, 'optional read failures leave one authoritative save')
  console.log('PASS plan impact: active work only, fragmented gaps, one committed version')
} finally {
  globalThis.fetch = oldFetch
  if (oldUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = oldUrl
  if (oldKey === undefined) delete process.env.SUPABASE_SECRET_KEY; else process.env.SUPABASE_SECRET_KEY = oldKey
}
