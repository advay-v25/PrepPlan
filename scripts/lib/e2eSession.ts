/**
 * Shared HTTP session + onboarding fixture for the live e2e scripts.
 * Only ever used with the dedicated +e2e identity (see src/lib/testing/e2eIdentity.ts).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { E2E_BASE_URL } from '../../src/lib/testing/e2eIdentity'

export function createSession(admin: SupabaseClient, email: string) {
  const jar = new Map<string, string>()
  const store = (res: Response) => {
    for (const line of ((res.headers as any).getSetCookie?.() ?? []) as string[]) {
      const [pair] = line.split(';'); const i = pair.indexOf('=')
      if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim())
    }
  }
  const req = async (path: string, init: RequestInit = {}) => {
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
    const res = await fetch(`${E2E_BASE_URL}${path}`, {
      ...init, redirect: 'manual', headers: { ...(init.headers ?? {}), ...(cookie ? { cookie } : {}) },
    })
    store(res); return res
  }
  const json = async (path: string, init: RequestInit = {}) => {
    const res = await req(path, init); const t = await res.text()
    try { return { status: res.status, body: JSON.parse(t) } } catch { return { status: res.status, body: { raw: t.slice(0, 200) } } }
  }
  const post = (p: string, b?: unknown) =>
    json(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) })

  const signIn = async () => {
    const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
    if (error) throw new Error(error.message)
    let path = `/auth/confirm?token_hash=${(data.properties as any).hashed_token}&type=magiclink&next=/app`
    for (let i = 0; i < 5; i++) {
      const res = await req(path)
      const loc = res.headers.get('location')
      if (!loc) break
      path = new URL(loc, E2E_BASE_URL).pathname + new URL(loc, E2E_BASE_URL).search
      if (path.startsWith('/app')) break
    }
    return path.startsWith('/app')
  }
  return { req, json, post, signIn }
}

/** Walks the real onboarding API from a blank slate to an accepted first week. Returns the confirm response. */
export async function completeOnboarding(
  s: ReturnType<typeof createSession>, admin: SupabaseClient,
  opts: { classes?: { weekday: number }[]; stage?: string; topicExposure?: Record<string, string> } = {},
) {
  const { data: windows } = await admin.from('exam_windows').select('id, window_opens').eq('year', 2027).order('window_opens', { ascending: true })
  const { data: topics } = await admin.from('topics').select('id')
  const defaultExposure: Record<string, string> = {}
  for (const [i, t] of (topics ?? []).entries()) if (i < 3) defaultExposure[t.id as string] = 'current'
  const classes = opts.classes ?? []

  const steps: [string, unknown][] = [
    ['exam', { examWindowId: windows?.[0]?.id, registered: true, examDate: `${String(windows?.[0]?.window_opens).slice(0, 7)}-20`, timezone: 'Europe/London' }],
    ['route', classes.length
      ? { prepMode: 'instructor_led', classPattern: 'fixed', recurringClasses: classes.map(c => ({ label: 'Class', weekdays: [c.weekday], startTime: '18:00', endTime: '20:00', endsOn: '2027-01-01' })), nextClass: null }
      : { prepMode: 'self_study', classPattern: 'none', recurringClasses: [] }],
    // Kept as the original default (first 3 topics 'current') rather than emptied: several other suites
    // (confidence, coach) turn out to depend on the coverage state this seeds, even though none of them
    // pass it explicitly. A suite that wants isolation from onboarding's own planted week should clear
    // plan_blocks itself after completeOnboarding (see e2e-class-log.ts), not rely on a global default.
    ['position', { stage: opts.stage ?? 'first_pass_underway', topicExposure: opts.topicExposure ?? defaultExposure }],
    ['week', {
      commitments: [{ label: 'Work', kind: 'work', weekdays: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '17:30' }],
      availabilityMode: 'windows',
      windows: [1, 2, 3, 4, 5, 6, 0].map(weekday => ({ weekday, startTime: '18:00', endTime: '21:00' })),
      maxSessionMinutes: 45,
    }],
  ]
  for (const [step, body] of steps) {
    const r = await s.post(`/api/onboarding/${step}`, body)
    if (r.body?.ok !== true) throw new Error(`onboarding ${step} failed: ${JSON.stringify(r.body)}`)
  }
  const preview = await s.post('/api/onboarding/plan/preview', {})
  if (preview.body?.ok !== true) throw new Error(`preview failed: ${JSON.stringify(preview.body)}`)
  const confirm = await s.post('/api/onboarding/plan/confirm', {
    draftId: preview.body.data.draftId, expectedRevision: preview.body.data.revision,
  })
  if (confirm.body?.ok !== true) throw new Error(`confirm failed: ${JSON.stringify(confirm.body)}`)
  return { draftId: preview.body.data.draftId as string }
}

export function makeCheck() {
  let passed = 0, failed = 0
  const check = (n: string, ok: boolean, d = '') => { ok ? (passed++, console.log(`  ✓ ${n}`)) : (failed++, console.log(`  ✗ ${n}${d ? ` — ${d}` : ''}`)) }
  const finish = () => { console.log(`\n${passed} passed, ${failed} failed\n`); if (failed > 0) process.exit(1) }
  return { check, finish }
}
