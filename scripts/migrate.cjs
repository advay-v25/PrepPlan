const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: '.env.local' });

async function run() {
  const isDryRun = process.argv.includes('--dry-run');
  const envTarget = process.argv.find(arg => arg.startsWith('--env='))?.split('=')[1] || 'local';

  console.log(`Starting migration runner (Target: ${envTarget}${isDryRun ? ', DRY RUN' : ''})`);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const dbPassword = process.env.SUPABASE_DB_PASSWORD; // Must be provided in .env.local

  if (!supabaseUrl || !dbPassword) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_DB_PASSWORD in .env.local');
    process.exit(1);
  }

  const projectId = new URL(supabaseUrl).hostname.split('.')[0];
  const dbHost = `db.${projectId}.supabase.co`;
  
  const connectionString = `postgresql://postgres:${dbPassword}@${dbHost}:5432/postgres`;
  
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    
    // Ensure migrations table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.schema_migrations (
        version text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    // Acquire an advisory lock to prevent concurrent runs
    const lockRes = await client.query(`SELECT pg_try_advisory_lock(1) as acquired`);
    if (!lockRes.rows[0].acquired) {
      console.error('Another migration is currently running. Exiting.');
      process.exit(1);
    }

    const appliedRes = await client.query('SELECT version FROM public.schema_migrations');
    const appliedVersions = new Set(appliedRes.rows.map(r => r.version));

    const migrationsDir = path.join(__dirname, '..', 'supabase', 'migrations');
    let files = [];
    try {
      files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
    } catch (e) {
      console.log('No migrations directory found.');
    }

    let pending = 0;
    for (const file of files) {
      const version = path.parse(file).name;
      if (!appliedVersions.has(version)) {
        pending++;
        const filePath = path.join(migrationsDir, file);
        const sql = fs.readFileSync(filePath, 'utf8');
        const checksum = crypto.createHash('sha256').update(sql).digest('hex');

        console.log(`- Pending: ${version}`);
        if (!isDryRun) {
          console.log(`  Applying ${version}...`);
          try {
            await client.query('BEGIN');
            await client.query(sql);
            await client.query(
              'INSERT INTO public.schema_migrations (version, checksum) VALUES ($1, $2)',
              [version, checksum]
            );
            await client.query('COMMIT');
            console.log(`  Successfully applied ${version}`);
          } catch (err) {
            await client.query('ROLLBACK');
            console.error(`  Failed to apply ${version}:`, err.message);
            throw err;
          }
        }
      }
    }

    if (pending === 0) {
      console.log('No pending migrations.');
    }

    // Explicitly reload postgrest schema cache
    if (!isDryRun && pending > 0) {
      await client.query("NOTIFY pgrst, 'reload schema'");
      console.log('PostgREST schema cache reloaded.');
    }

    // Release lock
    await client.query(`SELECT pg_advisory_unlock(1)`);
    console.log('Migration runner finished cleanly.');

  } catch (err) {
    console.error('Migration runner failed:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

run();
