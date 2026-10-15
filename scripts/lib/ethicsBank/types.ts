import type { Cognition, ErrorCode, ItemForm } from '../../../src/lib/diagnostic/types'

/**
 * Authoring shape for the Ethics bank. The correct answer is written FIRST and the loader places it, so
 * key positions come out balanced instead of reflecting the author's habits. Each wrong option carries
 * the error it represents (ERROR_TAXONOMY) and a plain-language description of the reasoning behind it.
 *
 *   E = easy   → foundation
 *   M = medium → standard
 *   H = hard   → difficult
 */
export type RawItem = {
  /** Outcome id, e.g. 'r095-b'. */
  o: string
  t: 'E' | 'M' | 'H'
  c: Cognition
  f: ItemForm
  q: string
  ok: string
  w: [text: string, code: ErrorCode, why: string][]
  /** Worked reasoning for why the key is correct. Original wording. */
  sol: string
}
