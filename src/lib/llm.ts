import OpenAI from 'openai'

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
      baseURL: 'https://integrate.api.nvidia.com/v1',
      // Bounded deliberately. Some NVIDIA endpoints accept a request and never
      // respond; with fallback across two models and three rounds, a 120s
      // timeout allows a single call to stall for twelve minutes.
      timeout: 75_000,
      maxRetries: 0, // the retry policy below is ours; the SDK's would hide 503 vs 404
    })
  }
  return client
}

export type ModelTier = 'reasoning' | 'fast'

const TIERS: Record<ModelTier, string[]> = {
  // Item authoring and verification. Prefer the largest authorised model and
  // fall back only when capacity genuinely runs out.
  reasoning: ['nvidia/nemotron-3-super-120b-a12b', 'openai/gpt-oss-20b'],
  // Short classification / formatting calls where the 20B is sufficient.
  fast: ['openai/gpt-oss-20b', 'nvidia/nemotron-3-super-120b-a12b'],
}

const RETRYABLE = new Set([408, 409, 429, 500, 502, 503, 504])

export class LlmError extends Error {
  constructor(message: string, readonly lastStatus?: number) {
    super(message)
    this.name = 'LlmError'
  }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

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
  } = options

  if (!process.env.NVIDIA_API_KEY) {
    throw new LlmError('NVIDIA_API_KEY is not set')
  }

  let lastStatus: number | undefined
  let lastMessage = 'no attempt was made'

  // Rounds outside, models inside. A 503 on the preferred model means capacity,
  // not absence, so the right move is to try the next model immediately and come
  // back later — not to sit and retry the busy one. Retrying in place first cost
  // roughly three wasted round trips per call in practice.
  const dead = new Set<string>()

  for (let round = 1; round <= attemptsPerModel; round++) {
    if (round > 1) await sleep(800 * (round - 1))

    for (const model of TIERS[tier]) {
      if (dead.has(model)) continue
      try {
        // Reasoning models spend part of the completion budget on a `reasoning`
        // field that never appears in `content`. On a tight budget the whole
        // allowance goes to reasoning and content comes back empty, so later
        // rounds are given progressively more room.
        const budget = Math.min(maxTokens * round, 8192)

        const response = await nvidiaLlm().chat.completions.create({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature,
          max_tokens: budget,
          response_format: { type: 'json_object' },
        })

        const choice = response.choices[0]
        const content = choice?.message?.content ?? ''
        const json = extractJson(content)
        if (!json) {
          const truncated = choice?.finish_reason === 'length'
          lastMessage = truncated
            ? `${model} ran out of tokens before emitting JSON (budget ${budget})`
            : `${model} returned no parseable JSON object (${content.slice(0, 160) || 'empty response'})`
          continue
        }

        try {
          const parsed = JSON.parse(json) as T
          onModelResolved?.(model)
          return parsed
        } catch (parseError: any) {
          lastMessage = `${model} returned malformed JSON: ${parseError.message}`
          continue
        }
      } catch (error: any) {
        lastStatus = error?.status
        lastMessage = `${model}: ${error?.message ?? String(error)}`

        // Not served for this account, or not authorised. Never worth retrying.
        if (lastStatus === 404 || lastStatus === 401 || lastStatus === 403) { dead.add(model); continue }
        // Any other non-retryable status is this model's answer for this call.
        if (lastStatus && !RETRYABLE.has(lastStatus)) dead.add(model)
      }
    }

    if (dead.size === TIERS[tier].length) break
  }

  throw new LlmError(`All models in tier "${tier}" failed. Last: ${lastMessage}`, lastStatus)
}
