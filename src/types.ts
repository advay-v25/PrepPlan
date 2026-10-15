export type SubjectId = 'fixed-income' | 'quant' | 'fsa' | 'equity' | 'ethics'

export type Confidence = 'low' | 'medium' | 'high'

export type Question = {
  id: string
  subject: SubjectId
  module: string
  prerequisite?: string
  los: string
  cognitive: 'recall' | 'interpretation' | 'calculation' | 'judgment' | 'transfer'
  difficulty: 1 | 2 | 3
  stem: string
  options: [string, string, string]
  answer: number
  rationale: string
  optionFeedback?: [string, string, string]
  why: string
  misconception: string
}

export type DiagnosticAnswer = {
  questionId: string
  selected: number
  confidence: Confidence
  correct: boolean
  module: string
  misconception: string
  flagged?: boolean
}

export type Subject = {
  id: SubjectId
  name: string
  short: string
  readiness: number
  coverage: number
  color: 'blue' | 'green' | 'amber'
  modules: string[]
}

export type PlanBlockState = 'done' | 'planned' | 'class' | 'risk' | 'empty'
export type PlanBlock = { id: string; day: string; date: string; title: string; duration: string; state: PlanBlockState; subjectId?: SubjectId; detail?: string }
export type TestRecord = { id: string; subjectId: SubjectId; title: string; score: number; correct: number; total: number; weakest: string; confidenceMisses: number; source: 'roadmap' | 'imported'; completedAt: string }
export type MaterialProvider = { id: string; name: string; type: string; reference: string }
export type CoachMessage = { id: string; role: 'student' | 'coach'; text: string; createdAt: string }
