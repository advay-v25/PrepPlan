/**
 * Every outbound Coach model request goes through here: reserved in the database BEFORE dispatch (so retries and fallbacks count, and
 * clearing the visible history cannot reset the budget), aborted at a deadline, and bounded in count and total time. A request whose
 * outcome is unknowable (aborted or timed out after dispatch) is recorded as indeterminate, never as "not sent".
 */
export type GatewayDeps = {
  reserve: () => Promise<{ ok: true; callId: number } | { ok: false; reason: 'fenced' | 'budget' }>
  settle: (callId: number, state: 'succeeded' | 'failed' | 'indeterminate') => Promise<void>
}
export type GatewayFailure = 'budget' | 'fenced' | 'deadline' | 'timeout' | 'provider_error'
export type Gateway = { call: <T>(fn: (signal: AbortSignal) => Promise<T>, perCallMs?: number) => Promise<{ ok: true; value: T } | { ok: false; reason: GatewayFailure }>; readonly dispatched: number }

export function makeGateway(deps: GatewayDeps, opts: { maxCalls?: number; totalMs?: number; now?: () => number } = {}): Gateway {
  const maxCalls = opts.maxCalls ?? 2, now = opts.now ?? Date.now, deadline = now() + (opts.totalMs ?? 20_000)
  let dispatched = 0
  return {
    get dispatched() { return dispatched },
    async call(fn, perCallMs = 10_000) {
      const left = deadline - now()
      if (dispatched >= maxCalls || left < 1_500) return { ok: false, reason: 'deadline' }
      const r = await deps.reserve()
      if (!r.ok) return { ok: false, reason: r.reason }
      dispatched++
      const ctl = new AbortController(), ms = Math.min(perCallMs, left)
      let timedOut = false
      const timer = setTimeout(() => { timedOut = true; ctl.abort() }, ms)
      try {
        // The deadline wins even when a provider ignores the signal: the result is then discarded and the request recorded as indeterminate.
        const work = fn(ctl.signal); work.catch(() => {})   // a late rejection after the deadline is already accounted for
        const value = await Promise.race([work, new Promise<never>((_, rej) => ctl.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))))])
        await deps.settle(r.callId, 'succeeded')
        return { ok: true, value }
      } catch (e: any) {
        // Aborted after dispatch: the provider may still have accepted it, so it is indeterminate, not failed.
        const unknown = timedOut || e?.name === 'AbortError'
        await deps.settle(r.callId, unknown ? 'indeterminate' : 'failed').catch(() => {})
        return { ok: false, reason: unknown ? 'timeout' : 'provider_error' }
      } finally { clearTimeout(timer) }
    },
  }
}
