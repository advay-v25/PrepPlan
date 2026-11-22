/**
 * The initial route chain, end to end: landing → auth → onboarding gate → app.
 *
 * This is the thing that was actually broken: Home checked
 * `onboarding_sessions.status`, a table the rebuilt onboarding flow never
 * writes to, so a completed user was bounced back into onboarding forever.
 * These checks assert the gate now reads the real column, from both
 * directions, and that the surrounding auth pages hand off to the right place.
 *
 *   npm run dev
 *   npx tsx scripts/e2e-routes.ts --reset
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local', quiet: true } as any)

import { getE2EEmail, verifyAndGetE2EUser, resetE2EUser, E2E_BASE_URL } from './lib/e2eIdentity'

const BASE = E2E_BASE_URL
const EMAIL = getE2EEmail()

let passed = 0, failed = 0
const check = (n: string, ok: boolean, d = '') => { ok ? (passed++, console.log(`  ✓ ${n}`)) : (failed++, console.log(`  ✗ ${n}${d ? ` — ${d}` : ''}`)) }

const jar = new Map<string, string>()
function store(res: Response) {
  for (const line of ((res.headers as any).getSetCookie?.() ?? []) as string[]) {
    const [pair] = line.split(';'); const i = pair.indexOf('=')
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim())
  }
}
function clearJar() { jar.clear() }
async function req(path: string, init: RequestInit = {}) {
  const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
  const res = await fetch(`${BASE}${path}`, { ...init, redirect: 'manual', headers: { ...(init.headers ?? {}), ...(cookie ? { cookie } : {}) } })
  store(res); return res
}
function loc(res: Response) { return res.headers.get('location') ?? '' }

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

async function signIn() {
  const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email: EMAIL })
  const res = await req('/api/auth', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'verify', type: 'magiclink', tokenHash: link?.properties?.hashed_token, next: '/app' }),
  })
  if (!res.ok) throw new Error(`Test sign-in failed (HTTP ${res.status}).`)
}

async function main() {
  console.log(`\nRoute chain end to end against ${BASE}\n`)

  // --- Signed out ------------------------------------------------------------
  console.log('Signed out')
  clearJar()

  const landing = await req('/')
  check('/ renders for a signed-out visitor', landing.status === 200, `status ${landing.status}`)

  for (const path of ['/app', '/app/calendar', '/onboarding', '/onboarding/exam']) {
    const res = await req(path)
    const target = new URL(loc(res), BASE)
    check(`${path} bounces to login`,
      res.status >= 300 && res.status < 400 && target.pathname === '/login' && target.searchParams.get('next') === path,
      `${res.status} → ${loc(res)}`)
  }

  for (const path of ['/login', '/signup', '/forgot-password', '/update-password', '/auth/error', '/check-email', '/terms', '/privacy']) {
    const res = await req(path)
    check(`${path} renders`, res.status === 200, `status ${res.status}`)
  }

  // --- Onboarding not complete -------------------------------------------------
  console.log('\nSigned in, onboarding not complete')

  const uid = await verifyAndGetE2EUser(admin)

  if (process.argv.includes('--reset')) {
    await admin.from('profiles').update({ onboarding_status: 'not_started', onboarding_step: 0 }).eq('id', uid)
  }

  clearJar()
  await signIn()

  const rootWhileIncomplete = await req('/')
  check('/ sends a signed-in visitor into /app',
    rootWhileIncomplete.status >= 300 && rootWhileIncomplete.status < 400 && loc(rootWhileIncomplete) === '/app',
    `${rootWhileIncomplete.status} → ${loc(rootWhileIncomplete)}`)

  const appWhileIncomplete = await req('/app')
  check('/app redirects to onboarding when it is not complete',
    appWhileIncomplete.status >= 300 && appWhileIncomplete.status < 400 && loc(appWhileIncomplete) === '/onboarding',
    `${appWhileIncomplete.status} → ${loc(appWhileIncomplete)}`)

  const calendarWhileIncomplete = await req('/app/calendar')
  check('/app/calendar also redirects — the gate covers the whole section, not just Home',
    calendarWhileIncomplete.status >= 300 && calendarWhileIncomplete.status < 400 && loc(calendarWhileIncomplete) === '/onboarding',
    `${calendarWhileIncomplete.status} → ${loc(calendarWhileIncomplete)}`)

  const settingsWhileIncomplete = await req('/app/settings')
  check('/app/settings also redirects',
    settingsWhileIncomplete.status >= 300 && settingsWhileIncomplete.status < 400 && loc(settingsWhileIncomplete) === '/onboarding',
    `${settingsWhileIncomplete.status} → ${loc(settingsWhileIncomplete)}`)

  const loginWhileSignedIn = await req('/login')
  check('/login sends an already-authenticated visitor into /app',
    loginWhileSignedIn.status >= 300 && loginWhileSignedIn.status < 400 && loc(loginWhileSignedIn) === '/app',
    `${loginWhileSignedIn.status} → ${loc(loginWhileSignedIn)}`)

  const signupWhileSignedIn = await req('/signup')
  check('/signup sends an already-authenticated visitor into /app',
    signupWhileSignedIn.status >= 300 && signupWhileSignedIn.status < 400 && loc(signupWhileSignedIn) === '/app',
    `${signupWhileSignedIn.status} → ${loc(signupWhileSignedIn)}`)

  const entry = await req('/onboarding')
  check('/onboarding resumes into a named step',
    entry.status >= 300 && entry.status < 400 && loc(entry).startsWith('/onboarding/'),
    `${entry.status} → ${loc(entry)}`)

  // --- Onboarding complete -----------------------------------------------------
  console.log('\nSigned in, onboarding complete')

  await admin.from('profiles').update({ onboarding_status: 'complete' }).eq('id', uid)

  const appWhileComplete = await req('/app')
  check('/app renders Home once onboarding is complete', appWhileComplete.status === 200, `status ${appWhileComplete.status}`)

  const html = await appWhileComplete.text()
  check('Home does not fall back to the dead onboarding-blob redirect',
    !html.toLowerCase().includes('onboarding_sessions'),
    'response body mentions the retired table')

  const onboardingWhileComplete = await req('/onboarding')
  check('/onboarding sends a completed user straight to Home',
    onboardingWhileComplete.status >= 300 && onboardingWhileComplete.status < 400 && loc(onboardingWhileComplete) === '/app',
    `${onboardingWhileComplete.status} → ${loc(onboardingWhileComplete)}`)

  const stepWhileComplete = await req('/onboarding/exam')
  check('a single onboarding step still renders for a completed user — answers stay editable forever',
    stepWhileComplete.status === 200, `status ${stepWhileComplete.status}`)

  const calendarWhileComplete = await req('/app/calendar')
  check('/app/calendar renders once onboarding is complete', calendarWhileComplete.status === 200, `status ${calendarWhileComplete.status}`)

  const settingsWhileComplete = await req('/app/settings')
  check('/app/settings renders once onboarding is complete', settingsWhileComplete.status === 200, `status ${settingsWhileComplete.status}`)

  console.log(`\n${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exit(1)
}

main().catch(err => { console.error(err); process.exit(1) })
