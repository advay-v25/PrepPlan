import type { CoachIntent } from './actions'
import type { Interpretation } from './interpret'
import type { PendingContext } from './service'

/**
 * Short follow-ups ("the second one", "Friday", "no, not tomorrow, Friday", "yes") are read against the ONE outstanding clarification or
 * proposal stored with the last answer. A different topic ends that context. Pure: the stored context is passed in.
 */
const ORDINALS: [RegExp, number][] = [[/\b(?:the )?(?:first|1st)\b(?: one)?/, 0], [/\b(?:the )?(?:second|2nd)\b(?: one)?/, 1], [/\b(?:the )?(?:third|3rd)\b(?: one)?/, 2]]
export const isAffirmation = (m: string) => /^(?:yes|yep|yeah|yup|confirm|confirmed|do it|go ahead|ok(?:ay)?|sure|please do)[\s.!]*$/i.test(m.trim())

export type Merged = { intent: CoachIntent; taskId: string | null; when: string | null; amends: boolean; reason: 'choice' | 'day' | 'correction' | null }

export function mergePending(i: Interpretation, pending: PendingContext | null, message: string, selectedTaskId: string | null): Merged {
  const plain: Merged = { intent: i.primary, taskId: selectedTaskId, when: i.when, amends: false, reason: null }
  if (!pending || pending.intent !== 'move_block') return plain
  // A clearly different request is a topic change: nothing from the old context carries over.
  if (i.primary !== 'free' && i.primary !== 'move_block' && !(i.correction && i.primary === 'today')) return plain
  const m = i.normalised
  const ordinal = !i.when ? ORDINALS.find(([re]) => re.test(m)) : undefined
  if (ordinal && pending.taskChoices?.[ordinal[1]]) return { intent: 'move_block', taskId: pending.taskChoices[ordinal[1]], when: pending.when ?? null, amends: false, reason: 'choice' }
  if (/\b(?:this|that) one\b/.test(m) && pending.taskChoices?.length === 1) return { intent: 'move_block', taskId: pending.taskChoices[0], when: i.when ?? pending.when ?? null, amends: false, reason: 'choice' }
  if (i.when) return { intent: 'move_block', taskId: selectedTaskId ?? pending.taskId ?? null, when: i.when, amends: Boolean(pending.when) || i.correction, reason: i.correction ? 'correction' : 'day' }
  return plain
}
