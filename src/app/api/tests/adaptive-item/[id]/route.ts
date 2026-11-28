import { NextResponse } from 'next/server'
import { createClient } from '../../../../../lib/supabase/server'
import { requireApplicationAccess } from '../../../../../lib/auth/applicationAccess'
import {
  commitAdaptiveItemAnswer,
  invalidateAdaptiveItemStep,
  loadAdaptiveItemRun,
  stopAdaptiveItemRun,
} from '../../../../../lib/tests/adaptiveItemPractice'

export const dynamic = 'force-dynamic'
const UUID = /^[0-9a-f-]{36}$/i

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireApplicationAccess(await createClient())
  if (!access.ok) return access.response
  const { id } = await params
  if (!UUID.test(id)) return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 })
  const run = await loadAdaptiveItemRun(access.user.id, id)
  return run ? NextResponse.json({ ok: true, run }) : NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 })
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireApplicationAccess(await createClient())
  if (!access.ok) return access.response
  const { id } = await params
  if (!UUID.test(id)) return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 })
  const body = (await req.json().catch(() => null)) as any
  if (!body || typeof body.action !== 'string') return NextResponse.json({ ok: false, error: 'Bad request.' }, { status: 400 })

  if (body.action === 'commit') {
    if (!Number.isInteger(body.seq) || body.seq < 1 || typeof body.requestKey !== 'string' || body.requestKey.length < 8 || body.requestKey.length > 100 || (body.omitted !== undefined && typeof body.omitted !== 'boolean')) {
      return NextResponse.json({ ok: false, code: 'bad_request', message: 'Invalid submission.' }, { status: 400 })
    }
    const sel = body.omitted ? null : body.selectedOptionIndex
    if (!body.omitted && (!Number.isInteger(sel) || sel < 0 || sel > 2)) {
      return NextResponse.json({ ok: false, code: 'bad_request', message: 'Select an option or choose Skip.' }, { status: 400 })
    }
    const res = await commitAdaptiveItemAnswer(access.user.id, id, {
      seq: body.seq,
      selectedOptionIndex: sel,
      omitted: Boolean(body.omitted),
      requestKey: body.requestKey,
    })
    if (!res.ok) {
      const status = res.code === 'inventory_unavailable' || res.code === 'failed' ? 500 : 409
      return NextResponse.json(res, { status })
    }
    const run = await loadAdaptiveItemRun(access.user.id, id)
    return NextResponse.json({ ...res, run })
  }

  if (body.action === 'stop') {
    const res = await stopAdaptiveItemRun(access.user.id, id, Number.isInteger(body.expectedRevision) ? body.expectedRevision : null)
    const run = await loadAdaptiveItemRun(access.user.id, id)
    return NextResponse.json({ ...res, run }, { status: res.ok ? 200 : 409 })
  }

  if (body.action === 'invalidate') {
    if (!Number.isInteger(body.seq) || body.seq < 1) return NextResponse.json({ ok: false, error: 'Invalid step.' }, { status: 400 })
    const outcome = body.outcome === 'disputed' ? 'disputed' : 'void'
    const res = await invalidateAdaptiveItemStep(access.user.id, id, body.seq, outcome)
    const run = await loadAdaptiveItemRun(access.user.id, id)
    return NextResponse.json({ ...res, run }, { status: res.ok ? 200 : 409 })
  }

  return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 })
}
