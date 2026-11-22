/**
 * Answer write ordering (fixture student, own dev server):  E2E_BASE_URL=http://localhost:3141 npx tsx scripts/answer-ordering-test.ts
 * A choice that reaches the server AFTER a newer committed choice must not replace it. Each choice carries `clientSeq` (the runner's monotonic
 * stamp). Asserts the stored answer and confidence in the owned attempt read, after a fresh read, and in the submitted result.
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)
import { createStudent, makeCheck } from './lib/e2eSession'

const { check, finish } = makeCheck()
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const LEVEL = { low: 1, medium: 3, high: 5 } as const

async function main() {
  const st = await createStudent(admin, 'ord', { onboard: true })
  try {
    const start = await st.s.post('/api/tests/start', { kind: 'practice', readingId: 'r028' })
    if (start.body?.ok !== true) { console.log(`UNAVAILABLE: no routine inventory (${start.body?.code ?? start.status}).`); return }
    const attemptId = start.body.attemptId as string
    const read = async () => ((await st.s.json(`/api/tests/attempt/${attemptId}`)).body.items ?? []) as { id: string; answer: { selected: number; confidence: string } | null }[]
    const items = await read()
    const send = (itemId: string, sel: number, conf: keyof typeof LEVEL, seq?: number) => st.s.post(`/api/tests/attempt/${attemptId}/answer`, { itemId, selectedOptionIndex: sel, confidence: conf, activeSeconds: 5, interruptedSeconds: 0, ...(seq === undefined ? {} : { clientSeq: seq }) })
    const row = async (id: string) => (await admin.from('assessment_responses').select('selected_option_index, self_reported_confidence, changed_count').eq('attempt_id', attemptId).eq('item_id', id)).data ?? []
    const T = Date.now() * 1000

    console.log('1. Answer edit: A (older) arrives after B (newer, committed)')
    const [q1, q2, q3, q4, q5] = items
    await send(q1.id, 0, 'medium', T + 1)
    const b = await send(q1.id, 1, 'medium', T + 3)
    const lateA = await send(q1.id, 2, 'medium', T + 2)
    let r = await row(q1.id)
    check('the late older answer is refused as stale, with the stored answer returned', lateA.status === 409 && lateA.body?.code === 'stale_answer' && lateA.body?.current?.selected === 1, JSON.stringify(lateA.body).slice(0, 160))
    check('the committed newer answer B is what is stored', b.body?.ok === true && r.length === 1 && r[0].selected_option_index === 1)
    check('...and in the owned attempt read after a fresh load', (await read()).find(i => i.id === q1.id)?.answer?.selected === 1)

    console.log('\n2. Confidence edit with the same answer')
    await send(q2.id, 1, 'low', T + 10)
    await send(q2.id, 1, 'high', T + 12)
    const lateLow = await send(q2.id, 1, 'medium', T + 11)
    r = await row(q2.id)
    check('a late older confidence does not replace the newer one', lateLow.status === 409 && r[0].self_reported_confidence === LEVEL.high)

    console.log('\n3. Lost response and same-choice retry')
    await send(q3.id, 2, 'high', T + 20)
    const retry = await send(q3.id, 2, 'high', T + 20)     // the client retried the same stamped request
    r = await row(q3.id)
    check('retrying the same stamped choice is accepted and leaves one row with no extra change counted', retry.body?.ok === true && r.length === 1 && r[0].changed_count === 0, JSON.stringify(r))
    const newer = await send(q3.id, 1, 'high', T + 22)
    const replayOld = await send(q3.id, 2, 'high', T + 20)
    r = await row(q3.id)
    check('after a newer choice, a replay of the old stamped request is refused', newer.body?.ok === true && replayOld.status === 409 && r[0].selected_option_index === 1)

    console.log('\n4. Unstamped (legacy) writes still work and are last-write')
    check('a request without clientSeq is accepted', (await send(q4.id, 0, 'medium')).body?.ok === true)

    console.log('\n5. The last question, then submit reflects what the UI showed as saved')
    const last = items[items.length - 1]
    await send(last.id, 3 % 4, 'low', T + 30)
    await send(last.id, 1, 'high', T + 33)
    await send(last.id, 2, 'medium', T + 31)       // delayed
    for (const q of items.slice(5, items.length - 1)) await send(q.id, 0, 'medium', T + 40)
    const shown = new Map((await read()).map(i => [i.id, i.answer]))
    check('the last question holds the newest stamped choice (1, high)', shown.get(last.id)?.selected === 1 && shown.get(last.id)?.confidence === 'high')
    const sub = await st.s.post(`/api/tests/attempt/${attemptId}/submit`, { allowUnanswered: true })
    const finalRows = (await admin.from('assessment_responses').select('item_id, selected_option_index, self_reported_confidence').eq('attempt_id', attemptId)).data ?? []
    const fl = finalRows.find(x => x.item_id === last.id), f1 = finalRows.find(x => x.item_id === q1.id)
    check('finalisation used the committed newest answers', sub.body?.ok === true && fl?.selected_option_index === 1 && fl?.self_reported_confidence === LEVEL.high && f1?.selected_option_index === 1)
    check('no duplicate response rows', new Set(finalRows.map(x => x.item_id)).size === finalRows.length)
    check('a stale write after submission is refused (closed), not applied', (await send(q1.id, 3, 'low', T + 99)).status === 409)
  } finally { await admin.auth.admin.deleteUser(st.id).catch(() => {}) }
  finish()
}
main().catch(e => { console.error(e); process.exit(1) })
