import { z } from 'zod'
import { extractJson } from '../llm'
import { CAPABILITY_LIST, INTERPRETER_PROMPT_VERSION, INTERPRETER_SCHEMA_VERSION, INTERPRETER_SYSTEM } from './prompts'
import { interpret, isMethodHelp, LOG_VERB, normalise, teachingComponent, type Interpretation } from './interpret'
import type { CoachIntent } from './actions'
import type { Gateway } from './modelGateway'
import { callProvider, type Provider } from './model'

/**
 * The bounded model interpreter. It returns a DESCRIPTION of the request, validated against a strict schema and against the original
 * message; it cannot return an endpoint, an owner, an id, a date or a change. The server resolves everything and a model "confidence"
 * is not accepted at all. It runs only when the deterministic reading is unresolved; a clear deterministic reading is never overridden.
 */
const span = z.string().trim().min(1).max(80)
const whenSchema = z.object({ span, role: z.enum(['target', 'reason', 'source']) }).strict()
export const interpreterSchema = z.object({
  // Schema 2 stays valid (earlier turns replay and older scripted providers); 3 adds the optional, validated `context` field.
  version: z.enum(['coach-interp-schema.2', INTERPRETER_SCHEMA_VERSION]),
  requests: z.array(z.object({ capability: z.enum(CAPABILITY_LIST), negated: z.boolean(), span, when: whenSchema.nullish() }).strict()).max(3),
  excluded: z.array(z.object({ kind: z.enum(['teaching', 'other']), span: span.optional() }).strict()).max(3),
  context: z.array(z.literal('preparation')).max(1).optional(),
  correction: z.boolean(),
  unresolved: z.array(z.enum(['task', 'day', 'attempt', 'capability'])).max(4),
  clarification: z.string().trim().max(160).nullable(),
}).strict()
export type ModelInterpretation = z.infer<typeof interpreterSchema>

const HOSTILE = /https?:\/\/|\bwww\.|\b(?:select|insert|update|delete|drop|alter)\b[^.]{0,30}\b(?:from|into|table|set)\b|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}|\/api\/|\bsupabase\b/i

export type InterpretCheck = { ok: true; value: ModelInterpretation } | { ok: false; reason: string }
/** Schema, then every quoted span must be in the ORIGINAL message, and nothing URL-, SQL- or id-shaped may appear anywhere. */
export function validateInterpretation(raw: unknown, original: string): InterpretCheck {
  const p = interpreterSchema.safeParse(raw)
  if (!p.success) return { ok: false, reason: 'invalid_shape' }
  const v = p.data, lower = original.toLowerCase()
  const spans = [...v.requests.flatMap(r => [r.span, r.when?.span]), ...v.excluded.map(e => e.span)].filter((x): x is string => Boolean(x))
  if (spans.some(sp => !lower.includes(sp.toLowerCase()))) return { ok: false, reason: 'span_not_in_message' }
  if (HOSTILE.test(JSON.stringify(v)) && !HOSTILE.test(original)) return { ok: false, reason: 'hostile_content' }
  return { ok: true, value: v }
}

export type ResolvedInterpretation = { interpretation: Interpretation; clarify: string | null; source: 'model' }
/**
 * The model's description, converted into the SAME shape the deterministic interpreter returns. Day words are re-read by our own grammar
 * from the validated span (the model's "when" is a pointer, not a date), a "reason" date is never the target, and a negation can only
 * REMOVE an action. Returns null when there is nothing the server can act on.
 */
export function toInterpretation(v: ModelInterpretation, original: string, base: Interpretation): ResolvedInterpretation | null {
  // A model "log_learning" is accepted ONLY for an explicit record request (our own verb grammar) or one our deterministic reading also found.
  // Otherwise it is a statement of where preparation stands: planning context, never a study log or a coverage edit.
  const explicitLog = LOG_VERB.test(normalise(original)) || base.intents.includes('log_learning')
  const demoted = v.requests.filter(r => r.capability === 'log_learning' && !explicitLog)
  const requests = v.requests.filter(r => !demoted.includes(r))
  const preparation = Boolean(base.preparation) || demoted.length > 0 || (v.context ?? []).includes('preparation')
  const live = requests.filter(r => !r.negated)
  const negated = requests.filter(r => r.negated).map(r => r.capability as CoachIntent)
  const intents = [...new Set(live.map(r => r.capability as CoachIntent))]
  // A model-flagged exclusion counts only when our own grammar agrees on the quoted span: method help ("teach me how to organise my revision")
  // must never be refused as tutoring because a model guessed. The Coach never answers curriculum content either way, so over-refusing is the costlier error.
  const confirmed = (e: { kind: string; span?: string }) => e.kind === 'teaching' && e.span !== undefined && teachingComponent(normalise(e.span))
  const teaching = base.teaching || v.excluded.some(confirmed)
  // Everything the model excluded that the grammar did not confirm is KEPT as a note: it is never an action, never evidence about the student, and
  // never a reason to refuse planning help, but it is not silently dropped either.
  const exclusions = v.excluded.filter(e => !confirmed(e) && !(e.span !== undefined && isMethodHelp(normalise(e.span)))).map(e => ({ kind: e.kind, span: e.span ?? null }))
  const target = live.find(r => r.when?.role === 'target')?.when?.span
  const when = target ? interpret(target).when : null
  if (!intents.length && !teaching && !v.correction && !exclusions.length && !v.unresolved.length && !negated.length && !preparation) return null
  const primary: CoachIntent = intents[0] ?? (teaching ? 'teach' : v.correction ? 'today' : preparation ? 'next' : 'free')
  return { source: 'model', clarify: v.unresolved.length ? v.clarification : null,
    interpretation: { ...base, intents, primary, teaching, exclusions, negated: [...new Set([...base.negated, ...negated])], correction: v.correction || base.correction, preparation, when: when ?? base.when } }
}

export type InterpretOutcome = { ok: true; resolved: ResolvedInterpretation | null } | { ok: false; reason: string }
export async function interpretWithModel(args: { message: string; base: Interpretation; gateway: Gateway; provider?: Provider; hasKey?: boolean }): Promise<InterpretOutcome> {
  const out = await callProvider({ gateway: args.gateway, provider: args.provider, hasKey: args.hasKey, system: INTERPRETER_SYSTEM, history: [], message: JSON.stringify({ message: args.message }), perCallMs: 8_000 })
  if (!out.ok) return out
  const json = extractJson(out.raw)
  if (!json) return { ok: false, reason: 'not_json' }
  let parsed: unknown
  try { parsed = JSON.parse(json) } catch { return { ok: false, reason: 'not_json' } }
  const v = validateInterpretation(parsed, args.message)
  if (!v.ok) return { ok: false, reason: v.reason }
  return { ok: true, resolved: toInterpretation(v.value, args.message, args.base) }
}
export { INTERPRETER_PROMPT_VERSION }
