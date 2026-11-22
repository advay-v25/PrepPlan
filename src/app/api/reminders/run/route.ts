import { trace } from '../../../../lib/ops/trace'
import { NextResponse } from 'next/server'
import { hasBearer } from '../../../../lib/auth/securityServer'
import { deliveryConfigured, runDueReminders } from '../../../../lib/reminders/service'
import { syncReminderBatch } from '../../../../lib/reminders/worker'
import { resendTransport } from '../../../../lib/reminders/transport'
import { boundedStage } from '../../../../lib/ops/requestBudget'

export const dynamic = 'force-dynamic'

/**
 * The reminder worker tick (scheduler/cron calls it every few minutes): schedule from live state, then send what is due.
 * Authorised by `Authorization: Bearer $CRON_SECRET` only. Without a configured provider it still schedules and reports `transport: "not_configured"`.
 */
export async function POST(request: Request) {
  if (!hasBearer(request, process.env.CRON_SECRET)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sync = await syncReminderBatch().catch(() => ({ status: 'failed', students: 0, scheduled: 0, retryNextSweep: 0 } as const))
  let transport = 'not_configured'
  let tally: Awaited<ReturnType<typeof runDueReminders>> | null = null
  if (deliveryConfigured()) {
    try {
      tally = await boundedStage('deliver due reminders', 24_000, () => runDueReminders(resendTransport()))
      transport = 'ready'
    } catch { transport = 'failed' }
  }
  const ok = sync.status !== 'failed' && transport !== 'failed'
  trace('reminders', 'tick', { ...sync, transport, ...(tally ?? {}) })
  return NextResponse.json({ ok, ...sync, transport, ...(tally ? { tally } : {}) }, { status: ok ? 200 : 503 })
}
