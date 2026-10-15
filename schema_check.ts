import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function check() {
  const { data: e, error } = await supabase.rpc('get_enum_values', { enum_name: 'onboarding_status_enum' })
  console.log('onboarding status enum:', error ? 'failed' : e)
}
check()
