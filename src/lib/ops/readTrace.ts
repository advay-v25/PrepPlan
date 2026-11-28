/**
 * With TRACE_READS=1, log the method and REST resource for each database request. Query values and
 * auth paths stay out of the trace. Nothing is logged or wrapped otherwise.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash } from 'node:crypto'
/** Names the part of a request that issues the reads below it (e.g. "coach:tracker"), so counts can be attributed even when sources load in parallel. */
export const readSource = new AsyncLocalStorage<string>()
export const tagReads = <T,>(name: string, work: () => Promise<T>): Promise<T> => process.env.TRACE_READS === '1' ? readSource.run(name, work) : work()

export const tracedFetch: typeof fetch | undefined = process.env.TRACE_READS === '1'
  ? (input, init) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url
    const u = new URL(raw)
    if (u.pathname.startsWith('/rest/v1/')) {
      const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
      // TRACE_CALLERS=1 (measurement only) adds the three nearest application function names, so repeated reads can be traced to their owners.
      const who = process.env.TRACE_CALLERS === '1'
        ? ' @' + (new Error().stack ?? '').split('\n').slice(2).map(l => l.trim()).filter(l => !/node_modules|readTrace|node:internal|tracedFetch/.test(l)).slice(0, 4).map(l => (l.match(/at (?:async )?([^\s(]+) \(/)?.[1] ?? l.match(/([\w.-]+\.[tj]sx?):(\d+)/)?.slice(1, 3).join(':') ?? '?').replace(/^Object\./, '')).join('<')
        : ''
      // With TRACE_CALLERS=1 a short digest of the query marks identical requests (same filters, columns and page) without logging any value.
      const same = process.env.TRACE_CALLERS === '1' ? ` #${createHash('sha1').update(u.search + (new Headers(init?.headers).get('range') ?? '')).digest('hex').slice(0, 8)}` : ''
      console.log(`[reads] ${readSource.getStore() ?? '-'} ${method} ${u.pathname.slice('/rest/v1/'.length)}${same}${who}`)
    }
    return fetch(input, init)
  }
  : undefined
