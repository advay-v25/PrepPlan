import type { Page } from '@playwright/test'

/**
 * Scoped allowances for deliberate faults. A rule exists only while its step runs, names ONE request (URL + status or failure), and must really be observed (`min`).
 * Everything else — another URL, another status, the same request in another step, any other console or page error — is collected as unexpected.
 */
export type Rule = { label: string; url: RegExp; statuses?: number[]; failed?: boolean; method?: string; failureText?: string; min: number; max: number; seen: number }
export function scopedErrors() {
  const active: Rule[] = [], unexpected: string[] = [], allowances: unknown[] = []
  const cancelledScopeReads = new Set<string>()
  async function expecting<T>(rules: Omit<Rule, 'seen'>[], fn: () => Promise<T>): Promise<T> {
    const rs = rules.map(r => ({ ...r, seen: 0 })); active.push(...rs)
    try { return await fn() } finally {
      await new Promise(r => setTimeout(r, 300))
      for (const r of rs) { active.splice(active.indexOf(r), 1); allowances.push({ label: r.label, seen: r.seen, min: r.min, max: r.max }); if (r.seen < r.min) unexpected.push(`expected event never observed: ${r.label}`) }
    }
  }
  const attach = (page: Page) => {
    page.on('requestfailed', r => {
      const u = new URL(r.url())
      if (r.method() === 'GET' && r.failure()?.errorText === 'net::ERR_ABORTED' && u.pathname === '/api/tests/scope/confirm' && cancelledScopeReads.has(u.searchParams.get('blockId') ?? '')) {
        allowances.push({ label:'owned drawer cancels its read on revision change/unmount (TaskLearningScope cleanup)', taskId:u.searchParams.get('blockId') }); return
      }
      // Next cancels speculative route prefetches when a real navigation supersedes them. This cannot cover an API call or a user-initiated document load.
      if (r.method() === 'GET' && r.failure()?.errorText === 'net::ERR_ABORTED' && r.headers()['rsc'] === '1' && r.headers()['next-router-prefetch'] === '1') {
        allowances.push({ label: 'cancelled speculative Next route prefetch', path: new URL(r.url()).pathname }); return
      }
      // Account deletion navigates away while Next may still be refreshing that page. This is markup, not an account/API operation.
      if (r.method() === 'GET' && r.failure()?.errorText === 'net::ERR_ABORTED' && r.headers()['rsc'] === '1' && new URL(r.url()).pathname === '/account' && new URL(r.url()).searchParams.has('_rsc')) {
        allowances.push({ label: 'cancelled Account page read during navigation; destination is asserted by the account journey', path: '/account' }); return
      }
      const abortedRsc = /[?&]_rsc=/.test(r.url()) && r.failure()?.errorText === 'net::ERR_ABORTED'
      const hit = active.find(x => x.seen < x.max && x.url.test(r.url()) && x.failed && (!x.method || x.method === r.method()) && (!x.failureText || x.failureText === r.failure()?.errorText))
      if (hit) hit.seen++; else if (!abortedRsc || !active.some(x => x.label.startsWith('navigation'))) unexpected.push(`requestfailed ${r.url()} ${r.failure()?.errorText}`)
    })
    page.on('response', r => {
      if (r.status() < 400) return
      const hit = active.find(x => x.seen < x.max && x.url.test(r.url()) && x.statuses?.includes(r.status()))
      if (hit) hit.seen++; else unexpected.push(`HTTP ${r.status()} ${r.url()}`)
    })
    page.on('console', m => {
      if (m.type() !== 'error') return
      if (/^Failed to load resource/.test(m.text())) { if (!active.some(x => x.url.test(m.location().url))) unexpected.push(`console resource error ${m.location().url} ${m.text().slice(0, 120)}`); return }
      unexpected.push(`${page.url()} ${m.text().slice(0, 200)}`)
    })
    page.on('pageerror', e => unexpected.push(`PAGEERROR ${page.url()} ${e.message.slice(0, 200)}`))
  }
  return { expecting, attach, unexpected, allowances, allowCancelledScopeRead: (taskId: string) => cancelledScopeReads.add(taskId) }
}
