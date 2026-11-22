/**
 * Bounded synthetic live-provider probe (one request, synthetic text only; no student data):  npx tsx scripts/coach-provider-probe.ts [--no-format] [--max-tokens=N]
 * Prints status, model, request id, finish reason, elapsed time, token usage and whether visible or reasoning content was present. Lengths/presence only.
 * Change one variable at a time: --no-format drops response_format, --max-tokens=N changes the budget.
 */
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)
import { nvidiaLlm, MODEL_TIERS } from '../src/lib/llm'

const arg = (k: string) => (process.argv.find(a => a.startsWith(`--${k}=`)) ?? '').split('=')[1]
async function main() {
  const maxTokens = Number(arg('max-tokens') ?? 500), format = !process.argv.includes('--no-format')
  const model = MODEL_TIERS.fast[0]
  const t = performance.now()
  try {
    const raw = await nvidiaLlm().chat.completions.create({
      model, temperature: 0.3, max_tokens: maxTokens, ...(format ? { response_format: { type: 'json_object' as const } } : {}),
      messages: [{ role: 'system', content: 'Reply with a JSON object {"reply": string}: one short sentence of study-planning advice.' }, { role: 'user', content: 'How do I keep a regular study routine when tired?' }],
    }, { timeout: 30_000 }).withResponse()
    const c = raw.data.choices[0] as any
    const msg = c?.message ?? {}
    console.log(JSON.stringify({
      http: raw.response.status, model: raw.data.model, configuredModel: model, requestId: raw.response.headers.get('x-request-id') ?? raw.data.id ?? null,
      finishReason: c?.finish_reason ?? null, elapsedMs: Math.round(performance.now() - t), usage: raw.data.usage ?? null,
      visibleContentChars: typeof msg.content === 'string' ? msg.content.length : null, reasoningPresent: Boolean(msg.reasoning_content ?? msg.reasoning), reasoningChars: String(msg.reasoning_content ?? msg.reasoning ?? '').length,
      options: { format, maxTokens },
    }))
  } catch (e: any) { console.log(JSON.stringify({ error: String(e?.status ?? e?.name ?? 'error'), message: String(e?.message ?? '').slice(0, 160), elapsedMs: Math.round(performance.now() - t), options: { format, maxTokens } })) }
}
main()
