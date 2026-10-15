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
