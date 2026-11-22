/** Owner tool for the private-beta admission list. Creates database records only: it NEVER sends an email (the cohort is opened by the owner).
 *    node scripts/beta/invite.cjs --env=staging|production --confirm-target=<ref> --email=a@b.c [--role=candidate|reviewer] [--days=14] [--note=...]
 *    node scripts/beta/invite.cjs … --revoke --email=a@b.c        node scripts/beta/invite.cjs … --mode=invite_only|open        node scripts/beta/invite.cjs … --list */
const fs = require('node:fs'), path = require('node:path')
const { Client } = require('pg'); const { parse } = require('dotenv')
const { configuration } = require('../lib/migrations.cjs')
const arg = (k, d) => (process.argv.find(a => a.startsWith(`--${k}=`)) ?? '').split('=').slice(1).join('=') || d
async function main() {
  const env = arg('env', 'staging'), file = path.join(path.resolve(__dirname, '../..'), `.env.${env}.local`)
  const cfg = configuration([`--env=${env}`, '--dry-run'], parse(fs.readFileSync(file)))
  if (!process.argv.includes(`--confirm-target=${cfg.identity}`)) throw Error(`Pass --confirm-target=${cfg.identity}.`)
  const c = new Client(cfg.connection); await c.connect()
  try {
    if (process.argv.includes('--list')) { console.table((await c.query("select email, role, status, expires_at::date exp, (accepted_user_id is not null) bound from public.beta_invitations order by created_at")).rows); return }
    if (arg('mode')) { if (!['invite_only', 'open'].includes(arg('mode'))) throw Error('mode must be invite_only or open'); await c.query("update public.beta_settings set value=$1, updated_at=now() where key='admission'", [arg('mode')]); console.log('admission mode:', arg('mode')); return }
    const email = arg('email'); if (!email) throw Error('--email is required')
    if (process.argv.includes('--revoke')) { const r = await c.query("update public.beta_invitations set status='revoked' where email=lower(btrim($1)) and status in ('pending','accepted')", [email]); console.log('revoked:', r.rowCount); return }
    const r = (await c.query('select public.create_beta_invitation($1,$2,$3,$4) r', [email, arg('role', 'candidate'), Number(arg('days', 14)), arg('note') ?? null])).rows[0].r
    console.log(r.ok ? 'invitation recorded (no email sent)' : `not created: ${r.code}`)
  } finally { await c.end() }
}
main().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
