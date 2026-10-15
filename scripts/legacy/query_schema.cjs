const { Client } = require('pg');
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://asylsxszdhlnzewhwtga.supabase.co';
const projectId = new URL(supabaseUrl).hostname.split('.')[0];
const dbHost = `db.${projectId}.supabase.co`;
const password = 'REDACTED_ROTATE_ME';
const connectionString = `postgresql://postgres:${password}@${dbHost}:5432/postgres`;
const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });

async function run() {
  await client.connect();
  const res = await client.query(`
    SELECT table_name, column_name, data_type 
    FROM information_schema.columns 
    WHERE table_schema = 'public' 
    ORDER BY table_name, ordinal_position;
  `);
  let currentTable = '';
  for (const row of res.rows) {
    if (row.table_name !== currentTable) {
      currentTable = row.table_name;
      console.log(`\nTable: ${currentTable}`);
    }
    console.log(`  ${row.column_name} (${row.data_type})`);
  }
  await client.end();
}
run();
