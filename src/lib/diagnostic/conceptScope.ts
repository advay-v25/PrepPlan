import { createHash } from 'node:crypto'

/** The exact scope a person signs off, as one hash. Must equal public.concept_scope_hash (the database recomputes it and refuses a stale one). */
export const conceptScopeHash = (c: { name: string | null; scope_notes: string | null; excluded_or_superseded: string | null; manifest_id: string }) =>
  createHash('sha256').update(`${c.name ?? ''}\n${c.scope_notes ?? ''}\n${c.excluded_or_superseded ?? ''}\n${c.manifest_id}`, 'utf8').digest('hex')
