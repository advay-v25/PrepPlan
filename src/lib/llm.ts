import OpenAI from 'openai'
import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * NVIDIA NIM client.
 *
 * Model availability on this account was probed directly (2026-09-07):
 *   openai/gpt-oss-20b                  200
 *   nvidia/nemotron-3-super-120b-a12b   503 then 200 — authorised, capacity-limited
 *   meta/llama2-70b                     404 — the previous default, gone
 *   nvidia/llama-3.1-nemotron-70b-instruct, mistralai/mistral-large-2-instruct,
 *   writer/palmyra-fin-70b-32k, nvidia/nemotron-nano-3-30b-a3b   404
 *
 * A single hardcoded model is what broke the pipeline before, so callers name a
 * *tier* and the client walks that tier's candidates. A 503 is capacity, not
 * absence — it is retried before falling through to the next model.
 */

let client: OpenAI | null = null

/**
 * Built on first use, not at import. The OpenAI constructor throws when no key
 * is present, and at module scope that throw happens before a script's dotenv
 * call has run — and would take down a build that merely imports this file.
 */
export function nvidiaLlm(): OpenAI {
  if (!client) {
    const apiKey = process.env.NVIDIA_API_KEY
    if (!apiKey) throw new LlmError('NVIDIA_API_KEY is not set')
    client = new OpenAI({
      apiKey,
      baseURL: process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1',
      // Bounded deliberately. Some NVIDIA endpoints accept a request and never
      // respond; with fallback across two models and three rounds, a 120s
      // timeout allows a single call to stall for twelve minutes.
      timeout: 75_000,
      maxRetries: 0, // the retry policy below is ours; the SDK's would hide 503 vs 404
    })
  }
  return client
}

export type ModelTier = 'reasoning' | 'verifier' | 'fast'

export const MODEL_TIERS: Record<ModelTier, string[]> = {
  // Probed 4 Nov 2026: a model that is listed by /models can still answer 404 or hang, so this is what actually responded.
  // Authoring.
  reasoning: ['nvidia/nemotron-3-ultra-550b-a55b', 'nvidia/nemotron-3.5-lightning-30b-a3b'],
  // Independent checking uses a different model family from the author, so the verifier is not marking its own work.
  verifier: ['mistralai/mistral-large-4-1t-a52b', 'nvidia/nemotron-3.5-lightning-30b-a3b'],
  // Short classification / formatting calls.
  fast: ['nvidia/nemotron-3.5-lightning-30b-a3b', 'nvidia/nemotron-3-ultra-550b-a55b'],
}

/**
 * What a run asked of the provider. `calls` = HTTP requests actually SENT (one pipeline attempt can be several, because of fallback and inner
 * rounds). Prompt/completion tokens are only what the provider REPORTED; a request that failed, was cancelled in flight, or came back without a
 * usage block is `unknownCalls` (it may still have been billed) and is never counted as zero use.
 */
export type AttemptRecord = {
  stage: string; model: string; round: number; ms: number
  outcome: 'ok' | 'empty' | 'length' | 'unparseable' | 'http_error' | 'cancelled' | 'stage_deadline' | 'late_discarded' | 'aborted_before_send'
  status?: number; finish?: string; usageKnown: boolean; promptTokens?: number; completionTokens?: number
}
export type UsageTotal = { calls: number; knownCalls: number; unknownCalls: number; promptTokens: number; completionTokens: number; attempts: AttemptRecord[]; closed?: true }
export const newUsage = (): UsageTotal => ({ calls: 0, knownCalls: 0, unknownCalls: 0, promptTokens: 0, completionTokens: 0, attempts: [] })
/**
 * Final settlement before the record is persisted. A request still in flight when its caller stops waiting (a provider that ignores the abort) is counted as ONE
 * unknown call with one attempt record, and the record is closed so a response arriving later cannot change what was already saved. calls = known + unknown afterwards.
 */
export function closeUsage(usage: UsageTotal, stage = 'unsettled'): UsageTotal {
  const open = usage.calls - usage.knownCalls - usage.unknownCalls
  if (open > 0) { usage.unknownCalls += open; usage.attempts.push({ stage, model: 'unknown', round: 0, ms: 0, outcome: 'cancelled', usageKnown: false }) }
  usage.closed = true
  return usage
}
const usageStore = new AsyncLocalStorage<UsageTotal>()
/** Runs `work` recording into a caller-owned `usage`, so what was already known survives when `work` throws. */
export const withUsage = <T,>(usage: UsageTotal, work: () => Promise<T>): Promise<T> => usageStore.run(usage, work)
export async function collectUsage<T>(work: () => Promise<T>): Promise<{ result: T; usage: UsageTotal }> {
  const usage = newUsage()
  const result = await usageStore.run(usage, work)
  return { result, usage }
}

/**
 * Per-run context for a batch worker: an abort signal that reaches the provider request itself, and a reservation hook that is
 * awaited BEFORE every request (first attempts, retries and verifier calls alike), so a budget is counted before cost is incurred.
 */
export type CallContext = { signal?: AbortSignal; reserve?: (requests: number, maxTokens: number) => Promise<void> }
const callContext = new AsyncLocalStorage<CallContext>()
export const withCallContext = <T,>(ctx: CallContext, work: () => Promise<T>): Promise<T> => callContext.run(ctx, work)
/** Cancellation, deadline or exhausted budget: never retried, never swallowed. */
export class LlmStopped extends Error {
  constructor(readonly reason: 'aborted' | 'budget' | 'stage', message: string) { super(message); this.name = 'LlmStopped' }
}

const RETRYABLE = new Set([408, 409, 429, 500, 502, 503, 504])

export class LlmError extends Error {
  constructor(message: string, readonly lastStatus?: number) {
    super(message)
    this.name = 'LlmError'
  }
}

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) return reject(new LlmStopped('aborted', 'cancelled'))
  const t = setTimeout(resolve, ms)
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(new LlmStopped('aborted', 'cancelled')) }, { once: true })
})

/**
 * Models wrap JSON in prose, fences, or a reasoning preamble even when asked
 * not to. Recover the outermost balanced JSON object rather than trusting the
 * whole string to parse.
 */
export function extractJson(raw: string): string | null {
  const trimmed = raw.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fenced ? fenced[1].trim() : trimmed

  const start = body.indexOf('{')
  if (start === -1) return null

  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < body.length; i++) {
    const ch = body[i]
    if (escaped) { escaped = false; continue }
    if (ch === '\\') { escaped = true; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return body.slice(start, i + 1)
    }
  }
  return null
}

export type StructuredOptions = {
  tier?: ModelTier
  temperature?: number
  maxTokens?: number
  /** Attempts per model before moving to the next candidate in the tier. */
  attemptsPerModel?: number
  /** Names the pipeline stage in attempt records and failure messages (never prompt or answer content). */
  stage?: string
  /** Deadline for this whole call (every request and fallback): on expiry the request is aborted and NO later fallback is sent. */
  stageMs?: number
  /** Hard ceiling on HTTP requests this call may send, enforced before each one. */
  maxRequests?: number
  /** Explicit candidate list instead of the tier's (e.g. to probe one configured model). */
  models?: string[]
  /** Reported back so the item record can attribute what produced it (§11.3). */
  onModelResolved?: (model: string) => void
}

/**
 * Calls the tier's models in order and returns parsed JSON.
 *
 * Throws LlmError when every candidate is exhausted. It deliberately does not
 * return a partial or guessed object: a malformed generator response must fail
 * loudly, because the caller's next step is to put the result in front of a
 * learner.
 */
export async function generateStructuredOutput<T>(
  systemPrompt: string,
  userPrompt: string,
  options: StructuredOptions = {}
): Promise<T> {
  const {
    tier = 'reasoning',
    temperature = 0.7,
    maxTokens = 2048,
    attemptsPerModel = 3,
    onModelResolved,
    stage = 'call',
    stageMs,
    maxRequests = Infinity,
    models = MODEL_TIERS[tier],
  } = options

  if (!process.env.NVIDIA_API_KEY) {
    throw new LlmError('NVIDIA_API_KEY is not set')
  }

  let lastStatus: number | undefined
  let lastMessage = 'no attempt was made'
  const ctx = callContext.getStore() ?? {}
  const live = usageStore.getStore()
  // A closed record is final (already persisted): a response that arrives after its caller gave up no longer touches it. Looked up at each use, not once.
  const acct = () => (live && !live.closed ? live : undefined)
  let sent = 0

  // One AbortController per call: it follows the worker's signal AND this call's own deadline, and is always torn down (timer cleared).
  const own = new AbortController()
  let stageExpired = false
  const onOuterAbort = () => own.abort()
  ctx.signal?.addEventListener('abort', onOuterAbort, { once: true })
  if (ctx.signal?.aborted) own.abort()
  const timer = stageMs ? setTimeout(() => { stageExpired = true; own.abort() }, stageMs) : undefined
  const stopped = (where: string) => stageExpired && !ctx.signal?.aborted
    ? new LlmStopped('stage', `the ${stage} stage hit its ${Math.round((stageMs ?? 0) / 1000)} s deadline ${where}; no later fallback was sent`)
    : new LlmStopped('aborted', `cancelled ${where}`)

  // Rounds outside, models inside. A 503 on the preferred model means capacity,
  // not absence, so the right move is to try the next model immediately and come
  // back later — not to sit and retry the busy one. Retrying in place first cost
  // roughly three wasted round trips per call in practice.
  const dead = new Set<string>()
  const note = (rec: Omit<AttemptRecord, 'stage' | 'usageKnown'> & { usageKnown?: boolean }) => {
    const usage = acct(); if (usage && usage.attempts.length < 60) usage.attempts.push({ stage, usageKnown: false, ...rec })
  }

  try {
    for (let round = 1; round <= attemptsPerModel; round++) {
      if (round > 1) await sleep(800 * (round - 1), own.signal).catch(() => { throw stopped('between attempts') })

      for (const model of models) {
        if (dead.has(model)) continue
        if (sent >= maxRequests) throw new LlmError(`The request ceiling for this call (${maxRequests}) was reached. Last: ${lastMessage}`, lastStatus)
        const t0 = Date.now()
        let settled = false   // a sent request is accounted exactly once: on arrival, or in the catch if it never arrived
        try {
          // Reasoning models spend part of the completion budget on a `reasoning`
          // field that never appears in `content`. On a tight budget the whole
          // allowance goes to reasoning and content comes back empty, so later
          // rounds are given progressively more room.
          const budget = Math.min(maxTokens * round, 8192)
          if (own.signal.aborted) throw stopped('before the request was sent')
          await ctx.reserve?.(1, budget)
          // Reserved but never sent: not a request, so no call is counted, but the attempt is recorded as exactly that.
          if (own.signal.aborted) { note({ model, round, ms: Date.now() - t0, outcome: 'aborted_before_send' }); throw stopped('after its reservation but before the request was sent') }

          sent++; { const usage = acct(); if (usage) usage.calls++ }
          const response = await nvidiaLlm().chat.completions.create({
            model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            temperature,
            max_tokens: budget,
            response_format: { type: 'json_object' },
          }, { signal: own.signal })

          // Settle the sent request ONCE, before anything can discard its output: a response that arrived reports what it reports,
          // even when its content is refused as late. Usage counts as known only when BOTH token counts are valid non-negative integers.
          const u = response?.usage, valid = (n: unknown) => typeof n === 'number' && Number.isInteger(n) && n >= 0
          const known = Boolean(u) && valid(u!.prompt_tokens) && valid(u!.completion_tokens)
          settled = true
          const usage = acct()
          if (usage) {
            if (known) { usage.knownCalls++; usage.promptTokens += u!.prompt_tokens; usage.completionTokens += u!.completion_tokens } else usage.unknownCalls++
          }
          if (own.signal.aborted) {
            note({ model, round, ms: Date.now() - t0, outcome: 'late_discarded', usageKnown: known, promptTokens: known ? u!.prompt_tokens : undefined, completionTokens: known ? u!.completion_tokens : undefined })
            throw stopped('while a response was arriving; its output is discarded')
          }
          const choice = response?.choices?.[0]
          const base = { model, round, ms: Date.now() - t0, finish: choice?.finish_reason ?? undefined, usageKnown: known, promptTokens: known ? u!.prompt_tokens : undefined, completionTokens: known ? u!.completion_tokens : undefined }
          const content = choice?.message?.content ?? ''
          const json = extractJson(content)
          if (!json) {
            const truncated = choice?.finish_reason === 'length'
            note({ ...base, outcome: content.trim() ? (truncated ? 'length' : 'unparseable') : (truncated ? 'length' : 'empty') })
            lastMessage = truncated
              ? `${model} ran out of tokens before emitting JSON (budget ${budget})`
              : `${model} returned no parseable JSON object (${content.slice(0, 160) || 'empty response'})`
            continue
          }

          try {
            const parsed = JSON.parse(json) as T
            note({ ...base, outcome: 'ok' })
            onModelResolved?.(model)
            return parsed
          } catch (parseError: any) {
            note({ ...base, outcome: 'unparseable' })
            lastMessage = `${model} returned malformed JSON: ${parseError.message}`
            continue
          }
        } catch (error: any) {
          if (error instanceof LlmStopped) throw error
          if (own.signal.aborted) {
            if (!settled) { const usage = acct(); if (usage) usage.unknownCalls++ }
            note({ model, round, ms: Date.now() - t0, outcome: stageExpired && !ctx.signal?.aborted ? 'stage_deadline' : 'cancelled' })
            throw stopped(`while a ${stage} request to ${model} was in flight (it may still have been billed; any late output is discarded)`)
          }
          lastStatus = error?.status
          lastMessage = `${model}: ${error?.message ?? String(error)}`
          if (!settled) { const usage = acct(); if (usage) usage.unknownCalls++ }
          note({ model, round, ms: Date.now() - t0, outcome: 'http_error', status: error?.status })

          // Not served for this account, or not authorised. Never worth retrying.
          if (lastStatus === 404 || lastStatus === 401 || lastStatus === 403) { dead.add(model); continue }
          // Any other non-retryable status is this model's answer for this call.
          if (lastStatus && !RETRYABLE.has(lastStatus)) dead.add(model)
        }
      }

      if (dead.size === models.length) break
    }
  } finally {
    if (timer) clearTimeout(timer)
    ctx.signal?.removeEventListener('abort', onOuterAbort)
  }

  throw new LlmError(`All models in tier "${tier}" failed. Last: ${lastMessage}`, lastStatus)
}
