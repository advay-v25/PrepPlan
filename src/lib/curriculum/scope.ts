import { createAdminClient } from '../supabase/admin'

export type NoteScope = 'subject' | 'reading'

/** Does this subject/reading exist (and, for readings, have a live structure)? */
export async function scopeExists(type: NoteScope, id: string): Promise<boolean> {
  if (typeof id !== 'string' || id.length === 0 || id.length > 60) return false
  const admin = createAdminClient()
  if (type === 'subject') return Boolean((await admin.from('topics').select('id').eq('id', id).maybeSingle()).data)
  return Boolean((await admin.from('curriculum_readings').select('id').eq('id', id).eq('is_active', true).maybeSingle()).data)
}

export const isScopeType = (v: unknown): v is NoteScope => v === 'subject' || v === 'reading'

/** Like scopeExists, but a failed read is "unavailable", never "not found": a database error must not look like an unknown reading or an empty notebook. */
export async function checkScope(type: NoteScope, id: string): Promise<'ok' | 'missing' | 'unavailable'> {
  if (typeof id !== 'string' || id.length === 0 || id.length > 60) return 'missing'
  const admin = createAdminClient()
  const r = type === 'subject' ? await admin.from('topics').select('id').eq('id', id).maybeSingle()
    : await admin.from('curriculum_readings').select('id').eq('id', id).eq('is_active', true).maybeSingle()
  return r.error ? 'unavailable' : r.data ? 'ok' : 'missing'
}
export const scopeProblem = (s: 'missing' | 'unavailable') => s === 'missing'
  ? { body: { ok: false, error: 'Unknown subject or reading.' }, status: 404 }
  : { body: { ok: false, code: 'unavailable', error: 'Your notes could not be checked just now. Nothing was changed; try again shortly.' }, status: 503 }
