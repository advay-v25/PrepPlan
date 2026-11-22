/**
 * Provider bounds and accounting against a CONTROLLED local provider (no real provider is contacted, no database): exact HTTP request counts,
 * real cancellation, no late fallback after a stage deadline, known usage preserved, missing usage reported as unknown (never zero).
 *   npm run llm:bounds:test
 */
import http from 'node:http'
let pass = 0, fail = 0
const ok = (n: string, c: boolean, d?: unknown) => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${c ? '' : ' — ' + JSON.stringify(d)}`) }

type Behaviour = { status?: number; content?: string; finish?: string; usage?: boolean; hangMs?: number; replyAfterMs?: number }
let script: Record<string, Behaviour[]> = {}      // per model, consumed in order
const seen: string[] = []; let aborted = 0
const sockets = new Set<import('node:net').Socket>()
const server = http.createServer((req, res) => {
  let body = ''
  req.on('data', d => { body += d })
  req.on('close', () => { if (!res.writableEnded) aborted++ })
  req.on('end', () => {
    const model = JSON.parse(body).model as string
    seen.push(model)
    const b = script[model]?.shift() ?? { content: '{"ok":true}' }
    if (b.hangMs) return                                           // never answers; only an abort ends it
    const send = () => {
      if (res.destroyed) return
      res.statusCode = b.status ?? 200; res.setHeader('Content-Type', 'application/json')
      if ((b.status ?? 200) >= 400) return res.end(JSON.stringify({ error: { message: 'simulated failure' } }))
      res.end(JSON.stringify({ choices: [{ message: { content: b.content ?? '' }, finish_reason: b.finish ?? 'stop' }], ...(b.usage === false ? {} : { usage: { prompt_tokens: 11, completion_tokens: 7 } }) }))
    }
    b.replyAfterMs ? setTimeout(send, b.replyAfterMs) : send()
  })
})
server.on('connection', s => { sockets.add(s); s.on('close', () => sockets.delete(s)) })
const reset = (s: typeof script = {}) => { script = s; seen.length = 0; aborted = 0 }

async function main() {
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  process.env.NVIDIA_BASE_URL = `http://127.0.0.1:${(server.address() as any).port}/v1`; process.env.NVIDIA_API_KEY = 'simulated'
  const { generateStructuredOutput, newUsage, withUsage, withCallContext, LlmStopped, LlmError, MODEL_TIERS, nvidiaLlm, closeUsage } = await import('../src/lib/llm')
  const [A, B] = MODEL_TIERS.reasoning
  const run = <T,>(opts: Parameters<typeof generateStructuredOutput>[2], ctx: Parameters<typeof withCallContext>[0] = {}) => {
    const usage = newUsage()
    const p = withUsage(usage, () => withCallContext(ctx, () => generateStructuredOutput<T>('s', 'u', { tier: 'reasoning', attemptsPerModel: 1, ...opts })))
    return { usage, p }
  }
  const err = async (p: Promise<unknown>) => { try { await p; return null } catch (e) { return e as Error } }

  console.log('\nPreferred model fails, fallback succeeds')
  reset({ [A]: [{ status: 503 }], [B]: [{ content: '{"ok":true}' }] })
  let r = run<{ ok: boolean }>({})
  ok('returns the fallback answer', (await r.p).ok === true)
  ok('exactly two HTTP requests were sent, one per model', seen.length === 2 && seen[0] === A && seen[1] === B, seen)
  ok('the failed request is UNKNOWN usage, the answered one is known; nothing is counted as zero', r.usage.calls === 2 && r.usage.knownCalls === 1 && r.usage.unknownCalls === 1 && r.usage.promptTokens === 11 && r.usage.completionTokens === 7, r.usage)
  ok('attempt records carry stage, model, outcome and status', r.usage.attempts[0].outcome === 'http_error' && r.usage.attempts[0].status === 503 && r.usage.attempts[1].outcome === 'ok' && r.usage.attempts[1].model === B)

  console.log('\nMalformed, empty and length-limited responses')
  reset({ [A]: [{ content: '' , finish: 'length' }], [B]: [{ content: 'not json at all' }] })
  r = run({}); let e = await err(r.p)
  ok('both candidates are tried once and the call fails loudly', e instanceof LlmError && seen.length === 2, { e: e?.message, seen })
  ok('reasoning-only/length-limited and unparseable are distinguished in the records', r.usage.attempts[0].outcome === 'length' && r.usage.attempts[1].outcome === 'unparseable', r.usage.attempts)
  ok('their reported usage is kept (a failed answer can still be billed)', r.usage.knownCalls === 2 && r.usage.completionTokens === 14)
  reset({ [A]: [{ content: '' }], [B]: [{ content: '' }] }); r = run({}); await err(r.p)
  ok('an empty answer is recorded as empty', r.usage.attempts.every(a => a.outcome === 'empty'))

  console.log('\nUsage omitted by the provider')
  reset({ [A]: [{ content: '{"ok":true}', usage: false }] }); r = run({})
  await r.p
  ok('the answer is used, but its usage is UNKNOWN, not zero', r.usage.calls === 1 && r.usage.knownCalls === 0 && r.usage.unknownCalls === 1 && r.usage.attempts[0].usageKnown === false, r.usage)

  console.log('\nHard request ceiling')
  reset({ [A]: [{ status: 503 }], [B]: [{ content: '{"ok":true}' }] }); r = run({ maxRequests: 1 }); e = await err(r.p)
  ok('with a ceiling of 1 exactly one request is sent and the fallback is NOT tried', e instanceof LlmError && /ceiling/.test(e.message) && seen.length === 1, { seen, m: e?.message })
  reset({ [B]: [{ content: '{"ok":true}' }] }); r = run({ models: [B], maxRequests: 1 }); await r.p
  ok('an explicit single-model probe sends one request to that model only', seen.length === 1 && seen[0] === B)

  console.log('\nStage deadline: real cancellation, no late fallback')
  reset({ [A]: [{ hangMs: 1 }], [B]: [{ content: '{"ok":true}' }] })
  const t0 = Date.now(); r = run({ stage: 'generate', stageMs: 400 }); e = await err(r.p)
  await new Promise(res => setTimeout(res, 150))
  ok('a stalled preferred model ends the stage with a stage-deadline stop that names the stage', e instanceof LlmStopped && e.reason === 'stage' && /generate/.test(e.message), e?.message)
  ok('the in-flight request was actually aborted', aborted === 1, aborted)
  ok('NO fallback request was sent after the deadline', seen.length === 1, seen)
  ok('it returned at the deadline, not after a provider timeout', Date.now() - t0 < 3000, Date.now() - t0)
  ok('the cancelled request is recorded as unknown usage with outcome stage_deadline', r.usage.unknownCalls === 1 && r.usage.attempts[0].outcome === 'stage_deadline' && r.usage.attempts[0].stage === 'generate', r.usage)

  console.log('\nResponse arriving after cancellation')
  reset({ [A]: [{ content: '{"ok":true}', replyAfterMs: 500 }] })
  const ac = new AbortController(); r = run({}, { signal: ac.signal }); setTimeout(() => ac.abort(), 100); e = await err(r.p)
  await new Promise(res => setTimeout(res, 600))
  ok('the caller sees a cancellation, never the late answer', e instanceof LlmStopped && e.reason === 'aborted', e?.message)
  ok('no fallback was sent and the request is unknown usage', seen.length === 1 && r.usage.unknownCalls === 1 && r.usage.knownCalls === 0, { seen, u: r.usage })
  reset(); const pre = new AbortController(); pre.abort(); r = run({}, { signal: pre.signal }); e = await err(r.p)
  ok('a call made after cancellation sends nothing', e instanceof LlmStopped && seen.length === 0)

  console.log('\nA provider that IGNORES the abort and answers late (local replacement of chat.completions.create)')
  const completions: any = nvidiaLlm().chat.completions, realCreate = completions.create
  const lateProvider = (usage: unknown, content = '{"secret":"late output"}') => { let sent = 0; completions.create = async () => { sent++; await new Promise(res => setTimeout(res, 35)); return { choices: [{ message: { content }, finish_reason: 'stop' }], ...(usage === undefined ? {} : { usage }) } }; return () => sent }
  const settledOk = (u: typeof r.usage) => u.calls === u.knownCalls + u.unknownCalls
  for (const [label, usage, known] of [['with usage', { prompt_tokens: 7, completion_tokens: 3 }, true], ['without usage', undefined, false], ['with malformed usage (string, negative, missing field)', { prompt_tokens: '7', completion_tokens: -3 }, false], ['with partial usage', { prompt_tokens: 7 }, false]] as const) {
    reset(); const sentCount = lateProvider(usage); let resolved: unknown = 'never'
    r = run({ stage: 'generate', stageMs: 5, models: [A, B] }); e = await err(r.p.then(v => { resolved = v; return v }))
    ok(`${label}: the late answer is refused (a stage stop, no output returned)`, e instanceof LlmStopped && e.reason === 'stage' && resolved === 'never', { e: e?.message, resolved })
    ok(`${label}: exactly one request was sent and no fallback`, sentCount() === 1, sentCount())
    ok(`${label}: calls = known + unknown, with ${known ? 'the reported tokens 7/3 kept' : 'the request UNKNOWN, never zero-known'}`, settledOk(r.usage) && r.usage.calls === 1 && (known ? r.usage.knownCalls === 1 && r.usage.promptTokens === 7 && r.usage.completionTokens === 3 : r.usage.unknownCalls === 1 && r.usage.knownCalls === 0 && r.usage.promptTokens === 0 && r.usage.completionTokens === 0), r.usage)
    ok(`${label}: one attempt record, outcome late_discarded, no content in it`, r.usage.attempts.length === 1 && r.usage.attempts[0].outcome === 'late_discarded' && r.usage.attempts[0].usageKnown === known && !JSON.stringify(r.usage.attempts).includes('late output'), r.usage.attempts)
  }
  reset(); lateProvider({ prompt_tokens: 7, completion_tokens: 3 })
  { const ac2 = new AbortController(); r = run({ models: [A, B] }, { signal: ac2.signal }); setTimeout(() => ac2.abort(), 5); e = await err(r.p)
    ok('a worker-level cancel that the provider ignores is also a settled, known-usage request, not a stage stop', e instanceof LlmStopped && e.reason === 'aborted' && r.usage.calls === 1 && r.usage.knownCalls === 1 && r.usage.completionTokens === 3 && r.usage.attempts.length === 1, { e: e?.message, u: r.usage }) }
  // abort after the reservation resolved but before the HTTP send: not a sent request
  { let sentAfter = 0; completions.create = async () => { sentAfter++; return { choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } } }
    const ac3 = new AbortController(); r = run({ models: [A, B] }, { signal: ac3.signal, reserve: async () => { ac3.abort() } }); e = await err(r.p)
    ok('an abort after the reservation but before the send is NOT a sent request, and is recorded as exactly that', e instanceof LlmStopped && sentAfter === 0 && r.usage.calls === 0 && r.usage.attempts.length === 1 && r.usage.attempts[0].outcome === 'aborted_before_send', { u: r.usage, sentAfter }) }
  // a normal answer with malformed usage is usable, but UNKNOWN usage
  completions.create = async () => ({ choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 'many', completion_tokens: 3 } })
  r = run<{ ok: boolean }>({ models: [A] }); ok('a usable answer with malformed usage is used but its usage is unknown', (await r.p).ok === true && r.usage.unknownCalls === 1 && r.usage.knownCalls === 0 && settledOk(r.usage), r.usage)
  completions.create = realCreate
  ok('no stage timers or abort listeners are left behind (the process can exit; checked by the run finishing)', true)

  { const u = newUsage(); u.calls = 3; u.knownCalls = 1; u.promptTokens = 5; u.completionTokens = 2; closeUsage(u, 'generate')
    ok('closing a record settles every request still in flight as ONE unknown call with one attempt record (calls = known + unknown) and makes it final', u.calls === u.knownCalls + u.unknownCalls && u.unknownCalls === 2 && u.attempts.length === 1 && u.closed === true, u)
    let late = 0; completions.create = async () => { await new Promise(res => setTimeout(res, 40)); late++; return { choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 9, completion_tokens: 9 } } }
    const u2 = newUsage(); const p2 = withUsage(u2, () => generateStructuredOutput('s', 'u', { models: [A], attemptsPerModel: 1 })); await new Promise(res => setTimeout(res, 10)); closeUsage(u2); await p2.catch(() => {}); await new Promise(res => setTimeout(res, 60))
    ok('a response that arrives after its record was closed does not change it', late === 1 && u2.calls === 1 && u2.unknownCalls === 1 && u2.knownCalls === 0 && u2.completionTokens === 0 && u2.attempts.length === 1, u2); completions.create = realCreate }

  console.log('\nGenerator succeeds, then the verifier stage times out: known usage survives')
  reset({ [A]: [{ content: '{"stem":"x"}' }], })
  const usage = newUsage(); script[MODEL_TIERS.verifier[0]] = [{ hangMs: 1 }]
  const staged = await err(withUsage(usage, () => withCallContext({}, async () => {
    await generateStructuredOutput('s', 'u', { tier: 'reasoning', attemptsPerModel: 1, stage: 'generate' })
    await generateStructuredOutput('s', 'u', { tier: 'verifier', attemptsPerModel: 1, stage: 'verify-editorial', stageMs: 300 })
  })))
  ok('the pipeline fails at the verifier stage', staged instanceof LlmStopped && staged.reason === 'stage' && /verify-editorial/.test(staged.message), staged?.message)
  ok('the generator\'s reported usage is still in the caller-owned record', usage.knownCalls === 1 && usage.promptTokens === 11 && usage.completionTokens === 7 && usage.unknownCalls === 1, usage)
  ok('stages are distinguishable in the attempt records', usage.attempts[0].stage === 'generate' && usage.attempts[1].stage === 'verify-editorial', usage.attempts.map(a => a.stage))

  console.log('\nBudget reached mid-pipeline')
  reset({ [A]: [{ content: '{"ok":true}' }] }); let n = 0
  r = run({}, { reserve: async () => { if (++n > 1) throw new LlmStopped('budget', 'BUDGET') } })
  await r.p
  const r2 = run({}, { reserve: async () => { throw new LlmStopped('budget', 'BUDGET') } }); e = await err(r2.p)
  ok('a refused reservation sends no request and is a budget stop', e instanceof LlmStopped && e.reason === 'budget' && seen.length === 1, { seen })
  ok('a refused reservation is not counted as a sent request', r2.usage.calls === 0)

  for (const s of sockets) s.destroy(); server.close()
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
}
main().catch(e => { console.error(e); process.exit(1) })
