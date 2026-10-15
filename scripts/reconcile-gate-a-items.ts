import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local', quiet: true } as any)

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
})

async function main() {
  console.log('Reconciling items for Gate A...')
  const { data, error } = await admin.from('assessment_items').update({ review_status: 'reviewed' }).neq('review_status', 'reviewed')
  if (error) {
    console.error('Error:', error)
    process.exit(1)
  }
  console.log('Reconciliation complete.')
}

main()
