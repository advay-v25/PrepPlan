const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { configuration, transactionalSql, readMigrations, pendingMigrations, migrate } = require('./lib/migrations.cjs');

const local = { MIGRATION_DATABASE_URL: 'postgresql://test:a%40b@127.0.0.1:5432/roadmap_test', MIGRATION_EXPECTED_DATABASE: 'roadmap_test' };
const hosted = { NEXT_PUBLIC_SUPABASE_URL: 'https://testproject.supabase.co', MIGRATION_EXPECTED_PROJECT_REF: 'testproject', SUPABASE_DB_PASSWORD: 'fake:@/password' };
const preview = configuration(['--env=local', '--dry-run'], local);
const file = { version: 'one', checksum: 'original', sql: 'create table proof (id int)' };

test('target files must bind identity, mode and confirmation explicitly', () => {
  assert.throws(() => configuration([], local));
  assert.throws(() => configuration(['--env=local'], local));
  assert.throws(() => configuration(['--env=local', '--dry-run', '--apply'], local));
  assert.throws(() => configuration(['--env=local', '--env=staging', '--dry-run'], local));
  assert.throws(() => configuration(['--env=production', '--apply'], hosted));
  assert.throws(() => configuration(['--env=staging', '--dry-run'], { ...hosted, MIGRATION_EXPECTED_PROJECT_REF: 'differentproject' }));
  assert.throws(() => configuration(['--env=local', '--dry-run'], { ...local, MIGRATION_DATABASE_URL: 'postgresql://test@remote.example/roadmap_test' }));
  assert.throws(() => configuration(['--env=local', '--dry-run'], { ...local, MIGRATION_DATABASE_URL: local.MIGRATION_DATABASE_URL + '?host=remote.example' }));
  assert.equal(preview.connection.password, 'a@b');
  const remote = configuration(['--env=staging', '--apply', '--confirm-target=testproject'], hosted);
  assert.equal(remote.connection.password, hosted.SUPABASE_DB_PASSWORD);
  assert.equal(remote.connection.ssl.rejectUnauthorized, true);
});

test('checksum drift or a missing applied file prevents replay', () => {
  assert.deepEqual(pendingMigrations([file], []), [file]);
  assert.deepEqual(pendingMigrations([file], [{ version: 'one', checksum: 'original' }]), []);
  assert.throws(() => pendingMigrations([file], [{ version: 'one', checksum: 'edited' }]), /Checksum drift/);
  assert.throws(() => pendingMigrations([], [{ version: 'one', checksum: 'original' }]), /missing/);
  assert.throws(() => pendingMigrations([{ version: 'earlier', checksum: 'new', sql: 'select 1' }, file], [{ version: 'one', checksum: 'original' }]), /predates/);
});

test('transaction wrappers cannot commit SQL ahead of its ledger entry', () => {
  assert.equal(transactionalSql('-- old file\nbegin; create table proof(id int); commit;').trim(), 'create table proof(id int);');
  assert.throws(() => transactionalSql('create table proof(id int); commit;'), /transaction control/);
  assert.throws(() => transactionalSql('create table proof(id int); abort;'), /transaction control/);
  assert.throws(() => transactionalSql('begin; begin; select 1; commit; commit;'), /transaction control/);
  assert.match(transactionalSql("create function x() returns void language plpgsql as $fn$ begin perform ';commit;'; end; $fn$;"), /perform/);
  assert.throws(() => transactionalSql('/* nested /* comment */ still comment */ commit;'), /transaction control/);
  assert.throws(() => transactionalSql("select E'escaped\\\';still string'; commit;"), /transaction control/);
  assert.equal(readMigrations(path.join(__dirname, '..', 'supabase/migrations')).length >= 50, true);
});

function fake(overrides = {}) {
  const queries = [];
  return {
    queries, closed: false,
    async connect() { if (overrides.connectFailure) throw Error('unavailable'); },
    async end() { this.closed = true; },
    async query(sql, values) {
      queries.push({ sql, values });
      if (sql.includes('pg_try_advisory_lock')) return { rows: [{ acquired: !overrides.locked }] };
      if (sql.includes('current_database')) return { rows: [{ name: 'roadmap_test' }] };
      if (sql.includes('to_regclass')) return { rows: [{ ledger: overrides.ledger ? 'schema_migrations' : null }] };
      if (sql.includes('select version')) return { rows: overrides.applied ?? [] };
      if (sql.includes('information_schema')) return { rows: [{ present: overrides.existing ?? false }] };
      if (sql === file.sql && overrides.sqlFailure) throw Error('insert failed');
      return { rows: [] };
    },
  };
}

test('dry run performs only a read-only transaction; no ledger, locks or schema writes', async () => {
  const client = fake();
  assert.deepEqual(await migrate(client, [file], preview), { pending: ['one'], baselineRequired: false });
  assert.equal(client.queries[0].sql, 'BEGIN READ ONLY');
  assert.equal(client.queries.at(-1).sql, 'ROLLBACK');
  assert.equal(client.queries.some(q => /create|insert|update|delete|advisory|notify/i.test(q.sql)), false);
  assert.equal(client.closed, true);
});

test('untracked existing schema is reported in preview and refused on apply', async () => {
  assert.equal((await migrate(fake({ existing: true }), [file], preview)).baselineRequired, true);
  const client = fake({ existing: true });
  await assert.rejects(migrate(client, [file], { ...preview, apply: true }), /baseline/);
  assert.equal(client.queries.some(q => /create table|insert into/i.test(q.sql)), false);
  assert.equal(client.closed, true);
});

test('drift and lock contention release resources without applying SQL', async () => {
  const drift = fake({ ledger: true, applied: [{ version: 'one', checksum: 'edited' }] });
  await assert.rejects(migrate(drift, [file], { ...preview, apply: true }), /Checksum drift/);
  assert.equal(drift.queries.some(q => q.sql === file.sql), false);
  assert.equal(drift.closed, true);
  const busy = fake({ locked: true });
  await assert.rejects(migrate(busy, [file], { ...preview, apply: true }), /holds the lock/);
  assert.equal(busy.queries.length, 1);
  assert.equal(busy.closed, true);
});

test('failure rolls back task migration and ledger together, unlocks and closes', async () => {
  const client = fake({ sqlFailure: true });
  await assert.rejects(migrate(client, [file], { ...preview, apply: true }));
  assert.equal(client.queries.at(-2).sql, 'ROLLBACK');
  assert.match(client.queries.at(-1).sql, /advisory_unlock/);
  assert.equal(client.queries.some(q => q.sql.startsWith('insert into public.schema_migrations')), false);
  assert.equal(client.closed, true);
  const unavailable = fake({ connectFailure: true });
  await assert.rejects(migrate(unavailable, [file], preview));
  assert.equal(unavailable.closed, true);
});
