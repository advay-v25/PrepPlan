import { NextResponse } from 'next/server'
import { createClient } from '../../../../lib/supabase/server'
import { createAdminClient } from '../../../../lib/supabase/admin'
import { RATINGS, type Rating } from '../../../../lib/curriculum/flashcards'
import { checkScope, isScopeType, scopeProblem } from '../../../../lib/curriculum/scope'
import { requireApplicationAccess } from '../../../../lib/auth/applicationAccess'

export const dynamic = 'force-dynamic'
const PAGE = 50, MAX_PAGE = 100

export const CARD_COLS = 'id, scope_type, scope_id, front, back, source, due_at, interval_days, ease, reps, lapses, last_reviewed_at, suspended, revision'
const UNAVAILABLE = { ok: false, code: 'unavailable', error: 'Your cards could not be loaded just now. Nothing was changed; try again shortly.' }
const escapeLike = (s: string) => s.replace(/[\\%_]/g, m => `\\${m}`)
const intParam = (v: string | null, d: number, max: number) => { const n = Number(v); return v !== null && Number.isInteger(n) && n >= 0 ? Math.min(n, max) : d }

/**
 * Own cards (RLS). Every read is paginated with an EXACT count; a failed read or count is a 503, never an empty list or a zero.
 *   ?scopeType&scopeId[&filter=all|due|later][&q=text][&limit][&offset]   one subject or reading
 *   ?due=1[&limit][&offset]                                               what is due now across scopes (+ when the next card is due when nothing is)
 */
export async function GET(request: Request) {
  const supabase = await createClient()
  const access = await requireApplicationAccess(supabase)
  if (!access.ok) return access.response
  const url = new URL(request.url), limit = Math.max(1, intParam(url.searchParams.get('limit'), PAGE, MAX_PAGE)), offset = intParam(url.searchParams.get('offset'), 0, 100_000)
  const nowIso = new Date().toISOString()
  if (url.searchParams.get('due') === '1') {
    const [list, next, all] = await Promise.all([
      supabase.from('flashcards').select(CARD_COLS, { count: 'exact' }).eq('suspended', false).lte('due_at', nowIso).order('due_at').order('id').range(offset, offset + limit - 1),
      supabase.from('flashcards').select('due_at').eq('suspended', false).gt('due_at', nowIso).order('due_at').limit(1),
      supabase.from('flashcards').select('id', { count: 'exact', head: true }),
    ])
    if (list.error || next.error || all.error || list.count === null || all.count === null) return NextResponse.json(UNAVAILABLE, { status: 503 })
    return NextResponse.json({ ok: true, cards: list.data, total: list.count, totalCards: all.count, nextDueAt: (next.data?.[0]?.due_at as string | undefined) ?? null, now: nowIso, offset, limit })
  }
  const scopeType = url.searchParams.get('scopeType'), scopeId = url.searchParams.get('scopeId') ?? ''
  if (!isScopeType(scopeType)) return NextResponse.json({ ok: false, error: 'Unknown subject or reading.' }, { status: 404 })
  const sc = await checkScope(scopeType, scopeId); if (sc !== 'ok') { const p = scopeProblem(sc); return NextResponse.json(p.body, { status: p.status }) }
  const filter = url.searchParams.get('filter'), q = (url.searchParams.get('q') ?? '').trim().slice(0, 100)
  let query = supabase.from('flashcards').select(CARD_COLS, { count: 'exact' }).eq('scope_type', scopeType).eq('scope_id', scopeId)
  if (filter === 'due') query = query.lte('due_at', nowIso); else if (filter === 'later') query = query.gt('due_at', nowIso)
  if (q) query = query.or(`front.ilike.%${escapeLike(q)}%,back.ilike.%${escapeLike(q)}%`)
  const [list, due, all] = await Promise.all([
    query.order('created_at').order('id').range(offset, offset + limit - 1),
    supabase.from('flashcards').select('id', { count: 'exact', head: true }).eq('scope_type', scopeType).eq('scope_id', scopeId).eq('suspended', false).lte('due_at', nowIso),
    supabase.from('flashcards').select('id', { count: 'exact', head: true }).eq('scope_type', scopeType).eq('scope_id', scopeId),
  ])
  if (list.error || due.error || all.error || list.count === null || due.count === null || all.count === null) return NextResponse.json(UNAVAILABLE, { status: 503 })
  return NextResponse.json({ ok: true, cards: list.data, matching: list.count, total: all.count, dueCount: due.count, now: nowIso, offset, limit })
}

const STATUS: Record<string, number> = { BAD_KEY: 400, BAD_ACTION: 400, BAD_SCOPE: 404, INVALID: 400, LIMIT: 409, NOT_FOUND: 404, STALE_CARD: 409, KEY_REUSED: 409 }
const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim().length >= 1 && v.length <= max ? v.trim() : null)

/**
 * POST only. Body: { action: 'create' | 'update' | 'delete' | 'review' | 'draft', requestKey, ... }. Every write is ONE database command (flashcard_apply):
 *  - create: scopeType, scopeId, front, back [, source]
 *  - update: cardId, expectedRevision, front, back
 *  - delete: cardId, expectedRevision
 *  - review: cardId, expectedRevision, rating (again | hard | good | easy) — a recall report, never evidence
 *  - draft:  scopeType, scopeId — outcome PROMPTS (not cards, not generated). Writes nothing.
 * `requestKey` (8–100 chars) names the request: an exact retry returns the original result and applies nothing twice; the same key for a different request is a 409.
 * A stale expectedRevision is a 409 carrying the CURRENT card. Reviews write no evidence, coverage, repair state or paper credit.
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const access = await requireApplicationAccess(supabase)
  if (!access.ok) return access.response
  const body = await request.json().catch(() => null) as any
  if (!body || typeof body.action !== 'string') return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 })
  const requestId = crypto.randomUUID()
  const fail = (error: string, status = 500, detail: unknown = null, extra: object = {}) => { if (detail) console.error(`[curriculum/flashcards ${requestId}]`, detail); return NextResponse.json({ ok: false, error, requestId, ...extra }, { status }) }

  if (body.action === 'draft') {
    if (!isScopeType(body.scopeType)) return fail('Unknown subject or reading.', 404)
    const sc = await checkScope(body.scopeType, body.scopeId); if (sc !== 'ok') { const p = scopeProblem(sc); return NextResponse.json(p.body, { status: p.status }) }
    const admin = createAdminClient()
    const readings = body.scopeType === 'reading' ? { data: [{ id: body.scopeId }], error: null }
      : await admin.from('curriculum_readings').select('id').eq('topic_id', body.scopeId).eq('structure_pending', false)
    if (readings.error) return fail('Prompts could not be loaded. Nothing was changed.', 503, readings.error.message)
    const los = await admin.from('reading_los').select('id, title, reading_id').in('reading_id', (readings.data ?? []).map(r => r.id as string)).order('sequence').limit(60)
    if (los.error) return fail('Prompts could not be loaded. Nothing was changed.', 503, los.error.message)
    return NextResponse.json({ ok: true, kind: 'outcome_prompts', note: 'Prompts only: a question stem to answer in your own words. They are not cards and not generated content.', drafts: (los.data ?? []).map(l => ({ outcomeId: l.id, front: `In your own words: ${l.title}` })) })
  }

  const key = typeof body.requestKey === 'string' ? body.requestKey : null
  if (!key || key.length < 8 || key.length > 100) return fail('A request key of 8 to 100 characters is required.', 400)
  let p_card: string | null = null, p_expected: number | null = null, p_f: Record<string, unknown> = {}
  if (body.action === 'create') {
    const front = text(body.front, 1000), back = text(body.back, 2000)
    if (!isScopeType(body.scopeType) || !front || !back) return fail('Write both sides of the card.', 400)
    p_f = { scopeType: body.scopeType, scopeId: body.scopeId, front, back, source: body.source === 'outcome_prompt' ? 'outcome_prompt' : body.source === 'note_draft' ? 'note_draft' : 'manual' }
  } else if (body.action === 'update' || body.action === 'delete' || body.action === 'review') {
    if (typeof body.cardId !== 'string' || !Number.isInteger(body.expectedRevision) || body.expectedRevision < 1) return fail('Invalid request.', 400)
    p_card = body.cardId; p_expected = body.expectedRevision
    if (body.action === 'update') { const front = text(body.front, 1000), back = text(body.back, 2000); if (!front || !back) return fail('Write both sides of the card.', 400); p_f = { front, back } }
    if (body.action === 'review') {
      if (!RATINGS.includes(body.rating as Rating)) return fail('Invalid request.', 400)
      p_f = { rating: body.rating }   // the schedule is derived INSIDE the command from the locked card, the rating and the database clock; nothing else is accepted
    }
  } else return fail('Unknown action.', 400)

  const { data, error } = await supabase.rpc('flashcard_apply', { p_key: key, p_action: body.action, p_card, p_expected, p_f })
  if (error) return fail('Could not save. Nothing was confirmed; try again with the same request.', 503, error.message)
  const r = data as { ok: boolean; code?: string; error?: string } & Record<string, unknown>
  if (!r?.ok) return NextResponse.json({ ...r, requestId }, { status: STATUS[r?.code ?? ''] ?? 500 })
  return NextResponse.json({ ...r, requestId })
}
