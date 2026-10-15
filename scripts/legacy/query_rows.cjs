const { Client } = require('pg');
require('dotenv').config({ path: '.env.local' });

async function run() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://asylsxszdhlnzewhwtga.supabase.co';
  const projectId = new URL(supabaseUrl).hostname.split('.')[0];
  const dbHost = `db.${projectId}.supabase.co`;
  const password = 'REDACTED_ROTATE_ME';
  const client = new Client({ connectionString: `postgresql://postgres:${password}@${dbHost}:5432/postgres`, ssl: { rejectUnauthorized: false } });

  await client.connect();
  const res = await client.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
    ORDER BY table_name;
  `);
  for (const row of res.rows) {
    const countRes = await client.query(`SELECT count(*) FROM public."${row.table_name}"`);
    console.log(`Table ${row.table_name}: ${countRes.rows[0].count} rows`);
  }
  await client.end();
}
run();
