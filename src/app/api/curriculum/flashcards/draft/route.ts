import { NextResponse } from 'next/server'
import { createClient } from '../../../../../lib/supabase/server'
import { checkScope, isScopeType, scopeProblem } from '../../../../../lib/curriculum/scope'
import { requireApplicationAccess } from '../../../../../lib/auth/applicationAccess'
import { CHECK_LIMITS_NOTICE, DRAFT_LIMITS, DRAFT_SYSTEM, draftUserPrompt, validateDrafts } from '../../../../../lib/curriculum/cardDraft'
import { generateStructuredOutput, LlmError, LlmStopped, withCallContext } from '../../../../../lib/llm'

export const dynamic = 'force-dynamic'

/**
 * OPTIONAL, explicit, preview-only. Body: { scopeType, scopeId, text }. `text` is the excerpt of the student's own note they chose (40–3,000 characters);
 * it is the only thing sent to the provider (no other notes, scores or personal context). Nothing is saved here: the student edits and selects drafts, and saving
 * is an ordinary card create with its own request key (so a retry cannot duplicate). Per-user throttle is counted BEFORE any provider call; one request, one
 * short deadline, cancelled with the browser request. A missing/slow/failed provider changes nothing: manual cards and notes keep working.
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const access = await requireApplicationAccess(supabase)
  if (!access.ok) return access.response
  const body = await request.json().catch(() => null) as any
  const text = typeof body?.text === 'string' ? body.text.trim() : ''
  if (!body || !isScopeType(body.scopeType) || typeof body.scopeId !== 'string') return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 })
  if (text.length < DRAFT_LIMITS.minText) return NextResponse.json({ ok: false, code: 'TEXT_TOO_SHORT', error: `Select at least ${DRAFT_LIMITS.minText} characters of your note.` }, { status: 400 })
  if (text.length > DRAFT_LIMITS.maxText) return NextResponse.json({ ok: false, code: 'TEXT_TOO_LONG', error: `Select no more than ${DRAFT_LIMITS.maxText.toLocaleString('en-GB')} characters at a time.` }, { status: 400 })
  const sc = await checkScope(body.scopeType, body.scopeId); if (sc !== 'ok') { const p = scopeProblem(sc); return NextResponse.json(p.body, { status: p.status }) }
  if (!process.env.NVIDIA_API_KEY) return NextResponse.json({ ok: false, code: 'PROVIDER_UNAVAILABLE', error: 'Drafting is not available right now. Your note is unchanged; you can still write cards by hand.' }, { status: 503 })

  const allow = await supabase.rpc('flashcard_draft_allow')
  if (allow.error) return NextResponse.json({ ok: false, code: 'unavailable', error: 'Drafting could not be checked just now. Nothing was sent; try again shortly.' }, { status: 503 })
  if (!(allow.data as { ok: boolean })?.ok) return NextResponse.json({ ...(allow.data as object) }, { status: 429 })

  const label = typeof body.label === 'string' ? body.label : 'this reading'
  try {
    const raw = await withCallContext({ signal: request.signal }, () => generateStructuredOutput<unknown>(DRAFT_SYSTEM, draftUserPrompt(text, label),
      { tier: 'fast', temperature: 0.2, maxTokens: 1400, attemptsPerModel: 1, maxRequests: 1, stage: 'card-draft', stageMs: 25_000 }))
    const checked = validateDrafts(raw, text)
    if ('error' in checked) return NextResponse.json({ ok: false, code: 'MALFORMED', error: 'The draft could not be used. Nothing was saved; try again or write the card yourself.' }, { status: 502 })
    return NextResponse.json({ ok: true, kind: 'note_draft', label: CHECK_LIMITS_NOTICE, drafts: checked.drafts, dropped: checked.dropped, reasons: checked.reasons })
  } catch (e) {
    if (e instanceof LlmStopped) return NextResponse.json({ ok: false, code: e.reason === 'stage' ? 'TIMEOUT' : 'CANCELLED', error: e.reason === 'stage' ? 'Drafting took too long. Nothing was saved; your note is unchanged.' : 'Drafting was cancelled.' }, { status: 504 })
    if (e instanceof LlmError) return NextResponse.json({ ok: false, code: 'PROVIDER_FAILED', error: 'Drafting did not work this time. Nothing was saved; you can still write cards by hand.' }, { status: 502 })
    console.error('[card draft]', (e as Error)?.message); return NextResponse.json({ ok: false, code: 'PROVIDER_FAILED', error: 'Drafting did not work this time. Nothing was saved.' }, { status: 502 })
  }
}
