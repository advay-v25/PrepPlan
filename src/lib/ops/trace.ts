/** One-line JSON operational events with redaction: no email addresses, tokens, keys or free text ever reach the log. */
const SECRET_KEY = /token|secret|password|key|authorization|cookie|email|message|answer|stem/i
function redact(v: unknown, depth = 0): unknown {
  if (v == null || typeof v === 'number' || typeof v === 'boolean') return v
  if (typeof v === 'string') return v.length > 120 ? `${v.slice(0, 20)}…[${v.length}]` : v.replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[email]').replace(/eyJ[\w-]{10,}\.[\w-]+\.[\w-]+/g, '[jwt]')
  if (depth > 3) return '[deep]'
  if (Array.isArray(v)) return v.slice(0, 10).map(x => redact(x, depth + 1))
  if (typeof v === 'object') return Object.fromEntries(Object.entries(v as object).map(([k, x]) => [k, SECRET_KEY.test(k) ? '[redacted]' : redact(x, depth + 1)]))
  return String(v)
}
/** area: auth | paper | content | reminders | account | health. Ids (uuids) are fine; addresses and text are not. */
export function trace(area: string, event: string, fields: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ t: new Date().toISOString(), area, event, rev: process.env.RELEASE_REVISION ?? 'dev', ...(redact(fields) as object) }))
}
