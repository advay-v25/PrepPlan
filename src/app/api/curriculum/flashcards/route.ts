import { NextResponse } from 'next/server'
import { createClient } from '../../../../lib/supabase/server'
import { createAdminClient } from '../../../../lib/supabase/admin'
import { RATINGS, scheduleReview, type Rating } from '../../../../lib/curriculum/flashcards'
import { isScopeType, scopeExists } from '../../../../lib/curriculum/scope'

export const dynamic = 'force-dynamic'
const MAX_PER_SCOPE = 300, MAX_PER_USER = 3000
const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim().length >= 1 && v.length <= max ? v.trim() : null)

const COLS = 'id, scope_type, scope_id, front, back, source, due_at, interval_days, ease, reps, lapses, last_reviewed_at, suspended'

/** Own cards (RLS). ?scopeType&scopeId lists one scope; ?due=1 lists what is due now across scopes. */
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  const url = new URL(request.url)
  if (url.searchParams.get('due') === '1') {
    const { data } = await supabase.from('flashcards').select(COLS).eq('suspended', false)
      .lte('due_at', new Date().toISOString()).order('due_at').limit(50)
    return NextResponse.json({ ok: true, cards: data ?? [] })
  }
  const scopeType = url.searchParams.get('scopeType'), scopeId = url.searchParams.get('scopeId') ?? ''
  if (!isScopeType(scopeType) || !(await scopeExists(scopeType, scopeId))) return NextResponse.json({ ok: false, error: 'Unknown subject or reading.' }, { status: 404 })
  const { data } = await supabase.from('flashcards').select(COLS).eq('scope_type', scopeType).eq('scope_id', scopeId).order('created_at')
  return NextResponse.json({ ok: true, cards: data ?? [] })
}

/**
 * POST only. Body: { action: 'create' | 'update' | 'delete' | 'review' | 'draft', ... }
 *  - create: scopeType, scopeId, front, back
 *  - update: cardId, front, back
 *  - delete: cardId
 *  - review: cardId, rating (again | hard | good | easy) — a recall report, never evidence
 *  - draft:  scopeType, scopeId — suggested fronts from the outcome list; the student writes the answers. Writes nothing.
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => null) as any
  if (!body || typeof body.action !== 'string') return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 })
  const requestId = crypto.randomUUID()
  const fail = (error: string, status = 500, error_: unknown = null) => { if (error_) console.error(`[curriculum/flashcards ${requestId}]`, error_); return NextResponse.json({ ok: false, error, requestId }, { status }) }

  if (body.action === 'create') {
    const front = text(body.front, 1000), back = text(body.back, 2000)
    if (!isScopeType(body.scopeType) || !front || !back) return fail('Write both sides of the card.', 400)
    if (!(await scopeExists(body.scopeType, body.scopeId))) return fail('Unknown subject or reading.', 404)
    const { count: inScope } = await supabase.from('flashcards').select('*', { count: 'exact', head: true }).eq('scope_type', body.scopeType).eq('scope_id', body.scopeId)
    const { count: total } = await supabase.from('flashcards').select('*', { count: 'exact', head: true })
    if ((inScope ?? 0) >= MAX_PER_SCOPE || (total ?? 0) >= MAX_PER_USER) return fail('You have reached the card limit here.', 409)
    const { data, error } = await supabase.from('flashcards').insert({
      user_id: user.id, scope_type: body.scopeType, scope_id: body.scopeId, front, back,
      source: body.source === 'outcome_prompt' ? 'outcome_prompt' : 'manual',
    }).select(COLS).single()
    if (error) return fail('Could not save the card.', 500, error.message)
    return NextResponse.json({ ok: true, card: data })
  }

  if (body.action === 'update') {
    const front = text(body.front, 1000), back = text(body.back, 2000)
    if (typeof body.cardId !== 'string' || !front || !back) return fail('Write both sides of the card.', 400)
    const { data, error } = await supabase.from('flashcards').update({ front, back, updated_at: new Date().toISOString() }).eq('id', body.cardId).select(COLS)
    if (error) return fail('Could not save the card.', 500, error.message)
    if (!data?.length) return fail('Card not found.', 404)
    return NextResponse.json({ ok: true, card: data[0] })
  }

  if (body.action === 'delete') {
    if (typeof body.cardId !== 'string') return fail('Invalid request.', 400)
    const { data, error } = await supabase.from('flashcards').delete().eq('id', body.cardId).select('id')
    if (error) return fail('Could not delete the card.', 500, error.message)
    if (!data?.length) return fail('Card not found.', 404)
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'review') {
    if (typeof body.cardId !== 'string' || !RATINGS.includes(body.rating as Rating)) return fail('Invalid request.', 400)
    const { data: card } = await supabase.from('flashcards').select('interval_days, ease, reps, lapses, last_reviewed_at').eq('id', body.cardId).maybeSingle()
    if (!card) return fail('Card not found.', 404)
    const next = scheduleReview({ intervalDays: Number(card.interval_days), ease: Number(card.ease), reps: card.reps as number, lapses: card.lapses as number }, body.rating, new Date())
    const { error } = await supabase.from('flashcards').update({
      interval_days: next.intervalDays, ease: next.ease, reps: next.reps, lapses: next.lapses, due_at: next.dueAt,
      last_reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq('id', body.cardId)
    if (error) return fail('Could not record the review.', 500, error.message)
    return NextResponse.json({ ok: true, dueAt: next.dueAt, intervalDays: next.intervalDays })
  }

  if (body.action === 'draft') {
    if (!isScopeType(body.scopeType) || !(await scopeExists(body.scopeType, body.scopeId))) return fail('Unknown subject or reading.', 404)
    const admin = createAdminClient()
    const readingIds = body.scopeType === 'reading' ? [body.scopeId]
      : ((await admin.from('curriculum_readings').select('id').eq('topic_id', body.scopeId).eq('structure_pending', false)).data ?? []).map(r => r.id as string)
    const { data: los } = await admin.from('reading_los').select('id, title, reading_id').in('reading_id', readingIds).order('sequence').limit(60)
    return NextResponse.json({ ok: true, drafts: (los ?? []).map(l => ({ outcomeId: l.id, front: `In your own words: ${l.title}` })) })
  }

  return fail('Unknown action.', 400)
}
