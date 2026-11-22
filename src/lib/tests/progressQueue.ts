/**
 * Optional telemetry must never queue up behind itself or behind a student's work. At most ONE heartbeat is in flight; anything that arrives
 * meanwhile is merged per question (largest seconds, any visit, latest flag), so the backlog is bounded by the number of questions and the
 * final value is never lost. A refusal that says the attempt is closed (or not ours) stops all further sends. `final()` is the keepalive
 * flush for hiding the page: it bypasses the queue and carries the latest merged value.
 */
export type ProgressPayload = { itemId: string; activeSeconds: number; interruptedSeconds: number; visit?: boolean; flagged?: boolean }
export type SendResult = 'ok' | 'stop' | void
export const mergeProgress = (a: ProgressPayload | undefined, b: ProgressPayload): ProgressPayload => !a ? b : ({
  itemId: b.itemId, activeSeconds: Math.max(a.activeSeconds, b.activeSeconds), interruptedSeconds: Math.max(a.interruptedSeconds, b.interruptedSeconds),
  visit: Boolean(a.visit || b.visit), flagged: b.flagged ?? a.flagged,
})

export function createProgressQueue(send: (p: ProgressPayload, keepalive: boolean) => Promise<SendResult>) {
  let inflight = false, closed = false
  const pending = new Map<string, ProgressPayload>()
  let idle: Promise<void> = Promise.resolve()
  const pump = () => {
    if (inflight || closed || pending.size === 0) return
    inflight = true
    idle = (async () => {
      try {
        while (!closed && pending.size) {
          const [id, p] = pending.entries().next().value as [string, ProgressPayload]
          pending.delete(id)
          const r = await send(p, false).catch(() => undefined)
          if (r === 'stop') closed = true
        }
      } finally { inflight = false; if (closed) pending.clear() }
    })()
  }
  return {
    push(p: ProgressPayload) { if (closed) return; pending.set(p.itemId, mergeProgress(pending.get(p.itemId), p)); pump() },
    final(p: ProgressPayload) { if (closed) return; const merged = mergeProgress(pending.get(p.itemId), p); pending.delete(p.itemId); void send(merged, true).catch(() => undefined) },
    close() { closed = true; pending.clear() },
    size: () => pending.size + (inflight ? 1 : 0),
    whenIdle: () => idle,
    isClosed: () => closed,
  }
}
