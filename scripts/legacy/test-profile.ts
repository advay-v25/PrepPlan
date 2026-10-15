import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function run() {
  const { data: users, error: usersError } = await supabase.auth.admin.listUsers();
  if (usersError || !users.users.length) {
    console.error('No users found', usersError);
    return;
  }
  const userId = users.users[0].id;
  console.log('Testing with user', userId);

  // Test upsert bypass RLS
  const res = await supabase.from('profiles').upsert({
    id: userId,
    display_name: 'Test',
    timezone: 'Asia/Kolkata',
    onboarding_status: 'complete',
    onboarding_step: 4,
    max_session_minutes: 60,
    prep_mode: 'coaching'
  });
  console.log('Upsert result (Service Role):', res);
}

run();
