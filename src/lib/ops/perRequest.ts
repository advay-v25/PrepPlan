import { cache } from 'react'
import { AsyncLocalStorage } from 'node:async_hooks'

const readSnapshot = new AsyncLocalStorage<Map<symbol, Map<string, Promise<unknown>>>>()

/** Share inputs during a read-only calculation in a Route Handler, where React's cache is inactive. */
export function withReadSnapshot<T>(read: () => Promise<T>): Promise<T> {
  return readSnapshot.run(new Map(), read)
}

/**
 * Shares one result of an expensive READ between callers within the same server request (React's per-request cache). Outside a request it
 * simply calls through, so a route handler or script never sees another call's result, and nothing is held between users or requests.
 * `key` must include everything the result depends on (the user, and the clock to the minute for functions that read "now").
 */
export function perRequest<A extends unknown[], R>(fn: (...a: A) => Promise<R>, key: (...a: A) => string): (...a: A) => Promise<R> {
  const slot = cache(() => new Map<string, Promise<R>>())
  const id = Symbol()
  return (...a: A) => {
    const snapshot = readSnapshot.getStore()
    let m = snapshot?.get(id) as Map<string, Promise<R>> | undefined
    if (!m) {
      m = snapshot ? new Map() : slot()
      snapshot?.set(id, m)
    }
    const k = key(...a)
    let p = m.get(k)
    if (!p) { p = fn(...a); m.set(k, p) }
    return p
  }
}
export const minuteOf = (d: Date | string | undefined) => (d === undefined ? Math.floor(Date.now() / 60_000) : typeof d === 'string' ? d : Math.floor(d.getTime() / 60_000)).toString()
