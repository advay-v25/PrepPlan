import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!supabaseUrl || !supabaseKey) throw new Error("Missing Supabase credentials")

const supabase = createClient(supabaseUrl, supabaseKey)

async function check() {
  const counts: Record<string, number | string> = {}
  
  // count profiles by onboarding status
  const { data: profiles, error: pErr } = await supabase.from('profiles').select('onboarding_status')
  if (pErr) console.error("Error fetching profiles:", pErr)
  
  const statusCounts: Record<string, number> = {}
  profiles?.forEach(p => {
    statusCounts[p.onboarding_status || 'null'] = (statusCounts[p.onboarding_status || 'null'] || 0) + 1
  })
  counts['Profiles by onboarding status'] = JSON.stringify(statusCounts)
  
  // active/draft roadmaps
  const { count: roadmapCount } = await supabase.from('study_roadmaps').select('*', { count: 'exact', head: true })
  const { count: draftCount } = await supabase.from('plan_drafts').select('*', { count: 'exact', head: true })
  counts['Total Roadmaps'] = roadmapCount ?? 0
  counts['Total Plan Drafts'] = draftCount ?? 0

  // active planning cycles
  const { count: cycleCount } = await supabase.from('planning_cycles').select('*', { count: 'exact', head: true })
  counts['Total Planning Cycles'] = cycleCount ?? 0
  
  // commitments
  const { count: commitmentCount } = await supabase.from('calendar_commitments').select('*', { count: 'exact', head: true })
  counts['Total Commitments'] = commitmentCount ?? 0

  // invalid weekdays in availability
  const { data: avail } = await supabase.from('availability_rules').select('weekday')
  const invalidAvailCount = (avail ?? []).filter(a => a.weekday < 0 || a.weekday > 6).length
  counts['Invalid weekdays in availability_rules'] = invalidAvailCount

  // profiles with registered = true but no exam_date
  const { count: registeredNoDate } = await supabase.from('profiles').select('*', { count: 'exact', head: true }).is('exam_date', null).eq('registered', true)
  counts['Registered profiles without exam_date'] = registeredNoDate ?? 0

  // user_module_state created from self-report
  const { count: selfReportCount } = await supabase.from('user_module_state').select('*', { count: 'exact', head: true }).eq('source', 'self_report')
  counts['user_module_state rows from self_report'] = selfReportCount ?? 0

  console.log(JSON.stringify(counts, null, 2))
}

check().catch(console.error)
