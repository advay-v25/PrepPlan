import { COACH_PROMPT_VERSION, COACH_SYSTEM, validateCoachReply, type CoachContext } from './response'
import { extractJson, MODEL_TIERS, nvidiaLlm } from '../llm'
import type { Gateway } from './modelGateway'

export type ChatTurn = { role: 'user' | 'assistant'; content: string }
/** A provider returns the model's raw text and must honour `signal` (the gateway aborts it at the deadline). Injected so slow, failing and hostile outputs can be tested without a network. */
export type Provider = (args: { system: string; history: ChatTurn[]; message: string; signal: AbortSignal }) => Promise<string>

const nvidiaProvider: Provider = async ({ system, history, message, signal }) => {
  const res = await nvidiaLlm().chat.completions.create({
    model: MODEL_TIERS.fast[0], temperature: 0.2, max_tokens: 600, response_format: { type: 'json_object' },
    // Probed 13 Nov 2026: with reasoning on, this model spent all tokens thinking (11-16 s, no visible text, finish=length); with it off a short JSON answer takes ~0.4 s.
    chat_template_kwargs: { enable_thinking: false },
    messages: [{ role: 'system', content: system }, ...history, { role: 'user', content: message }],
  } as any, { signal })
  return res.choices[0]?.message?.content ?? ''
}

export type RawOutcome = { ok: true; raw: string } | { ok: false; reason: string }
/** One reserved, abortable provider request. No key = no call (and nothing reserved). */
export async function callProvider(a: { gateway: Gateway; provider?: Provider; hasKey?: boolean; system: string; history: ChatTurn[]; message: string; perCallMs?: number }): Promise<RawOutcome> {
  const provider = a.provider ?? nvidiaProvider
  if (!a.provider && !(a.hasKey ?? Boolean(process.env.NVIDIA_API_KEY))) return { ok: false, reason: 'no_key' }
  const r = await a.gateway.call(signal => provider({ system: a.system, history: a.history, message: a.message, signal }), a.perCallMs)
  if (!r.ok) return { ok: false, reason: r.reason }
  return r.value?.trim() ? { ok: true, raw: r.value } : { ok: false, reason: 'empty' }
}

export type ModelOutcome = { reply: string | null; reason: 'ok' | 'no_key' | 'timeout' | 'provider_error' | 'empty' | 'not_json' | string }

/** One bounded, reserved attempt. Returns the validated reply, or null with the reason; the caller then uses the verified deterministic reply. */
export async function modelReply(input: { ctx: CoachContext; history: ChatTurn[]; message: string; gateway: Gateway; provider?: Provider; hasKey?: boolean; timeoutMs?: number }): Promise<ModelOutcome> {
  const out = await callProvider({ gateway: input.gateway, provider: input.provider, hasKey: input.hasKey, system: `${COACH_SYSTEM}\nContext: ${JSON.stringify(input.ctx)}`, history: input.history, message: input.message, perCallMs: input.timeoutMs ?? 10_000 })
  if (!out.ok) return { reply: null, reason: out.reason }
  const json = extractJson(out.raw)
  if (!json) return { reply: null, reason: 'not_json' }
  let parsed: unknown
  try { parsed = JSON.parse(json) } catch { return { reply: null, reason: 'not_json' } }
  const v = validateCoachReply(parsed)
  return v.ok ? { reply: v.reply, reason: 'ok' } : { reply: null, reason: v.reason }
}

export { COACH_PROMPT_VERSION }
