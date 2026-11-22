import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * A stage budget for server work. Code run inside `withBudget` has every service-role database request (createAdminClient) tied to the budget's
 * AbortSignal, so when the budget is spent the underlying reads are ABORTED, not just ignored. Late results of abandoned work are discarded by the caller.
 * Server-side only; nothing here is reachable from a request, and nothing public can shorten or extend a budget.
 */
const store = new AsyncLocalStorage<{ signal: AbortSignal }>()
export class BudgetExceeded extends Error { constructor(readonly stage: string, readonly ms: number) { super(`${stage} exceeded its ${ms} ms budget`); this.name = 'BudgetExceeded' } }

/** A nested budget never outlives its parent: the parent's abort reaches the child's reads too. */
export const withBudget = <T,>(signal: AbortSignal, work: () => Promise<T>): Promise<T> => { const parent = store.getStore()?.signal; return store.run({ signal: parent ? AbortSignal.any([parent, signal]) : signal }, work) }

/** Wraps a fetch so a request started inside a budget carries its signal (combined with any signal the caller already set). */
export function budgetFetch(base: typeof fetch): typeof fetch {
  return (input, init) => {
    const signal = store.getStore()?.signal
    if (!signal) return base(input, init)
    if (signal.aborted) return Promise.reject(Object.assign(new Error('The request budget was spent before this read started.'), { name: 'AbortError' }))
    return base(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, signal]) : signal })
  }
}

/** Runs `work` under a budget. On expiry the signal aborts the reads, the late result is dropped (never used) and BudgetExceeded is thrown. */
export async function boundedStage<T>(stage: string, ms: number, work: () => Promise<T>): Promise<T> {
  const ctl = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<never>((_, reject) => { timer = setTimeout(() => { ctl.abort(); reject(new BudgetExceeded(stage, ms)) }, ms) })
  const running = withBudget(ctl.signal, work)
  running.catch(() => { /* an abandoned stage may reject later; that is already accounted for */ })
  try { return await Promise.race([running, expired]) } finally { clearTimeout(timer) }
}
