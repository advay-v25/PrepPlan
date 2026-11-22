const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

function parseOrigin(value: string | null | undefined) {
  if (!value) return null
  try {
    const url = new URL(value)
    if (url.origin !== value.replace(/\/$/, '') || !['http:', 'https:'].includes(url.protocol)) return null
    return url
  } catch { return null }
}

/** Auth redirects are built from configuration, or a verified loopback origin for local use. */
export function authOrigin(request: Request) {
  const configured = parseOrigin(process.env.NEXT_PUBLIC_SITE_URL)
  const incoming = new URL(request.url)
  const explicit = parseOrigin(request.headers.get('origin'))
  const allowLoopback = process.env.NODE_ENV !== 'production' || LOOPBACK.has(configured?.hostname ?? '')
  if (allowLoopback && LOOPBACK.has(incoming.hostname)) {
    if (explicit && LOOPBACK.has(explicit.hostname) && explicit.port === incoming.port && explicit.protocol === incoming.protocol) return explicit.origin
    return incoming.origin
  }
  return configured?.protocol === 'https:' && !LOOPBACK.has(configured.hostname)
    ? configured.origin
    : process.env.NODE_ENV !== 'production' ? configured?.origin ?? null : null
}

export function authCookiesSecure() {
  return parseOrigin(process.env.NEXT_PUBLIC_SITE_URL)?.protocol === 'https:'
}
export const sessionCookieOptions = () => ({ httpOnly: true, sameSite: 'lax' as const, secure: authCookiesSecure(), path: '/' })

export const AUTH_PRIVATE_CACHE = 'private, no-store, max-age=0'

export function appRequestRefusal(request: Request) {
  if (!MUTATING.has(request.method)) return null
  const origin = request.headers.get('origin')
  const site = request.headers.get('sec-fetch-site')
  if (site === 'cross-site' || site === 'same-site' || (origin !== null && parseOrigin(origin)?.origin !== authOrigin(request))) {
    return Response.json({ code: 'ORIGIN_REFUSED', error: 'Open PrepPlan directly and try again.' }, { status: 403, headers: { 'Cache-Control': AUTH_PRIVATE_CACHE } })
  }
  // JSON routes have stronger per-route limits where payload sizes are known.
  const size = Number(request.headers.get('content-length') ?? 0)
  if (size > 1024 * 1024) return Response.json({ code: 'REQUEST_TOO_LARGE', error: 'That request is too large.' }, { status: 413 })
  return null
}

export class JsonInputError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

export async function readBoundedJson(request: Request, maxBytes: number): Promise<unknown> {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new JsonInputError(415, 'Send a JSON request.')
  }
  if (Number(request.headers.get('content-length') ?? 0) > maxBytes) throw new JsonInputError(413, 'That request is too large.')
  if (!request.body) throw new JsonInputError(400, 'Enter valid details and try again.')
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > maxBytes) {
        void reader.cancel().catch(() => {})
        throw new JsonInputError(413, 'That request is too large.')
      }
      chunks.push(chunk.value)
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch (error) {
    if (error instanceof JsonInputError) throw error
    throw new JsonInputError(400, 'Enter valid details and try again.')
  } finally { reader.releaseLock() }
}
