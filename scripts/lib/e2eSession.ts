/**
 * Shared HTTP session + onboarding fixture for the live e2e scripts.
 * Only ever used with the dedicated +e2e identity (see scripts/lib/e2eIdentity.ts).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { appendFileSync } from 'node:fs'
import { E2E_BASE_URL } from './e2eIdentity'

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
  const rawPost = (p: string, b?: unknown) =>
    json(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) })
  /** Planning suites name a class by its date. The server now requires the class itself, so a body that does not say `occurrenceKey` at all is keyed
   *  here to the timetable's occurrence on that date (suites about identity say `occurrenceKey` explicitly, even as undefined, and are left alone). */
  const keyOf = new Map<string, string>()
  const post = async (p: string, b?: unknown) => {
    const o = b as Record<string, unknown> | undefined
    if (/^\/api\/class-log\/(preview|confirm)$/.test(p) && o && typeof o.classDate === 'string' && !('occurrenceKey' in o)) {
      const occ = ((await json('/api/class-log/context')).body?.context?.occurrences ?? []) as { key: string; date: string; status: string }[]
      const idem = typeof o.idempotencyKey === 'string' ? o.idempotencyKey : null
      // a confirm repeats its key's class; otherwise the date's pending class, else (all logged) a separate manual session
      const key = (idem && keyOf.get(idem)) || occ.find(x => x.date === o.classDate && x.status === 'pending')?.key || (console.log(`  [fixture] no pending timetable class on ${String(o.classDate)}: logging a SEPARATE manual session (not a scheduled class)`), `manual:${crypto.randomUUID()}`)
      if (idem) keyOf.set(idem, key)
      return rawPost(p, { ...o, occurrenceKey: key })
    }
    // a manual task needs its retry key; suites that are not about retries get a fresh one (receipt suites pass `key` themselves)
    if (p === '/api/tasks' && o && typeof o === 'object' && !('key' in o)) return rawPost(p, { ...o, key: crypto.randomUUID() })
    return rawPost(p, b)
  }

  const signIn = async () => {
    const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
    if (error) throw new Error(error.message)
    const result = await rawPost('/api/auth', { action: 'verify', type: 'magiclink', tokenHash: data.properties.hashed_token, next: '/app' })
    return result.status === 200 && result.body?.next === '/app'
  }
  return { req, json, post, signIn }
}

export type OnboardingOptions = NonNullable<Parameters<typeof completeOnboarding>[2]>
/** Walks the real onboarding API from a blank slate to an accepted first week. Returns the confirm response. */
export async function completeOnboarding(
  s: ReturnType<typeof createSession>, admin: SupabaseClient,
  opts: {
    classes?: { weekday: number }[]; stage?: string; topicExposure?: Record<string, string>; positionExtra?: Record<string, unknown>
    /** An unregistered candidate planning against a sitting (index into the 2027 windows by opening date). Default: booked February exam, as before. */
    exam?: { sittingIndex?: number; registered?: boolean; timezone?: string }
    /** Study windows / commitments / session limit. Default: Work Mon–Fri, 18:00–21:00 every day, 45-minute sittings, as before. */
    week?: { windows?: { weekday: number; startTime: string; endTime: string }[]; commitments?: unknown[]; maxSessionMinutes?: 20 | 30 | 45 | 60 | 90 }
    /** Stop once the four setup answers are saved: no preview, no accepted week. */
    answersOnly?: boolean
  } = {},
) {
  const { data: windows } = await admin.from('exam_windows').select('id, window_opens').eq('year', 2027).order('window_opens', { ascending: true })
  const ex = opts.exam ?? {}, win = windows?.[ex.sittingIndex ?? 0]
  const { data: topics } = await admin.from('topics').select('id')
  const defaultExposure: Record<string, string> = {}
  for (const [i, t] of (topics ?? []).entries()) if (i < 3) defaultExposure[t.id as string] = 'current'
  const classes = opts.classes ?? []

  const steps: [string, unknown][] = [
    ['exam', { examWindowId: win?.id, registered: ex.registered ?? true, examDate: (ex.registered ?? true) ? `${String(win?.window_opens).slice(0, 7)}-20` : null, timezone: ex.timezone ?? 'Europe/London' }],
    ['route', classes.length
      ? { prepMode: 'instructor_led', classPattern: 'fixed', recurringClasses: classes.map(c => ({ label: 'Class', weekdays: [c.weekday], startTime: '18:00', endTime: '20:00', endsOn: '2027-01-01' })), nextClass: null }
      : { prepMode: 'self_study', classPattern: 'none', recurringClasses: [] }],
    // Kept as the original default (first 3 topics 'current') rather than emptied: several other suites
    // (confidence, coach) turn out to depend on the coverage state this seeds, even though none of them
    // pass it explicitly. A suite that wants isolation from onboarding's own planted week should clear
    // plan_blocks itself after completeOnboarding (see e2e-class-log.ts), not rely on a global default.
    ['position', { stage: opts.stage ?? 'first_pass_underway', topicExposure: opts.topicExposure ?? defaultExposure, ...opts.positionExtra }],
    ['week', {
      commitments: opts.week?.commitments ?? [{ label: 'Work', kind: 'work', weekdays: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '17:30' }],
      availabilityMode: 'windows',
      windows: opts.week?.windows ?? [1, 2, 3, 4, 5, 6, 0].map(weekday => ({ weekday, startTime: '18:00', endTime: '21:00' })),
      maxSessionMinutes: opts.week?.maxSessionMinutes ?? 45,
    }],
  ]
  for (const [step, body] of steps) {
    const r = await s.post(`/api/onboarding/${step}`, body)
    if (r.body?.ok !== true) throw new Error(`onboarding ${step} failed: ${JSON.stringify(r.body)}`)
  }
  if (opts.answersOnly) return { draftId: '', tasks: [] as any[], paper: undefined as any }
  const preview = await s.post('/api/onboarding/plan/preview', {})
  if (preview.body?.ok !== true) throw new Error(`onboarding plan/preview failed: HTTP ${preview.status} ${JSON.stringify(preview.body)}`)
  const confirm = await s.post('/api/onboarding/plan/confirm', { draftId: preview.body.data.draftId, expectedRevision: preview.body.data.revision })
  if (confirm.body?.ok !== true) throw new Error(`onboarding plan/confirm failed: HTTP ${confirm.status} ${JSON.stringify(confirm.body)}`)
  return { draftId: preview.body.data.draftId as string, tasks: (preview.body.data.tasks ?? []) as any[], paper: preview.body.data.paper }
}

export function makeCheck() {
  let passed = 0, failed = 0
  const check = (n: string, ok: boolean, d = '') => { ok ? (passed++, console.log(`  ✓ ${n}`)) : (failed++, console.log(`  ✗ ${n}${d ? ` — ${d}` : ''}`)) }
  const finish = () => { console.log(`\n${passed} passed, ${failed} failed\n`); if (failed > 0) process.exit(1) }
  return { check, finish }
}

/** The local server must answer before any remote account is created: an unavailable server is a setup failure, not a product result. */
export async function preflightServer() {
  try { const r = await fetch(`${E2E_BASE_URL}/`, { redirect: 'manual', signal: AbortSignal.timeout(15_000) }); if (r.status >= 500) throw new Error(`HTTP ${r.status}`) }
  catch (e: any) { throw new Error(`SETUP FAILURE (not a product result): ${E2E_BASE_URL} is not answering (${e?.message ?? e}).`) }
}

/**
 * A fresh, ORDINARY student (no reviewer or staff role): created, signed in and optionally onboarded through the real API.
 * `register` is called with the id IMMEDIATELY after creation, before sign-in or onboarding can fail, and a failure in either deletes the
 * account before rethrowing, so an unavailable server or a rejected step never leaves an orphan. The caller deletes it on success paths.
 */
export async function createStudent(admin: SupabaseClient, tag: string, opts: { onboard?: boolean; register?: (id: string) => void; onboarding?: OnboardingOptions } = {}) {
  const email = `integ+${tag}${Date.now()}@example.com`
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true })
  if (error || !data.user) throw new Error(`createStudent ${tag}: ${error?.message}`)
  const id = data.user.id
  opts.register?.(id)
  try {
    await admin.from('profiles').upsert({ id, onboarding_status: 'not_started' })
    const s = createSession(admin, email)
    if (!(await s.signIn())) throw new Error(`sign-in ${tag} failed`)
    if (opts.onboard) await completeOnboarding(s, admin, opts.onboarding)
    return { id, s, email }
  } catch (e) {
    // The failing stage and its response are written down BEFORE the account is removed, so nothing that happens during cleanup can replace them.
    const record = JSON.stringify({ at: new Date().toISOString(), tag, studentId: id, failure: String((e as Error).message).slice(0, 2000) })
    console.error(`[fixture setup failed] ${record}`)
    try { appendFileSync(process.env.SETUP_FAILURE_FILE || 'docs/evidence/setup-failures.jsonl', `${record}\n`) } catch { /* the console line above stands */ }
    await admin.auth.admin.deleteUser(id).catch(() => {})
    throw e
  }
}

/** An explicit fresh student: starting fresh, zero reported coverage, a distant TENTATIVE sitting (May 2027, no booked date), weekday evenings plus a long Saturday (two windows). */
export const FRESH_STUDENT_ONBOARDING: OnboardingOptions = {
  stage: 'starting_fresh', topicExposure: {}, exam: { sittingIndex: 1, registered: false, timezone: 'Europe/London' },
  // The same shape the UI's quick-start tiles give ("Weekday evenings" + "Weekends"): 18:30–21:30 Mon–Fri, 09:00–13:00 Sat and Sun, 45-minute sittings.
  week: {
    commitments: [{ label: 'Work', kind: 'work', weekdays: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '17:30' }],
    windows: [...[1, 2, 3, 4, 5].map(weekday => ({ weekday, startTime: '18:30', endTime: '21:30' })), { weekday: 6, startTime: '09:00', endTime: '13:00' }, { weekday: 0, startTime: '09:00', endTime: '13:00' }],
    maxSessionMinutes: 45,
  },
}

/** The midway class-led persona: three covered subjects, uncertainty in two (a few readings of one, most of another), Tuesday/Thursday evening classes, work + commute, booked May 2027, 45-minute sittings. */
export async function classLedPersona(admin: SupabaseClient): Promise<{ options: OnboardingOptions; topics: string[]; uncertainReadings: string[] }> {
  const topics = ((await admin.from('topics').select('id').order('default_sequence')).data ?? []).map(t => t.id as string)
  const uncertainReadings = ((await admin.from('curriculum_readings').select('id').eq('topic_id', topics[0]).order('reading_no').limit(2)).data ?? []).map(r => r.id as string)
  return { topics, uncertainReadings, options: {
    stage: 'first_pass_underway', topicExposure: Object.fromEntries(topics.slice(0, 3).map(t => [t, 'recent'])),
    positionExtra: { uncertainty: { [topics[0]]: { level: 'several', lmIds: uncertainReadings }, [topics[1]]: { level: 'most', lmIds: [] } } },
    exam: { sittingIndex: 1, registered: true, timezone: 'Europe/London' }, classes: [{ weekday: 2 }, { weekday: 4 }],
    week: { commitments: [{ label: 'Work', kind: 'work', weekdays: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '17:30' }, { label: 'Commute', kind: 'commute', weekdays: [1, 2, 3, 4, 5], startTime: '17:30', endTime: '18:00' }],
      windows: [...[1, 3, 5].map(weekday => ({ weekday, startTime: '19:00', endTime: '21:30' })), { weekday: 6, startTime: '09:00', endTime: '13:00' }, { weekday: 0, startTime: '09:00', endTime: '13:00' }], maxSessionMinutes: 45 },
  } }
}
