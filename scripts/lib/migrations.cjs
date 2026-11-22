const fs = require('node:fs');
const crypto = require('node:crypto');

class SafeMigrationError extends Error {}
const fail = message => { throw new SafeMigrationError(message); };

function configuration(args, env) {
  const allowed = /^(--env=(local|staging|production)|--dry-run|--apply|--confirm-target=[a-zA-Z0-9_:-]+)$/;
  if (args.some(a => !allowed.test(a)) || new Set(args).size !== args.length) fail('Unknown or duplicate migration argument.');
  if (args.filter(a => a.startsWith('--env=')).length !== 1) fail('Specify exactly one --env target.');
  if (args.includes('--dry-run') === args.includes('--apply')) fail('Choose exactly one mode: --dry-run or --apply.');
  if (args.filter(a => a.startsWith('--confirm-target=')).length > 1) fail('Specify only one target confirmation.');
  const target = args.find(a => a.startsWith('--env=')).slice(6);
  const apply = args.includes('--apply');
  let connection, identity;
  if (target === 'local') {
    let url;
    try { url = new URL(env.MIGRATION_DATABASE_URL); } catch { fail('Local migrations require MIGRATION_DATABASE_URL in .env.local.'); }
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
      fail('Local target must use a loopback Postgres address. A hosted project cannot be labelled local.');
    }
    if (url.search || url.hash) fail('Local migration URL must not contain query parameters or fragments.');
    const database = decodeURIComponent(url.pathname.slice(1));
    if (!database || database !== env.MIGRATION_EXPECTED_DATABASE) fail('Local database must match MIGRATION_EXPECTED_DATABASE.');
    identity = `local:${database}`;
    connection = {
      host: url.hostname.replace(/^\[|\]$/g, ''), port: Number(url.port || 5432), database,
      user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), ssl: false,
    };
  } else {
    let url;
    try { url = new URL(env.NEXT_PUBLIC_SUPABASE_URL); } catch { fail('Target file must contain a valid NEXT_PUBLIC_SUPABASE_URL.'); }
    const project = /^([a-z0-9]+)\.supabase\.co$/.exec(url.hostname)?.[1];
    if (url.protocol !== 'https:' || !project || url.username || url.password || url.port || url.search || url.hash || url.pathname !== '/') {
      fail('Hosted target must be a canonical https://<project>.supabase.co URL.');
    }
    if (project !== env.MIGRATION_EXPECTED_PROJECT_REF) fail('Project does not match MIGRATION_EXPECTED_PROJECT_REF in the target file.');
    if (!env.SUPABASE_DB_PASSWORD) fail('Target file is missing SUPABASE_DB_PASSWORD.');
    identity = project;
    const port = Number(env.SUPABASE_DB_PORT || 6543);
    connection = {
      host: `db.${project}.supabase.co`, port, database: 'postgres', user: 'postgres',
      password: env.SUPABASE_DB_PASSWORD,
      ssl: env.MIGRATION_SSL_CA_FILE
        ? { rejectUnauthorized: true, ca: fs.readFileSync(env.MIGRATION_SSL_CA_FILE, 'utf8') }
        : { rejectUnauthorized: false },
    };
  }
  if (apply && !args.includes(`--confirm-target=${identity}`)) fail(`Apply requires --confirm-target=${identity}.`);
  return { target, apply, identity, connection: { ...connection, connectionTimeoutMillis: 10000, application_name: 'roadmap-migrations' } };
}

/** Split top-level SQL without splitting function bodies, strings or comments. */
function statements(sql) {
  const out = [];
  let start = 0, i = 0, quote = null, dollar = null, comment = 0, escaped = false;
  while (i < sql.length) {
    if (comment) {
      if (sql.slice(i, i + 2) === '/*') { comment++; i += 2; }
      else if (sql.slice(i, i + 2) === '*/') { comment--; i += 2; }
      else i++;
    } else if (dollar) {
      if (sql.startsWith(dollar, i)) { i += dollar.length; dollar = null; } else i++;
    } else if (quote) {
      if (escaped && sql[i] === '\\') i += 2;
      else if (sql[i] === quote && sql[i + 1] === quote) i += 2;
      else if (sql[i] === quote) { quote = null; i++; } else i++;
    } else if (sql.slice(i, i + 2) === '--') {
      const end = sql.indexOf('\n', i); i = end < 0 ? sql.length : end + 1;
    } else if (sql.slice(i, i + 2) === '/*') { comment = 1; i += 2;
    } else if (sql[i] === "'" || sql[i] === '"') {
      escaped = sql[i] === "'" && /[eE]/.test(sql[i - 1] ?? '') && !/[\w$]/.test(sql[i - 2] ?? '');
      quote = sql[i++];
    } else if (sql[i] === '$' && /^\$(?:[a-zA-Z_][a-zA-Z_0-9]*)?\$/.test(sql.slice(i))) {
      dollar = /^\$(?:[a-zA-Z_][a-zA-Z_0-9]*)?\$/.exec(sql.slice(i))[0]; i += dollar.length;
    } else if (sql[i++] === ';') { out.push(sql.slice(start, i)); start = i; }
  }
  if (quote || dollar || comment) fail('Unterminated SQL literal or comment.');
  out.push(sql.slice(start));
  return out.map(text => {
    // Skip only LEADING comments. Do not rewrite literals or function bodies
    // when inspecting the first statement keyword. Block comments can nest.
    let at = 0;
    while (at < text.length) {
      if (/\s/.test(text[at])) { at++; continue; }
      if (text.slice(at, at + 2) === '--') {
        const end = text.indexOf('\n', at); at = end < 0 ? text.length : end + 1; continue;
      }
      if (text.slice(at, at + 2) !== '/*') break;
      let depth = 1; at += 2;
      while (depth && at < text.length) {
        if (text.slice(at, at + 2) === '/*') { depth++; at += 2; }
        else if (text.slice(at, at + 2) === '*/') { depth--; at += 2; }
        else at++;
      }
    }
    return { text, head: text.slice(at).trim() };
  }).filter(s => s.head);
}

function transactionalSql(sql) {
  let parts = statements(sql);
  const transaction = /^(begin\b|start\s+transaction\b|commit\b|end\b|rollback\b|abort\b|prepare\s+transaction\b|set\s+transaction\b)/i;
  // Only unwrap a single outer BEGIN/COMMIT. Checksum still uses original bytes.
  if (/^begin\s*;?$/i.test(parts[0]?.head ?? '') && /^commit\s*;?$/i.test(parts.at(-1)?.head ?? '')) parts = parts.slice(1, -1);
  if (parts.some(p => transaction.test(p.head))) fail('Migration contains transaction control outside a single outer BEGIN/COMMIT wrapper.');
  return parts.map(p => p.text).join('\n');
}

function readMigrations(directory) {
  const files = fs.readdirSync(directory).filter(f => f.endsWith('.sql')).sort();
  if (!files.length) fail('No migration files found.');
  return files.map(file => {
    const sql = fs.readFileSync(require('node:path').join(directory, file), 'utf8');
    return { version: file.slice(0, -4), checksum: crypto.createHash('sha256').update(sql).digest('hex'), sql: transactionalSql(sql) };
  });
}

function pendingMigrations(files, applied) {
  const byVersion = new Map(files.map(f => [f.version, f]));
  for (const row of applied) {
    if (!byVersion.has(row.version)) fail(`Applied migration missing from checkout: ${row.version}`);
    if (byVersion.get(row.version).checksum !== row.checksum) fail(`Checksum drift: ${row.version}. Restore the original file; add a new migration for changes.`);
  }
  const versions = new Set(applied.map(a => a.version));
  const pending = files.filter(f => !versions.has(f.version));
  const latest = [...versions].sort().at(-1);
  if (latest && pending.some(f => f.version < latest)) fail('A pending migration predates applied history. Reconcile migration order before applying.');
  return pending;
}

async function migrate(client, files, config) {
  let connected = false, locked = false, transaction = false;
  try {
    await client.connect(); connected = true;
    if (config.apply) {
      const { rows } = await client.query('select pg_try_advisory_lock(1) as acquired');
      if (!rows[0]?.acquired) fail('Another migration runner holds the lock.');
      locked = true;
    }
    await client.query('BEGIN READ ONLY'); transaction = true;
    const { rows: db } = await client.query('select current_database() as name');
    if (db[0]?.name !== config.connection.database) fail('Connected database does not match the configured target.');
    const { rows: ledger } = await client.query("select to_regclass('public.schema_migrations') as ledger");
    const applied = ledger[0]?.ledger ? (await client.query('select version, checksum from public.schema_migrations order by version')).rows : [];
    const pending = pendingMigrations(files, applied);
    const { rows: existing } = await client.query("select exists (select 1 from information_schema.tables where table_schema = 'public' and table_name <> 'schema_migrations') as present");
    const baselineRequired = applied.length === 0 && !!existing[0]?.present;
    await client.query('ROLLBACK'); transaction = false;
    if (baselineRequired && config.apply) fail('Existing schema has no migration history. Reconcile its baseline before applying; nothing was applied.');
    if (config.apply && pending.length) {
      for (const file of pending) {
        try {
          await client.query('BEGIN'); transaction = true;
          await client.query('SET LOCAL standard_conforming_strings = on');
          // First ledger and first migration share the same transaction.
          if (!ledger[0]?.ledger) await client.query('create table if not exists public.schema_migrations (version text primary key, checksum text not null, applied_at timestamptz not null default now())');
          await client.query(file.sql);
          await client.query('insert into public.schema_migrations (version, checksum) values ($1, $2)', [file.version, file.checksum]);
          await client.query('COMMIT'); transaction = false;
        } catch (error) {
          const code = /^[A-Z0-9]{5}$/.test(error.code ?? '') ? ` (SQLSTATE ${error.code})` : '';
          throw new SafeMigrationError(`Failed while applying ${file.version}${code}. Check history with --dry-run before retrying; earlier files may already be committed.`);
        }
      }
      await client.query("NOTIFY pgrst, 'reload schema'");
    }
    return { pending: pending.map(p => p.version), baselineRequired };
  } finally {
    try { if (transaction && connected) await client.query('ROLLBACK'); }
    finally {
      try { if (locked) await client.query('select pg_advisory_unlock(1)'); }
      finally { await client.end(); }
    }
  }
}

module.exports = { SafeMigrationError, configuration, statements, transactionalSql, readMigrations, pendingMigrations, migrate };
