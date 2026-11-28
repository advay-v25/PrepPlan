/** Refuse fixture creation unless the app, Auth/REST client and checksum-verified SQL target agree. */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { parse } from 'dotenv'
import { assertRehearsalTarget } from './lib/rehearsalTarget'
const require = createRequire(import.meta.url)
const { Client } = require('pg')
const { configuration, readMigrations, migrate } = require('./lib/migrations.cjs')

/** The isolated local stack (scripts/local-stack.cjs): a loopback app, a loopback gateway and a stack the runner itself recorded. No hosted project is reachable. */
async function assertLocalStack(base: URL) {
  const origin = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  if (process.env.LOCAL_STACK !== '1' || !process.env.LOCAL_STACK_DIR || !/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)
    || !['localhost', '127.0.0.1'].includes(base.hostname) || base.protocol !== 'http:' || !process.env.HEALTHCHECK_SECRET) throw Error('Local-stack runs require a loopback app, the recorded stack and HEALTHCHECK_SECRET.')
  const recorded = JSON.parse(fs.readFileSync(path.join(process.env.LOCAL_STACK_DIR, 'stack.json'), 'utf8')) as { origin: string }
  if (recorded.origin !== origin) throw Error('The configured database is not the recorded local stack.')
  const check = await fetch(new URL('/api/health?ready=1', base), { headers: { Authorization: `Bearer ${process.env.HEALTHCHECK_SECRET}` }, redirect: 'error', signal: AbortSignal.timeout(15_000) })
  const seen = check.ok ? (await check.json()).databaseOrigin : null
  if (seen === origin) return
  // An explicitly selected loopback fault proxy may stand between the app and the SAME recorded stack, and must say so itself.
  const proxy = process.env.E2E_PRIVATE_PROXY_ORIGIN
  if (!proxy || !/^http:\/\/127\.0\.0\.1:\d+$/.test(proxy) || seen !== proxy) throw Error('Could not verify the local stack behind the loopback app.')
  const proof = await fetch(new URL('/__prepplan_target', proxy), { redirect: 'error', signal: AbortSignal.timeout(5000) })
  const identity = proof.ok ? await proof.json() as { role?: string; targetOrigin?: string } : null
  if (identity?.role !== 'private-disposable-proxy' || identity.targetOrigin !== origin) throw Error('The fault proxy does not front the recorded local stack.')
}

export default async function lifecycleSetup() {
  const base = new URL(process.env.E2E_BASE_URL || 'http://localhost:3141')
  if (process.env.E2E_SUITE === 'local-stack') return assertLocalStack(base)
  const deployedOwned = process.env.E2E_SUITE === 'deployed-owned'
  const target = deployedOwned ? process.env.E2E_TARGET : process.env.E2E_CONFIRMED_DISPOSABLE_PROJECT_REF
  if (deployedOwned) {
    // Production has a Disk IO budget (a 25 Nov 2026 warning said it was depleting). A deployed run must name the specs it wants; a bare full run is ~46 tests of churn.
    const named = process.argv.slice(2).some(a => /\.spec(\.ts)?$/.test(a))
    if (!named && process.env.E2E_DEPLOYED_FULL !== '1') throw Error('Deployed runs must name their specs. A full run adds ~46 tests of fixture churn to production; set E2E_DEPLOYED_FULL=1 only with the owner\'s say-so.')
    if (target !== 'woboyakjtgltgekwtddo' || process.env.E2E_ALLOW_TARGET !== target
      || !['localhost', '127.0.0.1'].includes(base.hostname) || base.protocol !== 'http:'
      || !process.env.HEALTHCHECK_SECRET) throw Error('Owned-student runs require the exact deployed target opt-in and a verified loopback app.')
    const origin = `https://${target}.supabase.co`
    if (process.env.NEXT_PUBLIC_SUPABASE_URL !== origin) throw Error('Owned-student REST target differs from the deployed project.')
    const check = await fetch(new URL('/api/health?ready=1', base), {
      headers: { Authorization: `Bearer ${process.env.HEALTHCHECK_SECRET}` }, redirect: 'error', signal: AbortSignal.timeout(15_000),
    })
    if (!check.ok || (await check.json()).databaseOrigin !== origin) throw Error('Could not verify the deployed database behind the loopback app.')
  } else {
    await assertRehearsalTarget(process.env, base.href)
  }
  const env = parse(fs.readFileSync(deployedOwned ? '.env.production.local' : process.env.E2E_ENV_FILE || '.env.staging.local'))
  const cfg = configuration([deployedOwned ? '--env=production' : '--env=staging', '--dry-run'], env)
  if (cfg.identity !== target) throw Error('Lifecycle SQL target differs from the app target. No fixtures were created.')
  const result = await migrate(new Client(cfg.connection), readMigrations(path.join(process.cwd(), 'supabase/migrations')), cfg)
  if (result.baselineRequired || result.pending.length) throw Error('Lifecycle SQL schema is not current. Rehearse/apply the disposable migrations before creating fixtures.')
}
