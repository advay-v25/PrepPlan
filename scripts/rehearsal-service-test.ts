/** Fault injection through the real Supabase transport; no hosted reads or writes. */
import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'
import { getRehearsal, settleRehearsal, syncRehearsalStatus } from '../src/lib/rehearsal/service'

const savedFetch = globalThis.fetch
const savedUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const savedKey = process.env.SUPABASE_SECRET_KEY
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1'
process.env.SUPABASE_SECRET_KEY = 'test-only-key'
const calls: string[] = []
let fault = 'count'
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input)), table = url.pathname.split('/').at(-1)!
  const method = init?.method ?? 'GET'
  calls.push(`${method} ${table}`)
  if (table === 'assessment_responses') {
    if (fault === 'count') return json({ message: 'answer count unavailable' }, 503)
    return new Response(null, { status: 200, headers: fault === 'null-count' ? {} : { 'Content-Range': '0-0/1' } })
  }
  if (table === 'finalize_assessment_attempt') return json({ message: 'finalization unavailable' }, 503)
  if (method === 'PATCH') {
    if (table === 'mock_appointments' && fault === 'appointment') return json({ message: 'appointment unavailable' }, 503)
    return new Response(null, { status: 204 })
  }
  if (table === 'assessment_attempts') return json(fault === 'appointment' || fault === 'retry'
    ? [{ status: 'scored' }, { status: 'expired' }]
    : [{ id: 'attempt', session_no: 1, status: 'in_progress', deadline_at: '2027-01-01T00:00:00Z' }])
  if (table === 'mock_rehearsals') return json({ id: 'rehearsal', status: 'complete', appointment_id: 'appointment' })
  if (table === 'assessment_forms') return json([])
  throw new Error(`Unexpected request: ${method} ${table}`)
}

try {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, 'test-only-key', { auth: { persistSession: false } })
  for (const failure of ['count', 'null-count', 'finalize']) {
    fault = failure; calls.length = 0
    await assert.rejects(settleRehearsal(db, 'student', 'rehearsal', new Date('2027-01-02')), /unavailable|Could not count/)
    assert.ok(!calls.some(c => c.startsWith('PATCH')), 'a failed count/finalization must not expire or complete anything')
  }
  fault = 'count'; calls.length = 0
  await assert.rejects(getRehearsal('student', 'rehearsal'), /answer count unavailable/)
  assert.ok(!calls.some(c => c.startsWith('PATCH')), 'a failed state read is not zero answered')
  fault = 'appointment'
  await assert.rejects(syncRehearsalStatus('student', 'rehearsal'), /appointment unavailable/)
  fault = 'retry'; calls.length = 0
  await syncRehearsalStatus('student', 'rehearsal')
  assert.ok(calls.includes('PATCH mock_appointments'), 'completion retries even when the rehearsal is already complete')
  console.log('PASS rehearsal service: count/null/finalization failures, honest state reads, appointment retry')
} finally {
  globalThis.fetch = savedFetch
  if (savedUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = savedUrl
  if (savedKey === undefined) delete process.env.SUPABASE_SECRET_KEY; else process.env.SUPABASE_SECRET_KEY = savedKey
}
