import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { scopedErrors } from '../tests/e2e/lifecycle/scopedErrors'

class FakePage extends EventEmitter {
  private closed = false
  url() { return 'http://127.0.0.1:3150/app/tests/review/item-1' }
  mainFrame() { return this }
  isClosed() { return this.closed }
}

async function main() {
  const errs = scopedErrors()
  const page = new FakePage()
  errs.attach(page as any)

  const req = (url: string, opts: { method?: string; headers?: Record<string, string>; errorText?: string; isNav?: boolean } = {}) => ({
    url: () => url,
    method: () => opts.method ?? 'GET',
    headers: () => opts.headers ?? {},
    failure: () => opts.errorText ? { errorText: opts.errorText } : null,
    isNavigationRequest: () => Boolean(opts.isNav),
    frame: () => page,
  })

  // 1. Speculative Next prefetch cancelled on navigation -> allowed
  page.emit('requestfailed', req('http://127.0.0.1:3150/app?_rsc=abc', { headers: { rsc: '1', 'next-router-prefetch': '1' }, errorText: 'net::ERR_ABORTED' }))
  assert.equal(errs.unexpected.length, 0)
  assert.equal(errs.allowances.length, 1)

  // 2. Aborted API request -> MUST fail
  page.emit('requestfailed', req('http://127.0.0.1:3150/api/diagnostic/items/x/review', { method: 'POST', errorText: 'net::ERR_ABORTED' }))
  assert.ok(errs.unexpected.some(m => m.includes('/api/diagnostic/items/x/review')))

  // 3. Failed document load -> MUST fail
  page.emit('requestfailed', req('http://127.0.0.1:3150/app/tests/review/item-1/preview', { errorText: 'net::ERR_CONNECTION_REFUSED', isNav: true }))
  assert.ok(errs.unexpected.some(m => m.includes('/preview')))

  // 4. Uncategorized RSC failure (no prefetch header and no superseding navigation) -> MUST fail after 2.1s window
  page.emit('requestfailed', req('http://127.0.0.1:3150/app/tests/review/item-1?_rsc=xyz', { headers: { rsc: '1' }, errorText: 'net::ERR_ABORTED' }))
  await new Promise(r => setTimeout(r, 2250))
  assert.ok(errs.unexpected.some(m => m.includes('/app/tests/review/item-1') && m.includes('no navigation superseded it')))

  // 5. Real console error & pageerror -> MUST fail
  page.emit('console', { type: () => 'error', text: () => 'Hydration failed', location: () => ({ url: '' }) })
  page.emit('pageerror', new Error('Uncaught Boom'))
  assert.ok(errs.unexpected.some(m => m.includes('Hydration failed')))
  assert.ok(errs.unexpected.some(m => m.includes('PAGEERROR')))

  console.log('scoped-errors-test: PASS')
}

main().catch(e => { console.error(e); process.exit(1) })
