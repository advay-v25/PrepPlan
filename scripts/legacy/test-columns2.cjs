require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
  const { data: users, error: usersError } = await supabase.auth.admin.listUsers();
  const userId = users.users[0].id;

  const columns = ['timezone', 'onboarding_status', 'max_session_minutes', 'prep_mode'];
  
  for (const col of columns) {
    const res = await supabase.from('profiles').update({ [col]: null }).eq('id', userId);
    console.log(`Update ${col}:`, res.error ? res.error.message : 'Success');
  }
}

run();
