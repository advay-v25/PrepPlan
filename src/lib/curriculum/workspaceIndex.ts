import type { SupabaseClient } from '@supabase/supabase-js'
import { getSubjects } from './spine'
import { createAdminClient } from '../supabase/admin'
import { getLosTracker } from './losTrackerService'
import { getRevisionOverview } from './revisionOverview'
import { noteText, type NoteDoc } from './notes/doc'
import { readAll } from '../supabase/readAll'
import { coverageOf, readingCoverageSummary, type CoverageState, type ReadingCoverageSummary } from './readingCoverage'

/**
 * The Curriculum workspace read model: ONE row per reading combining what already exists (the canonical tracker, the revision overview, the student's own notes and cards).
 * It adds no score and no new store. Coverage here is reported/logged activity; "needs attention" is the canonical Repair band; neither means "understood".
 * A failed read throws (the page shows an unavailable state); nothing is ever converted into an empty list.
 */
export type { CoverageState } from './readingCoverage'
export type WorkspaceRow = {
  subjectId: string; subjectName: string; readingId: string; readingNo: number; title: string; structurePending: boolean
  coverage: CoverageState
  needsAttention: number            // outcomes currently in the canonical Repair band
  revision: string | null           // the existing revision-rotation label, if this reading is in it
  /** `preview` is a bounded display excerpt; `text` is the FULL plain text, used ONLY by server-side search and never rendered or sent to the browser. */
  note: { updatedAt: string; preview: string; text: string } | null
  cards: number; due: number
}
export type FilterKey = 'not_covered' | 'partly_covered' | 'covered' | 'attention' | 'revision' | 'notes' | 'cards'
export const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'not_covered', label: 'Not covered' }, { key: 'partly_covered', label: 'Partly covered' }, { key: 'covered', label: 'Covered' },
  { key: 'attention', label: 'Needs attention' }, { key: 'revision', label: 'Revision queued' }, { key: 'notes', label: 'Has notes' }, { key: 'cards', label: 'Has cards' },
]
export const COVERAGE_LABEL: Record<CoverageState, string> = { not_covered: 'Not covered', partly_covered: 'Partly covered', covered: 'Covered' }
export const isFilterKey = (v: unknown): v is FilterKey => FILTERS.some(f => f.key === v)

export type Workspace = { rows: WorkspaceRow[]; revisionUnavailable: boolean; coverage: ReadingCoverageSummary }
export type CardTotals = { total: number; due: number }

/** Exact card totals across ALL scopes (the same numbers as Home). A failed count throws; it is never a zero. */
export async function getCardTotals(supabase: Pick<SupabaseClient, 'from'>): Promise<CardTotals> {
  const [all, due] = await Promise.all([
    supabase.from('flashcards').select('id', { count: 'exact', head: true }),
    supabase.from('flashcards').select('id', { count: 'exact', head: true }).eq('suspended', false).lte('due_at', new Date().toISOString()),
  ])
  if (all.error || due.error || all.count === null || due.count === null) throw new Error('Your cards could not be counted.')
  return { total: all.count, due: due.count }
}

export async function getWorkspaceRows(userId: string, supabase: Pick<SupabaseClient, 'from'>, deps: { revision?: typeof getRevisionOverview } = {}): Promise<Workspace> {
  let revisionUnavailable = false
  const [subjects, tracker, revision, notes, cards, readings] = await Promise.all([
    getSubjects(), getLosTracker(userId),
    (deps.revision ?? getRevisionOverview)(userId).catch(() => { revisionUnavailable = true; return null }),   // a failed revision read is a labelled section state, not "no queued work"
    readAll<{ scope_id: string; doc: unknown; updated_at: string }>((a, z) => supabase.from('curriculum_notes').select('scope_id, doc, updated_at').eq('scope_type', 'reading').order('scope_id').range(a, z) as any),
    // Every card of every reading, in deterministic pages (500, ordered by id); any failed page throws instead of truncating a total.
    readAll<{ id: string; scope_id: string; due_at: string; suspended: boolean }>((a, z) => supabase.from('flashcards').select('id, scope_id, due_at, suspended').eq('scope_type', 'reading').order('id').range(a, z) as any),
    readAll<{ id: string; reading_no: number; title: string; topic_id: string; structure_pending: boolean }>((a, z) => createAdminClient().from('curriculum_readings').select('id, reading_no, title, topic_id, structure_pending').eq('is_active', true).order('sequence').order('id').range(a, z) as any),
  ])
  if (!revision && !revisionUnavailable) { /* no active roadmap: nothing is queued, which is true, not a failure */ }
  const noteBy = new Map(notes.map(n => { const text = noteText(n.doc as NoteDoc).replace(/\s+/g, ' ').trim(); return [n.scope_id, { updatedAt: n.updated_at, preview: text.slice(0, 160), text }] as const }))
  const now = Date.now(), cardBy = new Map<string, { n: number; due: number }>()
  for (const c of cards) { const e = cardBy.get(c.scope_id) ?? { n: 0, due: 0 }; e.n++; if (!c.suspended && new Date(c.due_at).getTime() <= now) e.due++; cardBy.set(c.scope_id, e) }
  const status = new Map(tracker.topics.flatMap(t => t.modules.map(m => [m.id, m] as const)))
  const subjectName = new Map(subjects.map(s => [s.id, s.name]))
  return {
    revisionUnavailable, coverage: readingCoverageSummary([...status.values()]),
    rows: readings.map(r => {
      const m = status.get(r.id)
      return {
        subjectId: r.topic_id, subjectName: subjectName.get(r.topic_id) ?? '', readingId: r.id, readingNo: r.reading_no, title: r.title, structurePending: Boolean(r.structure_pending),
        coverage: m ? coverageOf(m) : 'not_covered', needsAttention: m?.counts.repair ?? 0,
        revision: revision?.byReading[r.id]?.label ?? null, note: noteBy.get(r.id) ?? null,
        cards: cardBy.get(r.id)?.n ?? 0, due: cardBy.get(r.id)?.due ?? 0,
      }
    }),
  }
}

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
const keep: Record<FilterKey, (r: WorkspaceRow) => boolean> = {
  not_covered: r => r.coverage === 'not_covered', partly_covered: r => r.coverage === 'partly_covered', covered: r => r.coverage === 'covered',
  attention: r => r.needsAttention > 0, revision: r => r.revision !== null, notes: r => r.note !== null, cards: r => r.cards > 0,
}
/** Pure: search over reading title/number/subject (and, when asked, the student's own note text), then one filter. */
export function filterRows(rows: WorkspaceRow[], o: { q?: string; f?: FilterKey | null; inNotes?: boolean }): WorkspaceRow[] {
  const q = norm((o.q ?? '').trim())
  return rows.filter(r => (!o.f || keep[o.f](r)) && (!q || norm(`${r.title} reading ${r.readingNo} ${r.subjectName}`).includes(q) || (o.inNotes === true && !!r.note && norm(r.note.text).includes(q))))
}

/**
 * A return link may only point inside the app. The raw value is screened (no scheme, host, protocol-relative, backslash, control character, encoded dot-segment or
 * encoded separator, bounded length) AND the NORMALISED result must still be under /app: `new URL` resolves `..` and `%2e%2e`, which a prefix check on the raw
 * string misses (`/app/../account` -> `/account`). The API is never a destination. Query strings are kept so filter and result context survive.
 */
export function safeInAppReturn(v: unknown): string | null {
  if (typeof v !== 'string' || v.length === 0 || v.length > 300) return null
  if (!/^\/app(\/|\?|$)/.test(v) || v.startsWith('//') || v.includes('\\') || /[\u0000-\u001f\u007f]/.test(v)) return null
  if (/%2e|%2f|%5c|%00|%0[ad]/i.test(v.split('?')[0])) return null   // encoded dot-segments, slashes and backslashes in the PATH are never legitimate here
  try {
    const u = new URL(v, 'http://x.invalid')
    if (u.origin !== 'http://x.invalid' || !/^\/app(\/|$)/.test(u.pathname) || u.pathname.startsWith('/app/api') || u.pathname.split('/').some(seg => seg === '..' || seg === '.')) return null
    return `${u.pathname}${u.search}`
  } catch { return null }
}

/** A short window of the student's own text around the first match, for the search result list. Bounded; the full note stays on the server. */
export function snippetFor(text: string, q: string, width = 80): string {
  const t = text.replace(/\s+/g, ' ').trim(), i = t.toLowerCase().indexOf(q.trim().toLowerCase())
  if (i < 0 || !q.trim()) return t.slice(0, 160)
  const from = Math.max(0, i - width), to = Math.min(t.length, i + q.trim().length + width)
  return `${from > 0 ? '…' : ''}${t.slice(from, to)}${to < t.length ? '…' : ''}`
}
