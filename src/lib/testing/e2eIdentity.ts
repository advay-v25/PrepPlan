import { SupabaseClient } from '@supabase/supabase-js'

export const E2E_BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000'

function maskEmail(email: string) {
  const [local, domain] = email.split('@')
  if (!domain) return email
  if (local.length <= 2) return `${local[0]}***@${domain}`
  return `${local[0]}***${local[local.length - 1]}@${domain}`
}

export function getE2EEmail(): string {
  const email = process.env.E2E_EMAIL
  if (!email) {
    throw new Error('E2E_EMAIL environment variable is required. No personal email fallback allowed.')
  }
  return email
}

export async function verifyAndGetE2EUser(admin: SupabaseClient) {
  const email = getE2EEmail()

  if (process.env.E2E_ALLOW_RESET !== '1') {
    throw new Error('E2E_ALLOW_RESET=1 is required for destructive fixture resets.')
  }

  if (process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production' || process.env.NEXT_PUBLIC_IS_PRODUCTION === 'true') {
    throw new Error('Refusing to run reset against a production environment.')
  }

  const { data: usersData, error: listError } = await admin.auth.admin.listUsers()
  if (listError) {
    throw new Error(`Failed to list users: ${listError.message}`)
  }

  const user = usersData.users.find((u: any) => u.email?.toLowerCase() === email.toLowerCase())
  if (!user) {
    throw new Error(`Test user ${email} not found in database. Please create it first.`)
  }

  // Assuming `e2e_test_user` role or test email marker. We'll enforce a specific domain or marker.
  if (!email.includes('+e2e@') && !email.endsWith('@example.com') && !email.endsWith('@test.com') && user.role !== 'e2e_test_user') {
    throw new Error(`User ${email} does not appear to be a test identity (no e2e_test_user role or +e2e / @example.com marker).`)
  }

  console.log(`[E2E] Project URL: ${process.env.NEXT_PUBLIC_SUPABASE_URL}`)
  console.log(`[E2E] Masked Identity: ${maskEmail(email)} (ID: ${user.id})`)

  return user.id
}

export async function resetE2EUser(admin: SupabaseClient, userId: string) {
  // Scope every cleanup query strictly to the verified test user.
  console.log(`[E2E] Resetting data for user ${userId}...`)

  // Order matters — several FKs here have no ON DELETE clause (default
  // RESTRICT), so the referencing row must go first:
  //   plan_blocks.repair_thread_id      -> repair_threads
  //   repair_queue.evidence_event_id    -> evidence_events
  //   repair_threads.latest_evidence_event_id, .opened_from_attempt_id
  //                                      -> evidence_events, assessment_attempts
  //   evidence_events.response_id       -> assessment_responses
  // so: plan_blocks, then repair_queue, then repair_threads, then
  // evidence_events, then assessment_attempts (which cascades
  // assessment_responses). Everything else is ON DELETE CASCADE/SET NULL and
  // safe in any order.
  // Onboarding state lives on the profile row as well as in child tables. A
  // reset that leaves it behind lets a run report "onboarding complete" from an
  // earlier run's leftovers, so it is cleared first (also releases the
  // profiles.onboarding_preview_id reference to plan_drafts).
  {
    const result = await admin.from('profiles').update({
      onboarding_status: 'not_started', onboarding_step: 0, onboarding_completed_at: null,
      onboarding_preview_id: null, exam_window_id: null, exam_date: null,
      registered: false, prep_mode: null, class_pattern: null, stage: null,
      max_session_minutes: null, diagnostic_day: null, week_availability_mode: null, exam_sitting: null, exam_year: null,
    }).eq('id', userId).select()
    if (result.error) throw new Error(`Cleanup failed on profiles: ${result.error.message}`)
    console.log(`[E2E] Profiles update result:`, result.data)
  }

  const tables = [
    'task_events',
    'learning_activities',
    'plan_blocks',
    'coach_proposals',
    'repair_queue',
    'repair_threads',
    'evidence_events',
    'assessment_attempts',
    'planning_cycles',
    'plan_drafts',
    'roadmap_milestones',
    'study_roadmaps',
    'user_module_state',
    'availability_rules',
    'availability_windows',
    'user_topic_exposure',
    'calendar_commitments',
    'user_sources',
  ]

  for (const table of tables) {
    const { error } = await admin.from(table).delete().eq('user_id', userId)
    if (error) {
      console.error(`[E2E] Failed to cleanup table ${table}: ${error.message}`)
      throw new Error(`Cleanup failed on ${table}`)
    }
  }

  console.log(`[E2E] Reset complete.`)
}

/** Proves a reset actually left a blank onboarding slate — call before a journey that assumes one. */
export async function assertBlankOnboarding(admin: SupabaseClient, userId: string) {
  const { data: p } = await admin.from('profiles')
    .select('onboarding_status, onboarding_step, exam_window_id, class_pattern, stage, max_session_minutes')
    .eq('id', userId).maybeSingle()
  const dirty = !p || p.onboarding_status !== 'not_started' || p.onboarding_step !== 0 ||
    p.exam_window_id || p.class_pattern || p.stage || p.max_session_minutes != null
  if (dirty) throw new Error(`E2E precondition failed: profile is not blank after reset: ${JSON.stringify(p)}`)
  for (const table of ['availability_windows', 'user_topic_exposure', 'plan_drafts', 'calendar_commitments']) {
    const { count } = await admin.from(table).select('*', { count: 'exact', head: true }).eq('user_id', userId)
    if (count) throw new Error(`E2E precondition failed: ${table} still has ${count} rows after reset`)
  }
}
