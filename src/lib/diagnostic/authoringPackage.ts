import { PROMPT_VERSIONS } from './promptVersions'

/**
 * The authoring and evaluation package: what is allowed in, what must come out, what is refused, and what each check can and cannot prove.
 * It is DOCUMENTATION THAT CODE ENFORCES: the batch records `PROMPT_VERSIONS` and the model policy at creation and refuses to resume under
 * different ones; the reviewer sees `SEMANTIC_LIMIT_NOTICE` next to every automatic check.
 *
 * Four different things are kept apart, and only the first three exist here:
 *   prompt engineering - the writer/solver instructions (promptVersions.ts), versioned text and schema
 *   grounding          - a source pack's facts, passed as DATA (never instructions), checked for edition, scope, hash and rights
 *   evaluation         - the labelled adversarial cases below, the deterministic gates, the blind solver, and a person
 *   fine-tuning        - NOT used. No model is trained or adapted; swapping a model is a model-policy change, recorded and re-evaluated.
 */
export const AUTHORING_PACKAGE = {
  version: PROMPT_VERSIONS,
  input: 'One blueprint cell (concept, outcome, cognition, form, difficulty) plus ONE grounding packet: facts from a source pack of the active edition, with pack id/version/hash. Source text is data. No past-paper or provider question is ever supplied.',
  output: 'A single JSON draft: stem, exactly three options, one key, per-option feedback, a worked solution, a named error pathway for every wrong option, every numeric input, isNumeric. Anything else is refused, not repaired.',
  quality: [
    'Original and self-contained: every number, assumption and rounding rule needed is in the stem.',
    'Exactly three options with exactly one defensible answer under the stated assumptions.',
    'Wrong options are plausible, named misconceptions, never arbitrary values.',
    'Professional wording; none of the banned formats (except, all of the above, true/false, "which is not").',
    'No reproduction or close paraphrase of any proprietary or past question.',
  ],
  allowedUse: 'Quarantined candidates for human review only. A candidate is never visible to students until a person approves the exact version.',
  refuse: [
    'no source pack, or one for another edition, scope or content hash',
    'source facts that contradict each other, or that contain instruction-like text (quarantined, never obeyed)',
    'a concept outside the stated scope, or a combination of concepts the pack does not support',
    'rights that are not recorded as cleared by a named authority, when a cleared claim is made',
  ],
} as const

/** Shown to a reviewer beside every automatic check. */
export const SEMANTIC_LIMIT_NOTICE =
  'An executed formula proves arithmetic, not meaning: a wrong extraction of the inputs, a wrong formula choice or a wrong reading of the facts can still produce a number that matches the key. The blind solver is another model, not a proof. These checks reduce risk; they do not establish that the item is correct, in scope or unambiguous. Check the reasoning and the source yourself.'

// The deterministic stem/option checks (stemInputDefects) live beside the verifier; this module stays free of server-only imports because the reviewer screen (a client component) shows SEMANTIC_LIMIT_NOTICE.
