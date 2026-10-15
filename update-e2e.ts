import * as fs from 'fs';
import * as path from 'path';

const scriptsDir = path.join(process.cwd(), 'scripts');
const files = fs.readdirSync(scriptsDir).filter(f => f.startsWith('e2e-') && f.endsWith('.ts'));

for (const file of files) {
  const filePath = path.join(scriptsDir, file);
  let content = fs.readFileSync(filePath, 'utf8');

  // Replace imports / constants
  content = content.replace(
    /const BASE = process\.env\.E2E_BASE_URL \?\? 'http:\/\/localhost:3000'\nconst EMAIL = process\.env\.E2E_EMAIL \?\? 'advayvaidya\.25@gmail\.com'/,
    "import { getE2EEmail, verifyAndGetE2EUser, resetE2EUser, E2E_BASE_URL } from '../src/lib/testing/e2eIdentity'\n\nconst BASE = E2E_BASE_URL\nconst EMAIL = getE2EEmail()"
  );

  // Replace uid fetch with verifyAndGetE2EUser in main()
  content = content.replace(
    /const \{ data: users \} = await admin\.auth\.admin\.listUsers\(\)\n\s+const uid = \(\(users as any\)\?\.users \?\? \[\]\)\.find\(\(u: any\) => u\.email\?\.toLowerCase\(\) === EMAIL\.toLowerCase\(\)\)\?\.id\n\s+if \(!uid\) throw new Error\('no account.*?first(?: to create it)?'\)/g,
    "const uid = await verifyAndGetE2EUser(admin)"
  );
  
  content = content.replace(
    /const \{ data: users \} = await admin\.auth\.admin\.listUsers\(\)\n\s+const uid = \(\(users as any\)\?\.users \?\? \[\]\)\.find\(\(u: any\) => u\.email\?\.toLowerCase\(\) === EMAIL\.toLowerCase\(\)\)\?\.id\n\s+if \(!uid\) throw new Error\('no account'\)/g,
    "const uid = await verifyAndGetE2EUser(admin)"
  );
  
  // Replace huge delete block with resetE2EUser(admin, uid)
  content = content.replace(
    /await admin\.from\('roadmap_milestones'\)\.delete\(\)\.eq\('user_id', uid\)\n\s+await admin\.from\('study_roadmaps'\)\.delete\(\)\.eq\('user_id', uid\)\n\s+await admin\.from\('user_module_state'\)\.delete\(\)\.eq\('user_id', uid\)\n\s+await admin\.from\('availability_rules'\)\.delete\(\)\.eq\('user_id', uid\)\n\s+await admin\.from\('calendar_commitments'\)\.delete\(\)\.eq\('user_id', uid\)\n\s+await admin\.from\('user_sources'\)\.delete\(\)\.eq\('user_id', uid\)\n\s+await admin\.from\('task_events'\)\.delete\(\)\.eq\('user_id', uid\)\n\s+await admin\.from\('plan_blocks'\)\.delete\(\)\.eq\('user_id', uid\)/g,
    "await resetE2EUser(admin, uid)"
  );

  fs.writeFileSync(filePath, content);
  console.log('Updated ' + file);
}
