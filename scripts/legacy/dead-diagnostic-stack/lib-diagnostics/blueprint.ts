export type ModuleSize = 'small' | 'medium' | 'large'

export const diagnosticBlueprint = {
  questionCount: { small: 8, medium: 10, large: 12 } satisfies Record<ModuleSize, number>,
  difficultyMix: { foundation: 0.2, examStandard: 0.5, difficult: 0.3 },
  evidenceMix: { coreConcept: 0.35, missedDetail: 0.25, misconceptionTrap: 0.2, indirectApplication: 0.2 },
  format: { options: 3, allowedCommands: ['most likely', 'least likely', 'closest to', 'best describes', 'most accurate'], feedbackPerOption: true },
} as const

export const diagnosticGenerationContract = `Create original CFA Level I-style diagnostic items, never copied or closely paraphrased from supplied material. Every item must map to one approved learning outcome and one concept anchor. Use exactly three plausible options. Prefer concise stems using disciplined commands such as most likely, least likely, closest to, best describes, or most accurate. Distractors must represent named misconceptions, missed qualifiers, sign/unit errors, incorrect rule scope, or a logically adjacent concept. Include difficult indirect application and easy-to-miss reading details, not trivia. Numerical items must identify the working error behind every distractor. Return rationale for the correct choice and separate feedback for all three choices. Do not use trick wording unrelated to the curriculum.`
