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

export const refCacheClear = () => store.clear()
