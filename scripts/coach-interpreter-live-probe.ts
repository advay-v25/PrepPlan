/**
 * Bounded LIVE probe of the model interpreter: at most 6 synthetic messages, no student data, one request each, aborted at 8 s.
 * Prints classified outcomes only (never keys, raw prompts or provider reasoning). Separate from every simulated test.
 *   npx tsx scripts/coach-interpreter-live-probe.ts
 */
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)

const MESSAGES = ["what's on my plate for today", 'what should I tackle next', 'could you possibly sort out my afternoon somehow', 'push this one to Saturday because I am busy today', "I haven't missed today, so what is next?", 'I missed today; explain the WACC formula']
async function main() {
  const { interpret } = await import('../src/lib/coach/interpret')
  const { interpretWithModel } = await import('../src/lib/coach/interpretModel')
  const { makeGateway } = await import('../src/lib/coach/modelGateway')
  if (!process.env.NVIDIA_API_KEY) { console.log(JSON.stringify({ live: false, reason: 'no_key' })); return }
  const rows: any[] = []
  for (const message of MESSAGES) {
    const gateway = makeGateway({ reserve: async () => ({ ok: true, callId: 0 }), settle: async () => {} }, { maxCalls: 1, totalMs: 12_000 })
    const t = Date.now(), r = await interpretWithModel({ message, base: interpret(message), gateway })
    rows.push({ message, ms: Date.now() - t, deterministic: interpret(message).primary,
      ...(r.ok ? { ok: true, intents: r.resolved?.interpretation.intents ?? null, teaching: r.resolved?.interpretation.teaching ?? null, when: r.resolved?.interpretation.when ?? null, negated: r.resolved?.interpretation.negated ?? null } : { ok: false, reason: r.reason }) })
  }
  console.log(JSON.stringify({ live: true, requests: rows.length, rows }, null, 1))
}
main()
