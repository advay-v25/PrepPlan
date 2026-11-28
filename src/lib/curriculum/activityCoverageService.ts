import { createAdminClient } from '../supabase/admin'
import { readAll } from '../supabase/readAll'
import { getStudyActivity } from './studyActivityService'
import { confirmedActivity } from './studyActivity'
import { activityCoverage } from './activityCoverage'
import { perRequest } from '../ops/perRequest'
import { allOutcomes } from './referenceReads'

async function loadActivityCoverage(userId: string) {
  const db = createAdminClient()
  const [activity, outcomes] = await Promise.all([
    getStudyActivity(userId),
    allOutcomes(),
  ])
  const readingOf = new Map(outcomes.map(o => [o.id, o.reading_id]))
  return activityCoverage(activity.blocks, confirmedActivity(activity.blocks, activity.confirmations, readingOf, activity.pendingGroups, activity.completedAt), readingOf, activity.pendingGroups)
}

export const getActivityCoverage = perRequest(loadActivityCoverage, (userId: string) => userId)
