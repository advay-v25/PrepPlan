import { UncertainDelivery, type Transport } from './service'
import { budgetFetch } from '../ops/requestBudget'

/** Resend over HTTPS. A request that fails before leaving is a plain failure; a timeout after it left is UNCERTAIN and is never retried automatically. */
export function resendTransport(): Transport {
  const key = process.env.RESEND_API_KEY, from = process.env.RESEND_FROM_EMAIL
  if (!key || !from) throw new Error('RESEND_API_KEY and RESEND_FROM_EMAIL are required to send reminders.')
  return {
    async send(m) {
      let res: Response
      try {
        res = await budgetFetch(fetch)('https://api.resend.com/emails', { method: 'POST', signal: AbortSignal.timeout(10_000),
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': m.idempotencyKey },
          body: JSON.stringify({ from, to: [m.to], subject: m.subject, text: m.text }) })
      } catch (e) { throw (e as Error).name === 'TimeoutError' || (e as Error).name === 'AbortError' ? new UncertainDelivery('timeout after send') : e }
      if (res.status >= 500) throw new UncertainDelivery(`provider ${res.status}`)
      if (!res.ok) throw new Error(`provider rejected (${res.status})`)
      return { id: String(((await res.json().catch(() => ({}))) as { id?: string }).id ?? '') }
    },
  }
}
