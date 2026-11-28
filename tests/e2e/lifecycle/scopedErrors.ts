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
    const navTimes: number[] = []
    page.on('framenavigated', f => { if (f === page.mainFrame()) navTimes.push(Date.now()) })
    const rscReads: { req: unknown; path: string; at: number }[] = []
    page.on('request', r => {
      if (r.headers()['rsc'] === '1' && r.method() === 'GET') rscReads.push({ req: r, path: new URL(r.url()).pathname, at: Date.now() })
      if (r.isNavigationRequest() && r.frame() === page.mainFrame()) navTimes.push(Date.now())
    })
    page.on('requestfailed', r => {
      const u = new URL(r.url())
      if (r.method() === 'GET' && r.failure()?.errorText === 'net::ERR_ABORTED' && u.pathname === '/api/tests/scope/confirm' && cancelledScopeReads.has(u.searchParams.get('blockId') ?? '')) {
        allowances.push({ label:'owned drawer cancels its read on revision change/unmount (TaskLearningScope cleanup)', taskId:u.searchParams.get('blockId') }); return
      }
      // Local-stack runs use a Next DEV server (the only mode that serves fixture items). React Strict Mode mounts effects twice there, which cancels the first GET of an endpoint a page reads on mount.
      // Never applies to production-build runs, and only to that one GET.
      if (process.env.E2E_SUITE === 'local-stack' && r.method() === 'GET' && r.failure()?.errorText === 'net::ERR_ABORTED' && (/^\/api\/tests\/attempt\/[0-9a-f-]{36}$/.test(u.pathname) || u.pathname === '/api/log-learning' || u.pathname === '/api/tests/scope/confirm')) {
        allowances.push({ label: 'dev-server Strict Mode cancels the first read of a page-owned GET endpoint', path: u.pathname }); return
      }
      // Next cancels speculative route prefetches when a real navigation supersedes them. This cannot cover an API call or a user-initiated document load.
      if (r.method() === 'GET' && r.failure()?.errorText === 'net::ERR_ABORTED' && r.headers()['rsc'] === '1' && r.headers()['next-router-prefetch'] === '1') {
        allowances.push({ label: 'cancelled speculative Next route prefetch', path: new URL(r.url()).pathname }); return
      }
      // Account deletion navigates away while Next may still be refreshing that page. This is markup, not an account/API operation.
      if (r.method() === 'GET' && r.failure()?.errorText === 'net::ERR_ABORTED' && r.headers()['rsc'] === '1' && new URL(r.url()).pathname === '/account' && new URL(r.url()).searchParams.has('_rsc')) {
        allowances.push({ label: 'cancelled Account page read during navigation; destination is asserted by the account journey', path: '/account' }); return
      }
      const abortedRsc = u.searchParams.has('_rsc') && !u.pathname.startsWith('/api/')
        && r.failure()?.errorText === 'net::ERR_ABORTED'
      // A soft-navigation or router.refresh() fetch that the page's own next navigation supersedes. Covered only when a real navigation of this page happens within 2s of the abort; an
      // aborted RSC read with no navigation around it (a hang, a dropped connection) is still reported, after that window.
      if (abortedRsc && r.method() === 'GET' && !active.some(x => x.url.test(r.url()))) {
        const at = Date.now(), started = rscReads.find(x => x.req === r)?.at ?? at
        setTimeout(() => {
          // A router.refresh() replaced by a newer read of the same page (back-to-back saves) is the same supersession, with a read that really started after the abort began.
          const replaced = rscReads.some(x => x.req !== r && x.path === u.pathname && x.at >= started && x.at <= at + 2000)
          if (page.isClosed() || navTimes.some(t => Math.abs(t - at) <= 2000) || replaced) {
            allowances.push({ label: 'RSC page read cancelled during navigation or page close', path: u.pathname })
          } else {
            unexpected.push(`requestfailed ${u.pathname} ${r.failure()?.errorText} (no navigation superseded it)`)
          }
        }, 2100)
        return
      }
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
