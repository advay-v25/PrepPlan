/** A first-week class route must survive draft acceptance as class-led. */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)
import { getE2EEmail, verifyAndGetE2EUser, resetE2EUser, assertBlankOnboarding } from '../src/lib/testing/e2eIdentity'
import { completeOnboarding, createSession, makeCheck } from './lib/e2eSession'

const { check, finish } = makeCheck()
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
})

async function main() {
  const session = createSession(admin, getE2EEmail())
  check('signed in', await session.signIn())
  const userId = await verifyAndGetE2EUser(admin)
  await resetE2EUser(admin, userId)
  await assertBlankOnboarding(admin, userId)
  await completeOnboarding(session, admin, { classes: [{ weekday: 2 }] })

  const { data: roadmap } = await admin.from('study_roadmaps').select('route,status')
    .eq('user_id', userId).eq('status', 'active').single()
  check('accepted roadmap persists the coaching route', roadmap?.route === 'coaching', JSON.stringify(roadmap))

  const { data: cycle } = await admin.from('planning_cycles').select('starts_at_local,ends_at_local')
    .eq('user_id', userId).eq('status', 'active').single()
  const weekday = cycle?.ends_at_local
    ? new Date(`${cycle.ends_at_local}T12:00:00Z`).getUTCDay() : null
  check('Tuesday class makes Monday the closing day', weekday === 1, JSON.stringify(cycle))

  finish()
}
main().catch(error => { console.error(error); process.exit(1) })
