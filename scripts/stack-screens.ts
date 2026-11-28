/**
 * Before/after screenshots of the student routes at desktop and 390 px, for a fresh and a history persona, on the isolated local stack only.
 *   OUT=before|after  ROUTES=/app,/app/calendar,...   (needs stack.env sourced and the app running)
 * Fixture students only, deleted by id. Images land in docs/evidence/phase4-screens/<OUT>-<persona>-<viewport>-<route>.png
 */
import { chromium } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { createStudent, createSession } from './lib/e2eSession'
import fs from 'node:fs'
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!, base = process.env.E2E_BASE_URL!
if (process.env.LOCAL_STACK !== '1' || !/^http:\/\/127\.0\.0\.1:\d+$/.test(new URL(url).origin)) throw new Error('Local stack only: source its stack.env.')
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const OUT = process.env.OUT ?? 'before', routes = (process.env.ROUTES ?? '/app,/app/calendar,/app/tests,/app/coach,/app/curriculum,/app/log,/app/settings').split(',')
const views = { desktop: { width: 1280, height: 900 }, 'mobile-390': { width: 390, height: 844 } } as const
async function main() {
  const owned: string[] = []; fs.mkdirSync('docs/evidence/phase4-screens', { recursive: true })
  const browser = await chromium.launch()
  try {
    for (const persona of ['fresh', 'history'] as const) {
      const st = await createStudent(admin, `scr${persona}`, { onboard: true, register: id => owned.push(id) })
      if (persona === 'history') {
        const s = createSession(admin, st.email); await s.signIn()
        const { data: blocks } = await admin.from('plan_blocks').select('id,revision,lm_id,outcome_id').eq('user_id', st.id).eq('task_type', 'study').is('cancelled_at', null).order('local_date').limit(8)
        for (const b of blocks ?? []) {
          const o = b.outcome_id ?? (await admin.from('reading_los').select('id').eq('reading_id', b.lm_id!).order('sequence').limit(1).single()).data!.id
          await s.post('/api/log-learning/planned', { task_id: b.id, expected_revision: b.revision, execution: 'completed', duration_minutes: 40, outcome_ids: [o], idempotency_key: crypto.randomUUID() })
        }
      }
      for (const [vp, size] of Object.entries(views)) {
        const ctx = await browser.newContext({ viewport: size, baseURL: base, timezoneId: 'Europe/London', locale: 'en-GB', reducedMotion: 'reduce', hasTouch: vp !== 'desktop', isMobile: vp !== 'desktop' })
        const page = await ctx.newPage()
        const { data } = await admin.auth.admin.generateLink({ type: 'magiclink', email: st.email })
        await page.goto(`/auth/verify#${new URLSearchParams({ token_hash: data!.properties!.hashed_token, type: 'magiclink', next: '/app' })}`)
        await page.getByRole('button', { name: 'Confirm sign-in', exact: true }).click(); await page.waitForURL(u => u.pathname === '/app')
        for (const r of routes) {
          await page.goto(r); await page.waitForLoadState('load'); await page.waitForTimeout(400)
          await page.screenshot({ path: `docs/evidence/phase4-screens/${OUT}-${persona}-${vp}-${r.replace(/\//g, '_').replace(/^_/, '')}.png`, fullPage: false })
        }
        await ctx.close()
      }
    }
  } finally { await browser.close(); for (const id of owned) await admin.auth.admin.deleteUser(id) }
}
main().catch(e => { console.error(e); process.exit(1) })
