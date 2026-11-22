import { routeFailure } from '../../../../lib/ops/routeFailure'
import { NextResponse } from 'next/server'
import { createClient } from '../../../../lib/supabase/server'
import { createAdminClient } from '../../../../lib/supabase/admin'
import { requireApplicationAccess } from '../../../../lib/auth/applicationAccess'

/**
 * Where the student says they already are.
 *
 * A self-report is context, never evidence — it is stored with its source so
 * nothing downstream can mistake "I ticked studied" for "a diagnostic showed
 * this holds". Only a diagnostic writes 'verified'.
 */
const SELF_REPORTABLE = ['not_started', 'taught', 'studied', 'decaying']
/** Reading-level words (the same three the onboarding screen uses) and how they are stored. A report, never evidence: nothing here can write 'verified'. */
const READING_STORED: Record<string, string> = { not_started: 'not_started', partly: 'taught', covered: 'studied' }

/**
 * Two explicit identities, never guessed from a title or fanned out:
 *   { readingId, state: 'not_started' | 'partly' | 'covered', topicId? }   a canonical ACTIVE 2027 reading (curriculum_readings.id; all ten topics). topicId, when sent, must be that reading's subject.
 *   { lmId, state: 'not_started' | 'taught' | 'studied' | 'decaying' }     the existing learning-module id (kept for existing callers); it must be an ACTIVE module.
 * Both are stored in user_module_state under the SAME id the tracker, roadmap, revision queue and completed-scope reads already use for a reading (readings are
 * rows of learning_modules too), source 'self_report'. A retired legacy module, an unknown id, a subject mismatch, a duplicate, or any invalid entry refuses the WHOLE request.
 */
type Update = { id: string; kind: 'reading' | 'legacy'; state: string; topicId?: string }

export async function POST(req: Request) {
  const supabase = await createClient()
  const access = await requireApplicationAccess(supabase)
  if (!access.ok) return access.response
  const user = access.user

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ ok: false, error: 'Send a coverage object.' }, { status: 400 })
  const raw: any[] = Array.isArray(body.updates) ? body.updates : body.readingId || body.lmId ? [{ readingId: body.readingId, lmId: body.lmId, state: body.state, topicId: body.topicId }] : []

  if (raw.length === 0) return NextResponse.json({ ok: false, error: 'Nothing to record' }, { status: 400 })
  if (raw.length > 200) return NextResponse.json({ ok: false, error: 'Send at most 200 readings at a time' }, { status: 400 })

  const updates: Update[] = []
  for (const u of raw) {
    if (u && typeof u.readingId === 'string' && u.readingId && u.lmId === undefined && Object.keys(READING_STORED).includes(u.state) && (u.topicId === undefined || typeof u.topicId === 'string')) updates.push({ id: u.readingId, kind: 'reading', state: READING_STORED[u.state], topicId: u.topicId })
    else if (u && typeof u.lmId === 'string' && u.lmId && u.readingId === undefined && SELF_REPORTABLE.includes(u.state)) updates.push({ id: u.lmId, kind: 'legacy', state: u.state })
    else return NextResponse.json({ ok: false, error: `"${u?.state}" is not something you can set yourself, or the entry is malformed. Only a diagnostic marks a reading verified.` }, { status: 400 })
  }
  if (new Set(updates.map(u => u.id)).size !== updates.length) return NextResponse.json({ ok: false, error: 'Each reading can appear once in a request' }, { status: 400 })

  const admin = createAdminClient()
  const ids = updates.map(u => u.id)
  const [{ data: known, error: knownError }, { data: current, error: currentError }, { data: readings, error: readingsError }] = await Promise.all([
    admin.from('learning_modules').select('id, topic_id, is_active').in('id', ids),
    admin.from('user_module_state').select('lm_id, coverage_state, source').eq('user_id', user.id).in('lm_id', ids),
    admin.from('curriculum_readings').select('id, topic_id').eq('is_active', true).in('id', ids),
  ])
  // An unavailable read is not "unknown reading" and not "nothing verified": say so and change nothing.
  if (knownError || currentError || readingsError) return routeFailure('curriculum.coverage.read', 'Your coverage could not be checked. Try again in a moment.', knownError ?? currentError ?? readingsError, 503)
  const topicOf = new Map((known ?? []).filter(m => m.is_active).map(m => [m.id as string, m.topic_id as string]))
  const readingTopic = new Map((readings ?? []).map(r => [r.id as string, r.topic_id as string]))
  for (const u of updates) {
    if (u.kind === 'reading') {
      if (!readingTopic.has(u.id) || !topicOf.has(u.id)) return NextResponse.json({ ok: false, code: 'UNKNOWN_READING', error: `Unknown or archived reading: ${u.id}`, nothingSaved: true }, { status: 400 })
      if (u.topicId !== undefined && u.topicId !== readingTopic.get(u.id)) return NextResponse.json({ ok: false, code: 'WRONG_SUBJECT', error: `Reading ${u.id} is not in subject ${u.topicId}`, nothingSaved: true }, { status: 400 })
    } else if (!topicOf.has(u.id)) {
      const retired = (known ?? []).some(m => m.id === u.id)
      return NextResponse.json({ ok: false, code: retired ? 'RETIRED_MODULE' : 'UNKNOWN_READING', error: retired ? `Module ${u.id} is retired and cannot be reported on` : `Unknown module: ${u.id}`, nothingSaved: true }, { status: 400 })
    }
  }

  // Advisory: the same rule is enforced where the row is written (trigger), so a race cannot get around this read.
  const protectedRows = (current ?? []).filter(c => c.coverage_state === 'verified' || c.source === 'diagnostic')
  const refuse = (lmIds: string[]) => NextResponse.json({
    ok: false, code: 'VERIFIED_COVERAGE_PROTECTED',
    error: 'Your answers already verified this reading, so a self-report cannot replace it. Nothing was saved. Record how confident you are on the reading instead.',
    conflicts: lmIds.map(id => ({ lmId: id, href: `/app/curriculum/${topicOf.get(id) ?? ''}/${id}` })),
  }, { status: 409 })
  if (protectedRows.length > 0) return refuse(protectedRows.map(r => r.lm_id as string))

  const { error } = await admin.from('user_module_state').upsert(
    updates.map(u => ({
      user_id: user.id,
      lm_id: u.id,
      coverage_state: u.state,
      source: 'self_report',
      updated_at: new Date().toISOString(),
    })),
    { onConflict: 'user_id,lm_id' }
  )
  if (error?.code === 'CV409') return refuse([error.details ?? ''].filter(Boolean))
  if (error) return routeFailure('curriculum.coverage', 'Could not confirm your coverage change. Try again.', error)

  return NextResponse.json({ ok: true, updated: updates.length, saved: updates.map(u => ({ id: u.id, kind: u.kind, stored: u.state })) })
}
