import { trace } from './trace'

/** The application message is safe to show. The database code stays in the support log. */
export function recordFailure(operation: string, cause: unknown, status = 500) {
  const requestId = crypto.randomUUID()
  const code = cause && typeof cause === 'object' && 'code' in cause ? cause.code : null
  const databaseCode = typeof code === 'string' && /^[a-z\d_-]{1,40}$/i.test(code) ? code : null
  trace('app', 'failure', { operation, requestId, status, databaseCode })
  return requestId
}

export function routeFailure(operation: string, message: string, cause: unknown, status = 500) {
  const requestId = recordFailure(operation, cause, status)
  return Response.json({ ok: false, error: message, requestId }, { status })
}
