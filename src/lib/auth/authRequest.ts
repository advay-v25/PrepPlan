export async function authRequest(action: string, fields: Record<string, unknown> = {}) {
  const response = await fetch('/api/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...fields }),
    cache: 'no-store',
  })
  const data = await response.json().catch(() => null) as { error?: string; code?: string; next?: string; providerUrl?: string } | null
  return { ok: response.ok, status: response.status, data }
}
