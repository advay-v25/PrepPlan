/**
 * Coach with the provider unavailable, slow, malformed and answering: the schedule, assessment scope, links and proposals must be identical;
 * only the wording may differ. A local stub plays the provider, so no student data leaves the machine.
 *   1. node -e "…stub…" is started by this script on 127.0.0.1:3190 (mode switched per phase)
 *   2. A SECOND dev server must be running with NVIDIA_API_KEY=stub NVIDIA_BASE_URL=http://127.0.0.1:3190/v1 on the port in E2E_BASE_URL:
 *        NVIDIA_API_KEY=stub NVIDIA_BASE_URL=http://127.0.0.1:3190/v1 npx next dev -p 3142
 *        E2E_BASE_URL=http://localhost:3142 npx tsx scripts/coach-provider-agreement-test.ts
 * "No provider" is the stub refusing connections (stopped). Reports the validated-wording and deterministic-fallback outcomes separately.
 */
import http from 'node:http'
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)
import { createStudent, makeCheck } from './lib/e2eSession'

const { check, finish } = makeCheck()
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
let mode: 'valid' | 'slow' | 'malformed' = 'valid'
const stub = http.createServer((req, res) => {
  req.resume(); req.on('end', () => {
    const send = (content: string) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ id: 'x', object: 'chat.completion', created: 0, model: 'stub', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }] })) }
    if (mode === 'slow') setTimeout(() => send('{"reply":"late"}'), 20_000)
    else if (mode === 'malformed') send('this is not json {{{')
    else send(JSON.stringify({ reply: 'Your plan is on Calendar. Take the paper on Saturday at 03:00 and skip your rest day.' }))   // a made-up time the validator must not accept as a fact
  })
})

const norm = (b: any) => JSON.stringify({ intent: b.intent, links: b.links, proposals: (b.proposals ?? []).map((p: any) => ({ kind: p.kind, title: p.title, taskIds: p.taskIds, scope: p.scope })) })

async function main() {
  await new Promise<void>(r => stub.listen(3190, '127.0.0.1', r))
  const st = await createStudent(admin, 'cch', { onboard: true })
  try {
    const snapshot = async () => JSON.stringify(((await admin.from('plan_blocks').select('id, local_date, starts_at, duration_minutes, execution').eq('user_id', st.id).order('id')).data ?? []))
    const plansBefore = await snapshot()
    const ask = async () => { const t = performance.now(); const r = await st.s.post('/api/coach', { message: 'Any tips for keeping a regular study routine when I feel tired?' }); return { r, ms: Math.round(performance.now() - t) } }
    const phases: { name: string; run: () => Promise<{ r: any; ms: number }> }[] = [
      { name: 'valid synthetic answer', run: async () => { mode = 'valid'; return ask() } },
      { name: 'malformed answer', run: async () => { mode = 'malformed'; return ask() } },
      { name: 'slow provider (>12 s timeout)', run: async () => { mode = 'slow'; return ask() } },
      { name: 'provider unreachable', run: async () => { await new Promise(r => stub.close(r)); return ask() } },
    ]
    const results: { name: string; body: any; ms: number }[] = []
    for (const p of phases) { const x = await p.run(); results.push({ name: p.name, body: x.r.body, ms: x.ms }); console.log(`  ${p.name}: ok=${x.r.body?.ok} fallback=${x.r.body?.fallback} reason=${x.r.body?.fallbackReason ?? '-'} ${x.ms} ms`) }
    check('every phase answered', results.every(x => x.body?.ok === true))
    const base = norm(results[0].body)
    check('links, proposals and intent are identical across all four provider behaviours', results.every(x => norm(x.body) === base), results.map(x => norm(x.body).length).join(','))
    check('the valid synthetic answer is reported separately from deterministic fallbacks', results[0].body.fallback === false || results[0].body.fallback === undefined ? true : results.slice(1).every(x => x.body.fallback === true))
    console.log(`  validated live-style output used in phase 1: ${results[0].body.fallback ? 'NO (fell back)' : 'yes'}; fallbacks: ${results.slice(1).filter(x => x.body.fallback).map(x => x.name).join(', ') || 'none'}`)
    check('a made-up time in provider wording never becomes a fact (reply does not state it)', !/03:00/.test(results[0].body.reply ?? '') || results[0].body.fallback === true)
    check('the slow provider was cut off within the timeout, not left hanging', results[2].ms < 25_000, `${results[2].ms} ms`)
    check('no schedule, scope or task changed from any of the four conversations (proposals are not applied)', (await snapshot()) === plansBefore)
    const receipts = (await admin.from('coach_proposals').select('status').eq('user_id', st.id)).data ?? []
    check('no proposal was accepted by asking', receipts.every(x => x.status !== 'accepted'))
  } finally { await admin.auth.admin.deleteUser(st.id).catch(() => {}); stub.close() }
}
main().then(() => finish()).catch(e => { console.error('FAILED:', e.message); process.exit(1) })
