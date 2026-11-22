/** Explicit target, read-only preview, immutable migration history. No .env fallback. */
const { Client } = require('pg');
const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('dotenv');
const { configuration, readMigrations, migrate, SafeMigrationError } = require('./lib/migrations.cjs');

async function main(args = process.argv.slice(2)) {
  const root = path.resolve(__dirname, '..');
  const target = args.find(a => a.startsWith('--env='))?.slice(6);
  if (!['local', 'staging', 'production'].includes(target)) {
    throw new SafeMigrationError('Specify --env=local, --env=staging or --env=production.');
  }
  const filename = target === 'local' ? '.env.local' : `.env.${target}.local`;
  const envPath = path.join(root, filename);
  if (!fs.existsSync(envPath)) throw new SafeMigrationError(`Missing ${filename}; no other environment will be used.`);
  // The named target file is the only source, without ambient app/CI overrides.
  const config = configuration(args, parse(fs.readFileSync(envPath)));
  const migrations = readMigrations(path.join(root, 'supabase', 'migrations'));
  console.log(`${config.apply ? 'Apply' : 'Read-only preview'}: ${target}, target ${config.identity}`);
  const result = await migrate(new Client(config.connection), migrations, config);
  result.pending.forEach(version => console.log(`- ${config.apply ? 'Applied' : 'Pending'}: ${version}`));
  console.log(result.baselineRequired
    ? 'Existing untracked schema: baseline reconciliation is required before apply. No history was invented.'
    : `${result.pending.length} ${config.apply ? 'applied' : 'pending'} migration(s).`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(error instanceof SafeMigrationError ? error.message : 'Migration failed; connection details withheld.');
    process.exitCode = 1;
  });
}

module.exports = { main };
