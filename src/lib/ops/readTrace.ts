/**
 * Optional, off by default: with TRACE_READS=1 every database request a server client makes is logged as one line ("GET table?select=…"),
 * ids and values removed, so duplicate reads and sequential chains in a page can be counted. Nothing is logged, and no wrapper is installed, otherwise.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
/** Names the part of a request that issues the reads below it (e.g. "coach:tracker"), so counts can be attributed even when sources load in parallel. */
export const readSource = new AsyncLocalStorage<string>()
export const tagReads = <T,>(name: string, work: () => Promise<T>): Promise<T> => process.env.TRACE_READS === '1' ? readSource.run(name, work) : work()

export const tracedFetch: typeof fetch | undefined = process.env.TRACE_READS === '1'
  ? (input, init) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url
    const u = new URL(raw)
    const q = u.search.replace(/=(eq|in|gte|lte|gt|lt|neq|is)\.[^&]*/g, '=$1.…').replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, ':id')
    console.log(`[reads] ${readSource.getStore() ?? '-'} ${init?.method ?? 'GET'} ${u.pathname.replace('/rest/v1/', '')}${q}`)
    return fetch(input, init)
  }
  : undefined
