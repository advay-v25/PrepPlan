/** Requests for full curriculum instruction belong outside Roadmap's scope. */
export function isTutoringRequest(message: string): boolean {
  return /\b(?:teach me|teach (?:this|the|a|an) (?:chapter|topic|subject)|explain (?:the entire|this entire|this whole) (?:chapter|topic|subject)|solve (?:this|the|my) (?:question|problem)|walk me through (?:this|the) (?:chapter|subject))\b/i.test(message)
}

export const TUTORING_BOUNDARY_REPLY =
  'Roadmap does not teach chapters or solve your curriculum questions. Use your course material or instructor for the explanation, then return to Curriculum to mark what you covered and Tests to check what held. I can help you choose the next topic, identify the weak point, and plan a re-check.'
