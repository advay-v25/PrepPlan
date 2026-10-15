const { Client } = require('pg');
require('dotenv').config({ path: '.env.local' });

async function run() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const projectId = new URL(supabaseUrl).hostname.split('.')[0];
  const dbHost = `db.${projectId}.supabase.co`;
  const password = 'REDACTED_ROTATE_ME';
  const connectionString = `postgresql://postgres:${password}@${dbHost}:5432/postgres`;
  
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  const res = await client.query(`
    SELECT conname 
    FROM pg_constraint 
    WHERE conrelid = 'public.plan_blocks'::regclass AND contype = 'c';
  `);
  console.log(res.rows);
  await client.end();
}
run();
