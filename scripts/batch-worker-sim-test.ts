/**
 * Worker behaviour against a SIMULATED provider (a local HTTP server) and the real development database: a valid candidate, a hung provider
 * (the request itself must be aborted), the budget counted before dispatch, and early stop on repeated empty responses. No real provider is
 * contacted and no real content is created; fixtures are deleted by recorded id.   npm run batch:worker:sim:test
 */
import http from 'node:http'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)

let pass = 0, fail = 0
const ok = (n: string, c: boolean, d?: unknown) => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${c ? '' : ' — ' + JSON.stringify(d)}`) }

type Mode = 'valid' | 'hang' | 'empty' | 'verifyhang'
let mode: Mode = 'valid'
let requests = 0, aborted = 0
const sockets = new Set<import('node:net').Socket>()
const DRAFT = {
  stem: 'A synthetic company recognises revenue when control of a widget passes to the customer on shipment. Which of the following best describes the effect of a shipment made on the last day of the year?',
  options: ['Revenue is recognised in that year', 'Revenue is deferred to the following year', 'Revenue is recognised when cash is collected'],
  keyIndex: 0,
  perOptionFeedback: { '0': 'Correct: control passed on shipment, so revenue is recognised.', '1': 'Incorrect: shipment already transferred control.', '2': 'Incorrect: the timing of cash does not decide recognition.' },
  solution: 'Control passes on shipment, so revenue is recognised in the period of shipment.',
  distractorDiagnoses: [{ optionIndex: 1, errorCode: 'T', description: 'Moved the recognition into the next period.' }, { optionIndex: 2, errorCode: 'C', description: 'Applied a cash basis.' }],
  exactNumericValues: {}, isNumeric: false,
}
const server = http.createServer((req, res) => {
  let body = ''
  req.on('data', d => { body += d })
  req.on('close', () => { if (!res.writableEnded) aborted++ })
  req.on('end', () => {
    requests++
    const system = String(JSON.parse(body).messages?.[0]?.content ?? '')
    if (mode === 'hang' || (mode === 'verifyhang' && /independent reviewer/i.test(system))) return   // never answer: only an abort ends this request
    const content = mode === 'empty' ? '' : /independent reviewer/i.test(system)
      ? JSON.stringify({ answerIndex: 0, answerReasoning: 'Control passes on shipment.', inScope: true, scopeDetail: 'in scope', uniqueAnswer: true, uniquenessDetail: 'one answer', languageOk: true, languageDetail: 'fine', confidence: 'high' })
      : JSON.stringify(mode === 'verifyhang' ? { ...DRAFT, stem: DRAFT.stem + ' Assume the shipment was invoiced to a customer in a different region.' } : DRAFT)   // a distinct draft, so the exposure screen does not reject it before verification
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 20 } }))
  })
})
server.on('connection', s => { sockets.add(s); s.on('close', () => sockets.delete(s)) })

async function main() {
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  process.env.NVIDIA_BASE_URL = `http://127.0.0.1:${(server.address() as any).port}/v1`
  process.env.NVIDIA_API_KEY = 'simulated'
  const { createAdminClient } = await import('../src/lib/supabase/admin')
  const { runBatch } = await import('../src/lib/diagnostic/batch')
  const { PROMPT_VERSIONS } = await import('../src/lib/diagnostic/promptVersions')
  const { MODEL_TIERS } = await import('../src/lib/llm')
  const { buildGroundingPacket } = await import('../src/lib/diagnostic/groundingPacket')
  const admin = createAdminClient()
  const tag = Date.now().toString(36)
  const batches: string[] = [], concepts: string[] = []
  const { data: manifest } = await admin.from('curriculum_manifests').select('id, year, version').eq('is_active', true).single()
  const { data: lo } = await admin.from('reading_los').select('id, reading_id').order('id').limit(1).single()
  const cid = crypto.randomUUID(); concepts.push(cid)
  await admin.from('curriculum_concepts').insert({ id: cid, manifest_id: manifest!.id, topic: 'Fixture', reading: 'Fixture', module: 'fx', los: 'fx', name: `Fixture sim concept ${tag}`, importance: 'core', lm_id: lo!.reading_id, verification_status: 'verified', scope_notes: 'fixture' }).throwOnError()
  await admin.from('concept_outcome_map').insert({ concept_id: cid, outcome_id: lo!.id, approximate: false }).throwOnError()
  const pack = { packId: `sim-${tag}`, version: '1', edition: String(manifest!.year), outcomeId: lo!.id, source: { name: 'Synthetic', location: 'n/a' }, rights: { state: 'synthetic' as const, permittedUse: 'synthetic_fixture' as const }, facts: [{ id: 'f1', text: 'Synthetic rule: revenue is recognised when control passes.', location: 'sim' }], included: ['timing'], excluded: [], conventions: [], reasoningObjectives: ['apply the rule'] }
  const cell = (n: number) => { const c = { outcomeId: lo!.id, readingId: lo!.reading_id, conceptId: cid, conceptName: `Fixture sim concept ${tag}`, cognition: 'apply' as const, itemForm: 'scenario' as const, difficulty: 'standard' as const }
    const { packet } = buildGroundingPacket({ manifest: manifest as any, cell: c, concept: { verification_status: 'verified', manifest_id: manifest!.id as string }, mapping: { outcome_id: lo!.id, approximate: false }, pack })
    return { ...c, topic: 'Fixture', module: 'fx', conceptScope: `scope ${n}`, packet } }
  const mk = async (key: string, k: number, budget?: object, maxAttempts = 2, configOverride?: object) => {
    const r = await admin.rpc('create_item_batch', { p_request_key: `sim-${tag}-${key}`, p_config_hash: `h-${key}`, p_cells: Array.from({ length: k }, (_, i) => cell(i)),
      p_batch: { label: `Sim ${key}`, manifest_id: manifest!.id, curriculum_version: 'fixture', prompt_version: 'p', budget: budget ?? null, max_attempts: maxAttempts, config: configOverride ?? { prompts: PROMPT_VERSIONS, models: MODEL_TIERS } } })
    const id = (r.data as any).batchId as string; batches.push(id); return id
  }
  const state = async (id: string) => ({ batch: (await admin.from('item_batches').select('status, requests_reserved, last_error').eq('id', id).single()).data!, cells: (await admin.from('item_batch_cells').select('status, verdict, defect_codes').eq('batch_id', id).order('ordinal')).data! })
  const cleanup = async () => {
    for (const s of sockets) s.destroy()
    await admin.from('assessment_items').delete().in('batch_id', batches)
    await admin.from('item_families').delete().in('family_key', batches.flatMap(b => Array.from({ length: 4 }, (_, o) => `fam-bq-${b.replace(/-/g, '').slice(0, 8)}-${o + 1}`)))
    await admin.from('item_batches').delete().in('id', batches)
    await admin.from('concept_outcome_map').delete().in('concept_id', concepts); await admin.from('curriculum_concepts').delete().in('id', concepts)
    server.close()
  }
  try {
    console.log('\nA valid candidate')
    mode = 'valid'
    const b1 = await mk('valid', 1); await runBatch(b1, { workers: 1, deadlineMs: 30_000 })
    const s1 = await state(b1)
    const item = (await admin.from('assessment_items').select('id, review_status, item_card, family_id').eq('batch_id', b1)).data ?? []
    ok('a grounded cell is drafted through generation and independent verification', s1.cells[0].status === 'drafted' && item.length === 1, s1)
    ok('the candidate records the packet that produced it and is only automatically checked', Boolean((item[0]?.item_card as any)?.packetHash) && ['verified', 'draft'].includes(item[0]?.review_status))
    const fam = (await admin.from('item_families').select('construction_status').eq('id', item[0].family_id).single()).data
    ok('its family is provisional until a reviewer confirms it', fam?.construction_status === 'provisional')
    ok('every provider request (writer + blind solver) was reserved before it was sent', s1.batch.requests_reserved === requests && requests === 2, { reserved: s1.batch.requests_reserved, requests })

    console.log('\nA hung provider')
    mode = 'hang'; requests = 0; aborted = 0
    const b2 = await mk('hang', 1, undefined, 1); const t0 = Date.now()
    await runBatch(b2, { workers: 1, deadlineMs: 1_500 })
    const s2 = await state(b2)
    ok('the deadline ends the cell as GEN_TIMEOUT', s2.cells[0].status === 'failed' && s2.cells[0].verdict === 'GEN_TIMEOUT', s2)
    ok('the underlying provider request itself was aborted, not merely abandoned', aborted >= 1, { aborted, requests })
    ok('the worker was released within the deadline plus its grace, not after the provider\'s own timeout', Date.now() - t0 < 12_000, Date.now() - t0)
    ok('nothing was committed by a timed-out cell', ((await admin.from('assessment_items').select('id').eq('batch_id', b2)).data ?? []).length === 0)

    console.log('\nBudget counted before dispatch')
    mode = 'empty'; requests = 0
    const b3 = await mk('budget', 3, { maxRequests: 3, maxTokens: 100000, wallSeconds: 600 })
    await runBatch(b3, { workers: 1, deadlineMs: 30_000, stopAfterConfigFailures: 99 })
    const s3 = await state(b3)
    ok('no more requests are sent than the budget allows (including retries)', requests <= 3, { requests })
    ok('the batch stops as budget_exhausted and waiting cells are reported as such', s3.batch.status === 'budget_exhausted' && s3.cells.some(c => c.verdict === 'BUDGET_EXHAUSTED'), s3)

    console.log('\nRepeated configuration-like failures')
    mode = 'empty'; requests = 0
    const b4 = await mk('early', 4, { maxRequests: 40, maxTokens: 100000, wallSeconds: 600 }, 1)
    await runBatch(b4, { workers: 1, deadlineMs: 30_000, stopAfterConfigFailures: 2 })
    const s4 = await state(b4)
    ok('after repeated empty responses the batch stops early instead of spending the allowance', s4.batch.status === 'cancelled' && /Stopped early/.test(s4.batch.last_error ?? ''), s4)
    ok('the failures are recorded with a specific cause, not swallowed', s4.cells.some(c => c.verdict === 'EMPTY_OR_MALFORMED_RESPONSE' || c.verdict === 'PROVIDER_ERROR'), s4.cells)

    console.log('\nGenerator succeeds, then verification stalls')
    mode = 'verifyhang'; requests = 0; aborted = 0
    const b5 = await mk('verifyhang', 1, { maxRequests: 10, maxTokens: 100000, wallSeconds: 600 }, 1)
    await runBatch(b5, { workers: 1, deadlineMs: 2_500 })
    const c5 = (await admin.from('item_batch_cells').select('status, verdict, failure_reason, provider_usage').eq('batch_id', b5)).data![0] as any
    ok('the cell fails as GEN_TIMEOUT but the reason names the stage that was running', c5.verdict === 'GEN_TIMEOUT' && /verify|independent|stage "/.test(c5.failure_reason) && /stage "verify-(numeric|editorial|distractor)"/.test(c5.failure_reason), c5.failure_reason)
    ok('the generator\'s reported usage was kept on the failed cell', c5.provider_usage?.knownCalls === 1 && c5.provider_usage?.completionTokens === 20 && c5.provider_usage?.unknownCalls >= 1, c5.provider_usage)
    ok('attempt records show generate then the stalled verifier stage', c5.provider_usage?.attempts?.[0]?.stage === 'generate' && c5.provider_usage?.attempts?.some((a: any) => /^verify/.test(a.stage)), c5.provider_usage?.attempts)
    ok('the stalled provider request was aborted', aborted >= 1, aborted)
    const s5 = await state(b5)
    ok('the ambiguous in-flight request is NOT refunded: reservations equal requests sent', s5.batch.requests_reserved === requests, { reserved: s5.batch.requests_reserved, requests })

    console.log('\nA provider that IGNORES cancellation and answers late (local replacement of the SDK call)')
    const { nvidiaLlm } = await import('../src/lib/llm'), comp: any = nvidiaLlm().chat.completions, realCreate = comp.create
    const lateReply = (ms: number) => { comp.create = async () => { await new Promise(r => setTimeout(r, ms)); return { choices: [{ message: { content: JSON.stringify(DRAFT) }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 20 } } } }
    const open = (r: any) => r.calls - r.knownCalls - r.unknownCalls
    try {
      lateReply(2_000)    // the cell deadline is 1 s; the answer comes 1 s later, inside the worker's 5 s grace
      const b8 = await mk('latefast', 1, { maxRequests: 10, maxTokens: 100000, wallSeconds: 600 }, 1); await runBatch(b8, { workers: 1, deadlineMs: 1_000 })
      const c8 = (await admin.from('item_batch_cells').select('status, verdict, provider_usage').eq('batch_id', b8)).data![0] as any, s8 = await state(b8)
      ok('the late answer is refused: the cell fails (GEN_TIMEOUT) and nothing is committed', c8.status === 'failed' && c8.verdict === 'GEN_TIMEOUT' && ((await admin.from('assessment_items').select('id').eq('batch_id', b8)).data ?? []).length === 0, c8)
      ok('but the usage the late response REPORTED was persisted with the failure (one sent request, known 10/20, one attempt record)', c8.provider_usage.calls === 1 && c8.provider_usage.knownCalls === 1 && c8.provider_usage.unknownCalls === 0 && c8.provider_usage.promptTokens === 10 && c8.provider_usage.completionTokens === 20 && c8.provider_usage.attempts.length === 1 && c8.provider_usage.attempts[0].outcome === 'late_discarded', c8.provider_usage)
      ok('reservations equal requests sent (one), reported separately from measured usage', s8.batch.requests_reserved === 1)
      lateReply(7_500)    // beyond the grace: the worker stops waiting; what was in flight is settled as ONE unknown request and the record is closed
      const b9 = await mk('latelate', 1, { maxRequests: 10, maxTokens: 100000, wallSeconds: 600 }, 1); await runBatch(b9, { workers: 1, deadlineMs: 1_000 })
      const read9 = async () => (await admin.from('item_batch_cells').select('verdict, provider_usage').eq('batch_id', b9)).data![0] as any
      const c9 = await read9()
      ok('a response that never arrives in time is ONE unknown request (calls = known + unknown), with one attempt record', c9.verdict === 'GEN_TIMEOUT' && c9.provider_usage.calls === 1 && c9.provider_usage.unknownCalls === 1 && c9.provider_usage.knownCalls === 0 && open(c9.provider_usage) === 0 && c9.provider_usage.attempts.length === 1 && c9.provider_usage.closed === true, c9.provider_usage)
      await new Promise(r => setTimeout(r, 3_500))   // the late response now arrives in the abandoned call
      const c9b = await read9()
      ok('what was already saved is final: the late arrival changes nothing', JSON.stringify(c9b.provider_usage) === JSON.stringify(c9.provider_usage), { before: c9.provider_usage, after: c9b.provider_usage })
    } finally { comp.create = realCreate }

    console.log('\nResuming under a different prompt package or model policy')
    mode = 'valid'; requests = 0
    const b6 = await mk('oldpkg', 1, undefined, 1, { prompts: { ...PROMPT_VERSIONS, writer: 'writer.OLD' }, models: MODEL_TIERS })
    let refusal = ''; try { await runBatch(b6, { workers: 1, deadlineMs: 5_000 }) } catch (e: any) { refusal = e.message }
    ok('a batch recorded under another prompt package is refused before any request or claim', /different prompt package/.test(refusal) && requests === 0 && (await state(b6)).cells[0].status === 'pending', { refusal, requests })
    const b7 = await mk('oldmodel', 1, undefined, 1, { prompts: PROMPT_VERSIONS, models: { ...MODEL_TIERS, reasoning: ['other/model'] } })
    refusal = ''; try { await runBatch(b7, { workers: 1, deadlineMs: 5_000 }) } catch (e: any) { refusal = e.message }
    ok('a different model policy is refused too, naming the linked-batch remedy', /different model policy/.test(refusal) && /--parent/.test(refusal) && requests === 0, refusal)
  } finally { await cleanup() }
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
}
main().catch(e => { console.error(e); process.exit(1) })
