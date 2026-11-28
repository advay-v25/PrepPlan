/** Real FlashcardReview in Chromium with controlled HTTP replies. Component proof only: no Auth, database or provider. */
const assert = require('node:assert/strict')
const http = require('node:http')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { build } = require('esbuild')
const { chromium, expect } = require('@playwright/test')

async function main() {
  const root = path.resolve(__dirname, '..'), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prepplan-card-review-'))
  let browser, server, passed = 0
  try {
    await build({ stdin: { contents: `import {createRoot} from 'react-dom/client'; import {FlashcardReview} from './src/components/curriculum/FlashcardReview'; createRoot(document.getElementById('root')).render(<FlashcardReview cards={[window.testCard]} onDone={() => {}} />);`, resolveDir: root, loader: 'tsx' }, bundle: true, jsx: 'automatic', platform: 'browser', define: { 'process.env.NODE_ENV': '"production"' }, outfile: path.join(dir, 'bundle.js') })
    server = http.createServer((req, res) => {
      if (req.url === '/bundle.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(fs.readFileSync(path.join(dir, 'bundle.js'))); return }
      res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Recall regression</title><main id="root"></main><script src="/bundle.js"></script>')
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const origin = `http://127.0.0.1:${server.address().port}`
    browser = await chromium.launch()
    for (const width of [1280, 390]) for (const scenario of ['last', 'again', 'lost-response', 'stale-later']) {
      const context = await browser.newContext({ viewport: { width, height: 844 } })
      try {
        const page = await context.newPage(), requests = [], unexpected = []
        page.on('pageerror', e => unexpected.push(e.message))
        page.on('console', msg => {
          if (msg.type() !== 'error') return
          const expected = msg.location().url === `${origin}/api/curriculum/flashcards`
            && (scenario === 'lost-response' && /net::ERR_FAILED/.test(msg.text()) || scenario === 'stale-later' && /409/.test(msg.text()))
          if (!expected) unexpected.push(msg.text())
        })
        const card = { id: 'owned-card', front: 'Recall question', back: 'Recall answer', due_at: new Date(Date.now() - 60_000).toISOString(), revision: 1, reps: 0 }
        await page.addInitScript(card => { window.testCard = card }, card)
        const dueAt = new Date(Date.now() + (scenario === 'again' || scenario === 'stale-later' ? 600_000 : 86400_000)).toISOString()
        let commits = 0
        await page.route('**/api/curriculum/flashcards', async route => {
          const body = route.request().postDataJSON(); requests.push(body)
          assert.equal(body.expectedRevision, 1)
          if (scenario === 'lost-response' && requests.length === 1) { commits++; await route.abort('failed'); return }
          if (scenario !== 'lost-response' && scenario !== 'stale-later') commits++
          await route.fulfill({ status: scenario === 'stale-later' ? 409 : 200, contentType: 'application/json', body: JSON.stringify({ ok: scenario !== 'stale-later', ...(scenario === 'stale-later' ? { code: 'STALE_CARD' } : {}), replay: scenario === 'lost-response', card: { ...card, due_at: dueAt, revision: 2, reps: scenario === 'again' ? 0 : 1 } }) })
        })
        await page.goto(origin)
        await page.getByRole('button', { name: 'Show the answer', exact: true }).click()
        const rating = scenario === 'again' ? 'Again' : 'Good'
        await page.getByRole('button', { name: rating, exact: true }).click()
        if (scenario === 'lost-response') {
          await expect(page.getByRole('alert')).toBeVisible()
          await page.getByRole('button', { name: rating, exact: true }).click()
          assert.deepEqual(requests[0], requests[1], 'retry must preserve the exact key, rating and revision')
        }
        if (scenario === 'stale-later') {
          await expect(page.getByText(/was rescheduled elsewhere/)).toBeVisible()
          await expect(page.getByText('Nothing to review right now.', { exact: true })).toBeVisible()
          assert.equal(commits, 0, 'a stale rating is never reported as this session\'s review')
        } else {
          await expect(page.getByText('You reviewed 1 card.', { exact: true })).toBeVisible()
          assert.equal(commits, 1)
        }
        await expect(page.getByRole('button', { name: 'Show the answer', exact: true })).toHaveCount(0)
        await page.getByRole('button', { name: 'Check again', exact: true }).click()
        await expect(page.getByText('Not due yet.', { exact: true })).toBeVisible()
        const expectedCalls = scenario === 'lost-response' ? 2 : 1
        assert.equal(requests.length, expectedCalls, 'a future card must not be rated again immediately')
        assert.deepEqual(unexpected, [])
        assert.ok(await page.evaluate(width => document.documentElement.clientWidth <= width && document.documentElement.scrollWidth <= document.documentElement.clientWidth, width))
        passed++; console.log(`PASS ${width}px ${scenario}`)
      } finally { await context.close() }
    }
    assert.equal(passed, 8)
    console.log('8 component-browser checks passed; 0 authenticated app assertions (controlled responses only).')
  } finally {
    if (browser) await browser.close()
    if (server) await new Promise(resolve => server.close(resolve))
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
main().catch(e => { console.error(e); process.exitCode = 1 })
