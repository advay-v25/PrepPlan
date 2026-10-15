/**
 * Shared read-only-ish database connection for maintenance scripts.
 *
 * Credentials come from the environment only. Six legacy helper scripts each
 * carried the production database password as a string literal; they are now in
 * scripts/legacy/ and rewritten to use this. The password those files contained
 * must be treated as compromised and rotated in the Supabase dashboard.
 */
const { Client } = require('pg')
require('dotenv').config({ path: '.env.local' })

function connect() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const password = process.env.SUPABASE_DB_PASSWORD
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set')
  if (!password) throw new Error('SUPABASE_DB_PASSWORD is not set — add it to .env.local')

  const projectId = new URL(url).hostname.split('.')[0]
  return new Client({
    connectionString: `postgresql://postgres:${encodeURIComponent(password)}@db.${projectId}.supabase.co:5432/postgres`,
    ssl: { rejectUnauthorized: false },
  })
}

module.exports = { connect }
