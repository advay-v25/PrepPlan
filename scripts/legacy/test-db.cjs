const { Client } = require('pg');
const connectionString = `postgresql://postgres:REDACTED_ROTATE_ME@db.asylsxszdhlnzewhwtga.supabase.co:5432/postgres`;
const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
async function run() {
  await client.connect();
  const res = await client.query(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'plan_blocks';
  `);
  console.log(res.rows);
  await client.end();
}
run();
