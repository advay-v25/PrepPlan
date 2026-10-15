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
  
  try {
    const res = await client.query(`
      SELECT conname 
      FROM pg_constraint 
      WHERE conrelid = 'public.plan_blocks'::regclass AND contype = 'c' 
      AND pg_get_constraintdef(oid) ILIKE '%state%';
    `);
    
    for (let row of res.rows) {
      console.log('Dropping constraint:', row.conname);
      await client.query(`ALTER TABLE public.plan_blocks DROP CONSTRAINT "${row.conname}";`);
    }
    
    console.log('Adding new state constraint...');
    await client.query(`
      ALTER TABLE public.plan_blocks 
      ADD CONSTRAINT plan_blocks_state_check 
      CHECK (state in ('done','partial','planned','class','risk','empty'));
    `);
    console.log('Constraint updated successfully.');
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.end();
  }
}
run();
