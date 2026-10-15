import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function check() {
  const { data: users } = await supabase.from('profiles').select('id').limit(1)
  if (!users || users.length === 0) {
    console.log('No users found')
    return
  }
  const id = users[0].id
  
  const { data: current, error: e1 } = await supabase.from('profiles').select('onboarding_status, onboarding_step').eq('id', id).single()
  console.log('Current profile:', current, e1)
  
  const update = {
    diagnostic_day: 1,
    onboarding_step: Math.max(current?.onboarding_step ?? 0, 5),
  }
  const { error: e2 } = await supabase.from('profiles').update(update).eq('id', id)
  console.log('Update result:', e2)
  
  const { data: after } = await supabase.from('profiles').select('onboarding_status, onboarding_step').eq('id', id).single()
  console.log('After update:', after)
}
check()
