/**
 * Shared read-only-ish database connection for maintenance scripts.
 *
 * Credentials come from the environment only. Six legacy helper scripts each
 * carried the production database password as a string literal; they are now in
 * scripts/legacy/ and rewritten to use this. The password those files contained
 * must be treated as compromised and rotated in the Supabase dashboard.
 */
const { Client } = require('pg')
require('dotenv').config({ path: process.env.E2E_ENV_FILE || '.env.local', quiet: true })

function connect() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const password = process.env.SUPABASE_DB_PASSWORD
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set')
  if (!password) throw new Error('SUPABASE_DB_PASSWORD is not set — add it to .env.local')

  const projectId = new URL(url).hostname.split('.')[0]
  // A target file may name the Session pooler (host plus `postgres.<ref>` user) because new projects serve the direct host over IPv6 only.
  const host = process.env.SUPABASE_DB_HOST || `db.${projectId}.supabase.co`
  const user = process.env.SUPABASE_DB_USER || 'postgres'
  return new Client({
    connectionString: `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${process.env.SUPABASE_DB_PORT || 5432}/postgres`,
    ssl: ['127.0.0.1', 'localhost'].includes(host) ? false : { rejectUnauthorized: false },   // the isolated local stack has no TLS; every hosted host keeps it
  })
}

module.exports = { connect }
