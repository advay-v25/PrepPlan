import { config } from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
config({ path: path.resolve(__dirname, '../.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const admin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
})

async function seed() {
  const email = 'audit_user@example.com'
  const password = 'Password123!'
  
  console.log('Deleting existing user if any...')
  const { data: users } = await admin.auth.admin.listUsers()
  // listUsers()'s return type is a union the compiler cannot narrow here (see
  // scripts/e2e-tests-tab.ts for the same cast).
  const existing = (users as any)?.users.find((u: any) => u.email === email)
  if (existing) {
    await admin.auth.admin.deleteUser(existing.id)
  }

  console.log('Creating new user...')
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: 'Audit User' }
  })
  
  if (error) {
    console.error('Error creating user:', error)
  } else {
    console.log('User created:', data.user.id)
    console.log(`Email: ${email}, Password: ${password}`)
  }
}

seed()
