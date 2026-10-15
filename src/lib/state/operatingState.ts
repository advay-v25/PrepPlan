import { createClient } from '../supabase/server'
import { OperatingStateRepository } from './operatingStateRepository'
import { computeWeekExecution } from './weekExecutionReducer'
import { computeEvidencePulse } from './evidencePulseReducer'
import { computeAttentionQueue } from './attentionReducer'
import { selectNextAction } from './nextActionSelector'
import { deriveActivation } from './derive'
import { getStudyWeekContext } from '../planning/schedule'
import { OperatingState, PlanBlock } from './types'
import { getTestsBridge, mergeTestsBridge } from '../signals/operatingBridge'
import { getActiveRoadmap } from '../curriculum/roadmapService'
import { calendarTaskHref } from '../routing/calendar'

export async function getCurrentOperatingState(userId: string): Promise<OperatingState> {
  const supabase = await createClient()
  const repo = new OperatingStateRepository(supabase, userId)
  const studyWeek = await getStudyWeekContext(userId)
  const nowUtc = new Date().toISOString()

  // 1. Fetch independent state groups in parallel
  const [
    profileData,
    roadmapResult,
    activeCycle,
    latestDraft,
    todayBlocksData,
    protectedCommitmentsData,
    recentEvidenceData,
    openRepairsData,
    coachProposalsData,
    hasUpcomingOneOffClass
  ] = await Promise.all([
    repo.getProfileAndExam(),
    // The single source of a student's roadmap lifecycle — Curriculum already
    // read this one (including a not-yet-accepted draft); Home used to call a
    // second, independently-written query that only ever saw status='active',
    // so Home said "no roadmap yet" for exactly the students Curriculum showed
    // a draft to. Reusing the same function retires that second truth, not
    // just patches its filter.
    getActiveRoadmap(userId),
    repo.getActiveCycle(),
    repo.getLatestPlanDraft(),
    repo.getTodayBlocks(studyWeek.today),
    repo.getProtectedCommitments(studyWeek.today),
    repo.getRecentEvidence(),
    repo.getOpenRepairs(),
    repo.getCoachProposals(),
    repo.hasUpcomingOneOffClass()
  ])
  // deriveActivation's "ready" check means "the student can operate the app",
  // which a draft roadmap does not yet grant — only a genuinely active one
  // does. The roadmap shown on Home can be the draft; the one that unlocks
  // activation cannot.
  const strictlyActiveRoadmapId = roadmapResult?.status === 'active' ? roadmapResult.id : null
  // Indicative only: an unregistered candidate has no exact date, but a countdown against the sitting they
  // picked beats showing nothing. Read after profileData resolves since it needs profileData.exam_window_id.
  const examWindow = !profileData?.exam_date ? await repo.getExamWindow((profileData?.exam_window_id as string | null) ?? null) : null

  // 2. Fetch cycle blocks, then their events if there is an active cycle
  let cycleBlocksData: any[] = []
  let cycleTaskEvents: any[] = []
  
  if (activeCycle) {
    cycleBlocksData = await repo.getCycleBlocks(activeCycle.id) || []
    const blockIds = cycleBlocksData.map(b => b.id)
    cycleTaskEvents = await repo.getTaskEvents(blockIds) || []
  }

  // 3. Normalize database rows
  const normalizeBlock = (b: any): PlanBlock => ({
    id: b.id,
    revision: b.revision || 0,
    availability: 'available' as const,
    destination: calendarTaskHref(b.id, b.local_date ?? undefined),
    permittedCommands: ['start_task', 'defer_task', 'complete_task'],
    title: b.title,
    detail: b.detail || '',
    taskType: b.task_type || 'study',
    origin: b.origin || 'planner',
    durationMinutes: b.duration_minutes || 0,
    placement: b.placement || 'day_preferred',
    startsAt: b.starts_at || null,
    execution: b.execution || 'not_started'
  })

  const todayBlocks: PlanBlock[] = (todayBlocksData ?? []).map(normalizeBlock)
  const cycleBlocks: (PlanBlock & { localDate: string })[] = (cycleBlocksData ?? []).map((b: any) => ({
    ...normalizeBlock(b),
    localDate: b.local_date
  }))

  const protectedCommitments = (protectedCommitmentsData ?? []).map((c: any) => ({
    id: c.id,
    revision: 0,
    availability: 'available' as const,
    destination: '',
    permittedCommands: [],
    label: c.label,
    kind: c.kind,
    startsAt: c.starts_at,
    durationMinutes: c.duration_minutes || 0
  }))

  // 4. Run pure reducers
  const execution = activeCycle
    ? computeWeekExecution(cycleBlocks, cycleTaskEvents, studyWeek.today)
    : {
        completedMinutes: 0,
        partialMinutes: 0,
        deferredMinutes: 0,
        skippedMinutes: 0,
        unreportedMinutes: 0,
        deviations: []
      }
  const evidence = computeEvidencePulse(recentEvidenceData ?? [])

  const repairs = {
    openThreads: (openRepairsData ?? []).map((r: any) => ({
      id: r.id,
      revision: 0,
      availability: 'available' as const,
      destination: '/app/coach',
      permittedCommands: [],
      conceptName: r.concept_id || 'Unknown', // Ideally fetched via join
      createdAt: r.created_at
    })),
    proposals: (coachProposalsData ?? []).map((p: any) => ({
      id: p.id,
      revision: 0,
      availability: 'available' as const,
      destination: '/app/coach',
      permittedCommands: ['accept_proposal', 'reject_proposal'],
      title: p.title,
      summary: p.summary
    }))
  }

  const currentPhaseSpan = roadmapResult?.roadmap.phases.find(
    p => p.startDate <= studyWeek.today && p.endDate >= studyWeek.today
  )

  // Build the baseline OperatingState without attention and nextAction
  let state: OperatingState = {
    schemaVersion: 1,
    generatedAt: nowUtc,
    timezone: profileData?.timezone || 'UTC',
    dataVersion: Date.now(), // Real implementation uses hash or clock
    
    identity: {
      userId,
      examDate: profileData?.exam_date || null,
      examWindowId: profileData?.exam_window_id || null,
      classPattern: profileData?.class_pattern || null,
      weekAvailabilityMode: (profileData?.week_availability_mode as string | null) || null,
      hasKnownNextClass: hasUpcomingOneOffClass,
      indicativeExamDate: (examWindow?.window_opens as string | null) ?? null,
      examSitting: examWindow ? { sitting: examWindow.sitting as string, year: examWindow.year as number } : null
    },
    
    activation: deriveActivation(
      profileData?.onboarding_status || null,
      strictlyActiveRoadmapId,
      activeCycle?.id || null,
      latestDraft?.status || null,
      profileData?.onboarding_status === 'activation_failed'
    ),

    roadmap: roadmapResult ? {
      id: roadmapResult.id,
      revision: 0,
      availability: 'available' as const,
      destination: '/app/curriculum',
      permittedCommands: ['view_roadmap'],
      status: (['active', 'superseded', 'draft'] as const).includes(roadmapResult.status as any)
        ? (roadmapResult.status as 'active' | 'superseded' | 'draft') : 'unknown',
      route: roadmapResult.input.route,
      phase: currentPhaseSpan?.phase || 'unknown',
      currentMilestoneId: null, // study_roadmaps has no current-milestone column; milestones are derived from the phases
      nextMilestoneId: null,
      trajectory: 'unknown',
      projectedRange: null
    } : null,
    
    cycle: activeCycle ? {
      id: activeCycle.id,
      revision: 0,
      availability: 'available' as const,
      destination: '/app/calendar',
      permittedCommands: [],
      startDateLocal: activeCycle.starts_at_local,
      endDateLocal: activeCycle.ends_at_local,
      // Set properly below, after step 5 resolves capabilities.canCloseWeek
      // from the real weekly-review gate — not re-derived here from
      // activeCycle.status, which repo.getActiveCycle() filters to 'active'
      // by construction, so that re-derivation could never produce anything
      // but 'active' no matter what the week's real state was.
      closureState: 'active'
    } : null,
    
    today: {
      dateLocal: studyWeek.today,
      blocks: todayBlocks,
      protectedCommitments
    },
    
    execution,
    
    papers: {
      availablePapers: [],
      activeReservation: null
    },
    
    evidence,
    preparedness: null,
    repairs,
    attention: [],
    nextAction: null,
    
    capabilities: {
      canTakeDiagnostic: false,
      canTakeRevisionary: false,
      canCloseWeek: false
    },
    
    integrity: {
      isStale: false,
      activationFailed: profileData?.onboarding_status === 'activation_failed',
      insufficientPaperBank: false,
      crossPageInvariantFailed: false,
      partialServiceFailure: []
    }
  }

  // 5. Tests/Curriculum truth (papers, capabilities, preparedness, repair names). A failure here is
  // reported as a partial service failure rather than taking Home down.
  try {
    state = mergeTestsBridge(state, await getTestsBridge(userId))
  } catch {
    state.integrity.partialServiceFailure = [...state.integrity.partialServiceFailure, 'tests']
  }

  // capabilities.canCloseWeek just came from the bridge's own call to the real
  // weekly-review gate (getWeeklyReviewState) — reusing it here instead of
  // asking that gate a second time keeps this to one source, not two calls
  // that could in principle disagree.
  if (state.cycle) {
    state.cycle = { ...state.cycle, closureState: state.capabilities.canCloseWeek ? 'closure_ready' : 'active' }
  }

  // 6. Compute derived queues via selectors/reducers
  state.attention = computeAttentionQueue(state)
  state.nextAction = selectNextAction(state)

  return state
}
