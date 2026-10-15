import { questions } from './data'
import type { DiagnosticAnswer, Question, SubjectId } from './types'

const modulePriority = (question: Question, answers: DiagnosticAnswer[]) => {
  const moduleAnswers = answers.filter((answer) => answer.module === question.module)
  const misses = moduleAnswers.filter((answer) => !answer.correct).length
  const confidenceMisses = moduleAnswers.filter((answer) => !answer.correct && answer.confidence === 'high').length
  const prerequisiteBoost = question.prerequisite ? 2 : 0
  return misses * 4 + confidenceMisses * 3 + prerequisiteBoost + question.difficulty
}

export function selectNextQuestion(subject: SubjectId, answers: DiagnosticAnswer[], seen: Set<string>, pool: Question[] = questions): Question | null {
  const candidates = pool.filter((question) => question.subject === subject && !seen.has(question.id))
  if (candidates.length === 0) return null

  if (answers.length === 0) {
    const initialFocus: Partial<Record<SubjectId, string>> = {
      'fixed-income': 'Spot, par & forward curves',
      quant: 'Time value of money',
      fsa: 'Cash flows',
      equity: 'DCF valuation',
      ethics: 'Professionalism',
    }
    return candidates.find((question) => question.module === initialFocus[subject]) ?? candidates[0]
  }

  return candidates.toSorted((a, b) => {
    const priorityDifference = modulePriority(b, answers) - modulePriority(a, answers)
    if (priorityDifference !== 0) return priorityDifference
    return a.id.localeCompare(b.id)
  })[0]
}

export function buildDiagnostic(subject: SubjectId, count = 10): Question[] {
  const subjectQuestions = questions.filter((question) => question.subject === subject)
  if (subjectQuestions.length === 0) return []
  return Array.from({ length: Math.min(count, subjectQuestions.length) }, (_, index) => subjectQuestions[index])
}

export function scoreDiagnostic(answers: DiagnosticAnswer[]) {
  const correct = answers.filter((answer) => answer.correct).length
  const highConfidenceMisses = answers.filter((answer) => !answer.correct && answer.confidence === 'high').length
  const moduleStats = new Map<string, { correct: number; total: number }>()
  answers.forEach((answer) => {
    const current = moduleStats.get(answer.module) ?? { correct: 0, total: 0 }
    moduleStats.set(answer.module, {
      correct: current.correct + (answer.correct ? 1 : 0),
      total: current.total + 1,
    })
  })
  const weakest = [...moduleStats.entries()].toSorted((a, b) => a[1].correct / a[1].total - b[1].correct / b[1].total)[0]?.[0]
  return {
    correct,
    total: answers.length,
    percent: answers.length ? Math.round((correct / answers.length) * 100) : 0,
    highConfidenceMisses,
    weakest: weakest ?? 'Insufficient evidence',
  }
}
