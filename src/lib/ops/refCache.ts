/**
 * Static curriculum reference data (topics, readings, outcomes, concepts) changes only when content is published, yet every page view re-read it
 * from the database. A short per-instance memory cache removes that repeated egress. Production only, so tests and local work always see fresh rows.
 * shortcut: per server instance and time-based (no cross-instance invalidation), when content publishing needs instant visibility, call refCacheClear().
 */
const store = new Map<string, { at: number; value: Promise<unknown> }>()
const TTL = Number(process.env.REF_CACHE_TTL_MS ?? 300_000)

export function refCache<T>(key: string, load: () => Promise<T>): Promise<T> {
  if (process.env.NODE_ENV !== 'production' || !(TTL > 0)) return load()
  const hit = store.get(key)
  if (hit && Date.now() - hit.at < TTL) return hit.value as Promise<T>
  const value = load().catch(error => { store.delete(key); throw error })   // a failed read is never cached
  store.set(key, { at: Date.now(), value })
  return value
}

/**
 * refCache for a Supabase query result ({ data, error }). An error response is NEVER cached: it is thrown out of the cache, then this call runs the query
 * once more and returns whatever it returns, exactly as an uncached read would.
 */
export async function refRows<R extends { error: unknown }>(key: string, query: () => PromiseLike<R>): Promise<R> {
  try { return await refCache(key, async () => { const r = await query(); if (r.error) throw r.error; return r }) }
  catch { return await query() }
}

export const refCacheClear = () => store.clear()
