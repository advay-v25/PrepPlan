import { normalise, teachingComponent } from './interpret'

/** Requests for curriculum instruction belong outside Roadmap's scope; study-method and app help do not (see interpret.ts). */
export function isTutoringRequest(message: string): boolean {
  return teachingComponent(normalise(message))
}

export const TUTORING_BOUNDARY_REPLY =
  'Roadmap does not teach chapters or solve your curriculum questions. Use your course material or instructor for the explanation, then return to Curriculum to mark what you covered and Tests to check what held. I can help you choose the next topic, identify the weak point, and plan a re-check.'
