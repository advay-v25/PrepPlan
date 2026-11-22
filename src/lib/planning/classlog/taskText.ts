import { formatStudyDate } from '../../format/date'
/**
 * Meaning for generated class-follow-up sittings (pure). These fill the EXISTING task-semantic fields (objective, why now, approach, what done
 * means, how it is verified). They describe a study METHOD for the student's own course material: no lesson content, no invented page numbers,
 * no explanations of answers, no promise of readiness.
 */
import type { Extent } from './consolidation'

export type SittingTextInput = {
  outcomeTitle: string
  readingNo: number
  readingTitle: string
  classDate: string
  /** Which class it was (its own name) and, when it was moved, the day it was originally scheduled: two classes on one day must not read alike. */
  classLabel?: string | null
  classOriginalDate?: string | null
  extent: Extent
  revision: boolean
  /** The student's own words about which part was covered (only meaningful for a part). */
  portionNote?: string | null
  /** 1-based position among this item's sittings, and the settled total (null while more is still to be placed). */
  index: number
  count: number | null
}

export type SittingText = {
  objective: string
  rationale: string
  approach: string
  completion: string
  verification: string
  reference: string
}

const which = (i: { classLabel?: string | null; classOriginalDate?: string | null; classDate: string }) =>
  i.classLabel ? ` (${i.classLabel}${i.classOriginalDate && i.classOriginalDate !== i.classDate ? `, moved from ${day(i.classOriginalDate)}` : ''})` : ''
const day = (d: string) => formatStudyDate(d, 'long')

const RECALL = 'Close your notes and write down everything you can recall about this, in your own words. Then open your own notes or the matching section of your book and mark what you got right and what you left out.'
const APPLY = 'Choose a short worked example or practice question on this from your own course material and attempt it without looking at the solution. Then compare with the solution and note where you differed.'
const REVIEW = 'Recall it once more from memory, then check against your own material and list anything still unclear so you can bring it to your next class or study session.'

/** Which part of the activity a sitting does, so no two sittings of one piece of work read alike. */
function step(index: number, count: number | null): { focus: string; approach: string } {
  if (count === 1) return { focus: 'recall it, check what you missed, then try one application', approach: `${RECALL} ${APPLY}` }
  if (index === 1) return { focus: 'recall it from memory and check what you missed', approach: RECALL }
  if (count !== null && index === count) return { focus: 'recall it again, check the gaps and note what is still unclear', approach: `${REVIEW}` }
  return { focus: 'apply it to a worked example from your own material', approach: APPLY }
}

export function sittingText(i: SittingTextInput): SittingText {
  const scope = i.extent === 'full' ? 'the whole outcome' : i.extent === 'continued' ? 'the continuing portion covered in class' : 'the part of it covered in class'
  const note = i.extent === 'part' && i.portionNote ? ` (you noted: “${i.portionNote}”)` : ''
  const target = `${i.outcomeTitle} — Reading ${i.readingNo}, ${i.readingTitle}`
  const s = step(i.index, i.count)
  const several = i.count === null || i.count > 1
  const where = i.count === null ? `Sitting ${i.index} of this work (more is still to be placed).` : `Sitting ${i.index} of ${i.count}.`
  const verb = i.revision ? 'Revise' : 'Consolidate'
  const objective = `${verb} ${scope}${note}: ${target}.${several ? ` ${where} This sitting: ${s.focus}.` : ''}`
  const rationale = i.revision
    ? `Your ${i.classLabel ? `${i.classLabel} class on ${day(i.classDate)}` : `${day(i.classDate)} class`} went back over this, so it is planned as revision of material you have already met. It is a plan assumption, not a judgement of what you know.`
    : `Covered in class on ${day(i.classDate)}${which(i)}. It is planned on a later day, inside the study time you actually have left, while the class is still recent. It is a plan assumption, not a judgement of what you know.`
  const approach = `${i.index > 1 ? `This continues sitting ${i.index - 1}: start from the gaps you marked there. ` : ''}${s.approach}`
  const completion = `Done when you have attempted this using your own material. If you only got part of the way, record it as partly done with the minutes you actually spent.${several ? ` This records this sitting only${i.count === null ? '' : ` (${i.index} of ${i.count})`}; the whole outcome is confirmed separately.` : ''}`
  const verification = i.extent === 'full'
    ? 'When every sitting is done and you confirm what you covered, a later weekly paper can test this outcome. Doing the sitting does not itself show that you understand it.'
    : 'You logged only part of this in class, so it stays pending: it is not tested until you log it as “All of it” in a later class or confirm that you covered the whole outcome.'
  return { objective, rationale, approach, completion, verification, reference: `Reading ${i.readingNo}: ${i.readingTitle}` }
}

/** Title suffix for a linked sitting; empty for a single, settled sitting. */
export function sittingSuffix(index: number, count: number | null): string {
  if (count === 1) return ''
  return count === null ? ` · sitting ${index}` : ` · sitting ${index} of ${count}`
}
