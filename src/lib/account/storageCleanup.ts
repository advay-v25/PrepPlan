import { createAdminClient } from '../supabase/admin'

/**
 * Ownership convention (the only one Roadmap has): an object belongs to a student iff its path starts with `<user id>/` in some bucket. Roadmap has no uploads
 * feature and no Storage policy lets a student write an object, so today a student owns none; anything under that prefix (nested folders included) is removed
 * through the Storage API BEFORE the account, because deleting Auth does not delete files. Nothing outside the prefix is read for removal and no ownership is
 * inferred from a file name. Storage is not part of the Postgres transaction: what is removed stays removed whatever happens next, and a retry continues.
 */
type Bucketed = { listBuckets: () => Promise<{ data: { name: string }[] | null; error: unknown }>; from: (b: string) => {
  list: (path: string, o: { limit: number; offset: number }) => Promise<{ data: { name: string; id?: string | null }[] | null; error: unknown }>
  remove: (paths: string[]) => Promise<{ error: unknown }>
} }
export type StorageResult = { ok: true; removed: number; buckets: number } | { ok: false; removed: number; message: string }
const PAGE = 100, MAX_DEPTH = 16, MAX_OBJECTS = 20_000

export async function removeOwnedStorage(userId: string, storage?: Bucketed): Promise<StorageResult> {
  const s: Bucketed = storage ?? (createAdminClient().storage as unknown as Bucketed)
  const { data: buckets, error } = await s.listBuckets()
  if (error) return { ok: false, removed: 0, message: 'Your files could not be inventoried.' }
  let removed = 0
  for (const b of buckets ?? []) {
    // Collect first, remove after: removing while paging by offset would skip entries.
    const files: string[] = []
    const walk = async (dir: string, depth: number): Promise<string | null> => {
      if (depth > MAX_DEPTH) return 'Some of your files are nested too deeply to list.'
      for (let offset = 0; ; offset += PAGE) {
        const page = await s.from(b.name).list(dir, { limit: PAGE, offset })
        if (page.error) return 'Some of your files could not be listed.'
        const rows = (page.data ?? []).filter(o => o.name)
        for (const o of rows) {
          if (o.id) files.push(`${dir}/${o.name}`)                 // an object
          else { const e = await walk(`${dir}/${o.name}`, depth + 1); if (e) return e }   // a folder (no id)
        }
        if (files.length > MAX_OBJECTS) return 'Too many files to remove in one request; try again.'
        if (rows.length < PAGE) return null
      }
    }
    const err = await walk(userId, 0)
    for (let i = 0; i < files.length; i += PAGE) {
      const chunk = files.slice(i, i + PAGE)
      const rm = await s.from(b.name).remove(chunk)
      if (rm.error) return { ok: false, removed, message: 'Some of your files could not be removed.' }
      removed += chunk.length
    }
    if (err) return { ok: false, removed, message: err }
  }
  return { ok: true, removed, buckets: (buckets ?? []).length }
}
