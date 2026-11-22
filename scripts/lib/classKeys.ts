/** Test helpers: planning suites name a class by its date; the commands now require the class. These key a date-only input to the timetable's occurrence on it. */
import { randomUUID } from 'node:crypto'
/** Fixture fallback made VISIBLE: when no pending timetable class exists on the date, a separate manual session is created and this says so. */
export const manualFallback = (date: string) => { console.log(`  [fixture] no pending timetable class on ${date}: logging a SEPARATE manual session (not a scheduled class)`); return `manual:${randomUUID()}` }
import { getClassLogContext, previewClassLog } from '../../src/lib/planning/classlog/service'

export async function occurrenceOn(userId: string, date: string) {
  const c = await getClassLogContext(userId)
  const occ = c.classLed && c.cycle ? c.occurrences : []
  return occ.find(o => o.date === date && o.status === 'pending') ?? occ.find(o => o.date === date)
}
export async function keyed<T extends { classDate: string; occurrenceKey?: string }>(userId: string, body: T): Promise<T> {
  if ('occurrenceKey' in body) return body
  const c = await getClassLogContext(userId), occ = c.classLed && c.cycle ? c.occurrences : []
  // the date's pending class; with none left, a clearly separate manual session (the old suites logged several times on one date)
  const o = occ.find(x => x.date === body.classDate && x.status === 'pending')
  return { ...body, occurrenceKey: o ? o.key : manualFallback(body.classDate) }
}
export const previewClassLogK = async (userId: string, body: any, now?: Date) => previewClassLog(userId, await keyed(userId, body), now)

/** A signed-in client whose apply_class_log calls name the class on p_class_date (replays stay stable: the occurrence is chosen by date, not status). */
export function keyedClient<C extends { rpc: (...a: any[]) => any; auth: { getUser: () => Promise<any> } }>(c: C): C {
  const rpc = c.rpc.bind(c), keyOf = new Map<string, { key: string; commitmentId: string | null; originalDate: string | null }>()
  ;(c as any).rpc = async (name: string, args: any, ...rest: any[]) => {
    if (name === 'apply_class_log' && args && args.p_occurrence_key === undefined) {
      let k = keyOf.get(args.p_idempotency_key)
      if (!k) {
        const uid = (await c.auth.getUser()).data.user?.id
        const c0 = uid ? await getClassLogContext(uid) : null
        const pend = c0 && c0.classLed && c0.cycle ? c0.occurrences.find(o => o.date === args.p_class_date && o.status === 'pending') : null
        k = pend ? { key: pend.key, commitmentId: pend.commitmentId, originalDate: pend.key.startsWith('series:') ? pend.originalDate : null } : { key: manualFallback(args.p_class_date), commitmentId: null, originalDate: null }
        keyOf.set(args.p_idempotency_key, k)
      }
      args = { ...args, p_occurrence_key: k.key, p_commitment_id: k.commitmentId, p_occurrence_date: k.originalDate }
    }
    return rpc(name, args, ...rest)
  }
  return c
}
