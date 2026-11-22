import { cache } from 'react'
import { createAdminClient } from '../supabase/admin'
import { readAll } from '../supabase/readAll'
import { getStudyActivity } from './studyActivityService'
import { confirmedActivity } from './studyActivity'
import { activityCoverage } from './activityCoverage'

export const getActivityCoverage=cache(async(userId:string)=>{
  const db=createAdminClient()
  const [activity,outcomes]=await Promise.all([getStudyActivity(userId),
    readAll<{id:string;reading_id:string}>((a,z)=>db.from('reading_los').select('id,reading_id').order('id').range(a,z))])
  const readingOf=new Map(outcomes.map(o=>[o.id,o.reading_id]))
  return activityCoverage(activity.blocks,confirmedActivity(activity.blocks,activity.confirmations,readingOf,activity.pendingGroups,activity.completedAt),readingOf,activity.pendingGroups)
})
