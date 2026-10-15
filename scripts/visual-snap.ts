/**
 * Visual baseline — not a pass/fail assertion, a review aid. The 430+
 * existing checks are HTTP-and-text assertions: they cannot catch "this page
 * looks broken," only "this HTML still contains the right strings." This
 * captures ~10 routes at three widths so a person can look at them.
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'fs'

const BASE_URL = process.env.SNAP_BASE_URL ?? 'http://localhost:3000'
const OUT_DIR = 'scripts/.visual-snap-out'

const ROUTES = [
  '/',
  '/app',
  '/app/settings',
  '/app/tests',
  '/app/curriculum',
  '/app/calendar',
  '/onboarding/exam',
  '/onboarding/route',
  '/onboarding/week',
  '/onboarding/plan',
]

const WIDTHS: [string, number][] = [
  ['375', 375],
  ['834', 834],
  ['1440', 1440],
]

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })
  const browser = await chromium.launch()
  for (const [label, width] of WIDTHS) {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    for (const route of ROUTES) {
      const safeName = route === '/' ? 'root' : route.slice(1).replace(/\//g, '-')
      try {
        await page.goto(`${BASE_URL}${route}`, { waitUntil: 'networkidle', timeout: 15000 })
        await page.screenshot({ path: `${OUT_DIR}/${safeName}-${label}.png`, fullPage: true })
        console.log(`  ✓ ${route} @ ${label}px`)
      } catch (e) {
        console.log(`  ✗ ${route} @ ${label}px — ${(e as Error).message}`)
      }
    }
    await page.close()
  }
  await browser.close()
  console.log(`\nSnapshots written to ${OUT_DIR}/`)
}

main()
