export type InitialPlanInputs = { examWindow: string; prepMode: 'coaching' | 'self-study' | 'both'; availableDays: number[]; classDays: number[]; maxSessionMinutes: 30 | 45 | 60 | 90; startingStage: 'not-started' | 'in-progress' | 'revision'; coveredTopicCount: number }

const examDates: Record<string, string> = { 'feb-2027': '2027-02-23', 'may-2027': '2027-05-18', 'aug-2027': '2027-08-24', 'nov-2027': '2027-11-16' }

export function computeInitialStudyLoad(input: InitialPlanInputs) {
  const target = new Date(`${examDates[input.examWindow] ?? examDates['may-2027']}T12:00:00`).getTime()
  const daysToExam = Math.max(1, Math.ceil((target - Date.now()) / 86_400_000))
  const stageMinutes = input.startingStage === 'revision' ? 330 : input.startingStage === 'in-progress' ? 270 : 210
  const classPressure = input.prepMode === 'self-study' ? 0 : input.classDays.length * 35
  const examPressure = daysToExam < 90 ? 150 : daysToExam < 150 ? 90 : daysToExam < 240 ? 45 : 0
  const calibration = input.coveredTopicCount > 0 ? Math.min(60, input.coveredTopicCount * 8) : 30
  const demand = stageMinutes + classPressure + examPressure + calibration
  const dailyCapacity = Math.max(1, input.availableDays.length) * input.maxSessionMinutes * 2
  const weeklyMinutes = Math.max(120, Math.min(demand, dailyCapacity))
  return { weeklyMinutes, sessions: Math.max(3, Math.ceil(weeklyMinutes / input.maxSessionMinutes)), daysToExam, label: daysToExam < 90 ? 'exam-pressure load' : input.prepMode === 'self-study' ? 'provisional self-study load' : 'class-responsive load' }
}

export function examDateForWindow(windowId: string) { return examDates[windowId] ?? examDates['may-2027'] }
