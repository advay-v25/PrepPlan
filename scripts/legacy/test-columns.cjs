require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
  const { data: users, error: usersError } = await supabase.auth.admin.listUsers();
  if (usersError || !users.users.length) {
    console.error('No users found', usersError);
    return;
  }
  const userId = users.users[0].id;
  console.log('Testing with user', userId);

  const res1 = await supabase.from('profiles').update({ display_name: 'Test' }).eq('id', userId);
  console.log('Update display_name result:', res1.error ? res1.error.message : 'Success');

  const res2 = await supabase.from('profiles').update({ name: 'Test' }).eq('id', userId);
  console.log('Update name result:', res2.error ? res2.error.message : 'Success');
}

run();
