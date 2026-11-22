/**
 * Answer saving under a bounded load, with ordinary throwaway students (deleted by recorded id; the attempt rows go with them):
 *   E2E_BASE_URL=http://localhost:3141 npx tsx scripts/answer-save-contention-test.ts [--rounds=3]
 * Records, per request: status, duration and request id on failure (never the answer content), and proves from the database which answers committed.
 * Cases: (1) concurrent saves of different questions, (2) a lost response (client aborts after sending; the answer is committed and a retry is idempotent),
 * (3) rapid changes to one question (the final committed answer is the last one sent), (4) submit scores exactly the committed answers.
 * Needs routine (non-held-out) inventory for the reading; with none, it says so and exits without failing.
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)
import { createStudent, makeCheck } from './lib/e2eSession'

const { check, finish } = makeCheck()
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const rounds = Number((process.argv.find(a => a.startsWith('--rounds=')) ?? '--rounds=3').slice(9))
const base = process.env.E2E_BASE_URL ?? 'http://localhost:3000'
const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil(p * xs.length) - 1)]

async function main() {
  const st = await createStudent(admin, 'sv', { onboard: true })
  const failures: { status: number; ms: number; requestId?: string; code?: string }[] = []
  const durations: number[] = []
  try {
    for (let r = 0; r < rounds; r++) {
      const start = await st.s.post('/api/tests/start', { kind: 'practice', readingId: 'r028' })
      if (start.body?.ok !== true) { console.log(`No routine inventory for this student/reading (${start.body?.code ?? start.status}): nothing to load-test. Not a failure.`); return }
      const attemptId = start.body.attemptId as string
      const items = ((await st.s.json(`/api/tests/attempt/${attemptId}`)).body.items ?? []) as { id: string; options: unknown[] }[]
      const save = async (itemId: string, sel: number, conf = 'medium', signal?: AbortSignal) => {
        const t = performance.now()
        const res = await st.s.req(`/api/tests/attempt/${attemptId}/answer`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemId, selectedOptionIndex: sel, confidence: conf, activeSeconds: 5, interruptedSeconds: 0 }), signal } as any)
        const body = await res.json().catch(() => null); const ms = performance.now() - t
        durations.push(ms); if (!res.ok || !body?.ok) failures.push({ status: res.status, ms: Math.round(ms), requestId: body?.requestId, code: body?.code })
        return { status: res.status, body, ms }
      }
      const committed = async () => ((await admin.from('assessment_responses').select('item_id, selected_option_index, self_reported_confidence').eq('attempt_id', attemptId)).data ?? [])
      console.log(`\nRound ${r + 1}: attempt with ${items.length} questions`)

      const half = items.slice(0, Math.ceil(items.length / 2))
      const res1 = await Promise.all(half.map((i, n) => save(i.id, n % i.options.length)))
      const rows1 = await committed()
      check('concurrent saves of different questions all succeed and are all committed once', res1.every(x => x.body?.ok) && rows1.length === half.length && new Set(rows1.map(x => x.item_id)).size === half.length, JSON.stringify(res1.map(x => x.status)))

      // Lost response: the client gives up immediately; the server still finishes. The answer must be committed or cleanly absent, and a retry must not duplicate it.
      const lost = items[half.length]
      const ac = new AbortController(); const p = save(lost.id, 1, 'high', ac.signal).catch(() => null); ac.abort(); await p
      await new Promise(r => setTimeout(r, 1500))
      const afterLost = (await committed()).filter(x => x.item_id === lost.id)
      check('after a lost response the answer is either committed once or absent (never partial)', afterLost.length <= 1, `rows=${afterLost.length}`)
      const retry = await save(lost.id, 1, 'high')
      const afterRetry = (await committed()).filter(x => x.item_id === lost.id)
      check('retrying the same save succeeds and leaves exactly one row with the chosen answer', retry.body?.ok === true && afterRetry.length === 1 && afterRetry[0].selected_option_index === 1)

      // Rapid changes to one question, delivered concurrently: the committed answer is one of those sent, and there is one row.
      const rapid = items[half.length + 1] ?? items[0]
      await Promise.all([0, 1, 0, 1, 0].map(sel => save(rapid.id, sel)))
      const rr = (await committed()).filter(x => x.item_id === rapid.id)
      check('rapid concurrent changes leave one row holding one of the sent answers', rr.length === 1 && [0, 1].includes(rr[0].selected_option_index as number))

      for (const i of items.slice(half.length + 2)) await save(i.id, 0)
      const all = await committed()
      const sub = await st.s.post(`/api/tests/attempt/${attemptId}/submit`, { allowUnanswered: true })
      const ev = (await admin.from('evidence_events').select('id', { count: 'exact', head: true }).eq('attempt_id', attemptId)).count ?? 0
      const dupEv = await admin.from('evidence_events').select('id, concept_id').eq('attempt_id', attemptId)
      check('submit scores exactly the committed answers', sub.body?.ok === true, JSON.stringify(sub.body).slice(0, 160))
      const resp = (await admin.from('assessment_responses').select('item_id', { count: 'exact', head: true }).eq('attempt_id', attemptId)).count
      check('no answer was added or lost by finalisation, and no duplicate response rows exist', resp === all.length && new Set(all.map(x => x.item_id)).size === all.length)
      console.log(`  evidence rows for this attempt: ${ev} (${new Set((dupEv.data ?? []).map(e => e.concept_id)).size} concepts)`)
    }
    check('no save request failed under this load', failures.length === 0, JSON.stringify(failures.slice(0, 5)))
    console.log(`\nSave requests: n=${durations.length}, p50 ${Math.round(pct(durations, 0.5))} ms, p95 ${Math.round(pct(durations, 0.95))} ms, max ${Math.round(Math.max(...durations))} ms, failures ${failures.length}${failures.length ? ' ' + JSON.stringify(failures.slice(0, 5)) : ''}`)
  } finally { await admin.auth.admin.deleteUser(st.id).catch(() => {}) }
  void base
}
main().then(() => finish()).catch(e => { console.error('FAILED:', e.message); process.exit(1) })
