import { trace } from '../../../../lib/ops/trace'
import { NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { createClient, clearSessionCookies } from '../../../../lib/supabase/server'
import { createAdminClient } from '../../../../lib/supabase/admin'
import { removeOwnedStorage } from '../../../../lib/account/storageCleanup'
import { isRecentAuthClaim, RECENT_AUTH_MINUTES } from '../../../../lib/auth/recentAuth'
import { verifiedSession } from '../../../../lib/auth/recoverySession'
import { rateLimit, sessionIsActive } from '../../../../lib/auth/securityServer'
import { JsonInputError, readBoundedJson } from '../../../../lib/auth/requestSecurity'
import { boundedStage } from '../../../../lib/ops/requestBudget'

export const dynamic = 'force-dynamic'
/** Deletion needs THIS session to have authenticated within this window (a stolen idle session cannot delete the account). */
export const RECENT_SIGN_IN_MINUTES = RECENT_AUTH_MINUTES

/**
 * Deliberate account deletion. Body: { confirmEmail } — the student types their own email address. The sign-in must be recent.
 * Deleting the auth user cascades to every row the student owns (study data, assessment records, reminders and pending reminder jobs).
 * What stays: a one-way hash of the id with a timestamp (a pseudonymous record that a deletion happened; anyone who already knew the id could recompute the hash), and the provider's backups until they age out.
 * Storage deletion and provider account deletion are separate. Report an unknown outcome on a lost provider response.
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()      // verified with the auth server: a deleted account's old token fails here
  if (!user) return NextResponse.json({ error: 'Sign in to delete your account.' }, { status: 401 })
  let body: { confirmEmail?: unknown } | null
  try { body = await readBoundedJson(request, 2048) as typeof body }
  catch (error) {
    if (error instanceof JsonInputError) return NextResponse.json({ error: error.message }, { status: error.status })
    return NextResponse.json({ error: 'PrepPlan could not read this request.' }, { status: 400 })
  }
  if (!user.email || !body || typeof body.confirmEmail !== 'string' || body.confirmEmail.trim().toLowerCase() !== user.email.toLowerCase()) {
    return NextResponse.json({ code: 'CONFIRMATION_REQUIRED', error: 'Type your account email address to confirm. Nothing was deleted.' }, { status: 400 })
  }
  let fresh = false
  try {
    const session = await verifiedSession(supabase)
    fresh = !!session && session.userId === user.id && isRecentAuthClaim(session.claims.amr) && await sessionIsActive(user.id, session.id)
  } catch {
    return NextResponse.json({ code: 'AUTH_UNAVAILABLE', error: 'PrepPlan could not check your session. Try again shortly.' }, { status: 503 })
  }
  if (!fresh) {
    return NextResponse.json({ code: 'RECENT_SIGN_IN_REQUIRED', error: `For your safety, sign in again (within the last ${RECENT_SIGN_IN_MINUTES} minutes) and then delete your account. Nothing was deleted.` }, { status: 403 })
  }
  const limited = await rateLimit('account_delete', user.id)
  if (limited) return limited
  const admin = createAdminClient()
  const hash = createHash('sha256').update(user.id).digest('hex')
  // Owned files (none exist today) go first through the Storage API; a failure leaves the account intact and says exactly that. Removed files stay removed on retry.
  const files = await removeOwnedStorage(user.id)
  const gone = (n: number) => n > 0 ? ` ${n} file${n === 1 ? ' was' : 's were'} already removed and stay removed; that cannot be undone.` : ''
  if (!files.ok) return NextResponse.json({ code: 'CLEANUP_INCOMPLETE', accountDeleted: false, filesRemoved: files.removed, error: `${files.message} Your account is still there.${gone(files.removed)} Try again; it continues where it stopped.` }, { status: 500 })
  // Files and account are NOT one transaction. Auth deletion cascades every owned row, reminder preference and pending reminder job in one database
  // transaction: if it fails the account and its data are exactly as they were, but files removed above stay removed. The message says which is which.
  // A reminder already handed to the provider cannot be recalled.
  const audit = async (outcome: 'failed' | 'deleted') => {
    try { const { error: e } = await admin.from('account_deletions').insert({ user_hash: hash, outcome }); if (e) console.error(`[account delete] audit write (${outcome}) failed:`, e.message) }
    catch (e) { console.error(`[account delete] audit write (${outcome}) threw:`, (e as Error).message) }
  }
  const unknown = () => NextResponse.json({ code: 'DELETE_OUTCOME_UNKNOWN', filesRemoved: files.removed,
    error: `PrepPlan could not confirm whether your account was deleted.${gone(files.removed)} If you can still sign in with your existing credentials, you can retry from Account.` }, { status: 502 })
  const outcome = await boundedStage('delete account', 15_000, () => admin.auth.admin.deleteUser(user.id)).catch(() => null)
  if (!outcome) return unknown()
  const { error } = outcome
  if (error && (error.status === undefined || error.status === 0 || error.status >= 500)) return unknown()
  if (error) {
    console.error('[account delete] provider refused', error.status)
    await audit('failed')
    return NextResponse.json({ code: 'DELETE_FAILED', accountDeleted: false, filesRemoved: files.removed, error: `Your account could not be deleted. Your account and its study data are still there, nothing in the database was removed.${gone(files.removed)} Try again in a few minutes; if it keeps failing, email support and quote the time you tried.` }, { status: 500 })
  }
  // The account is GONE at this point. An audit-write failure (returned error or thrown) is logged and never changes the outcome.
  await audit('deleted')
  await clearSessionCookies()
  trace('account', 'deleted', {})
  return NextResponse.json({ success: true })
}

/** The immediate-delete endpoint is retired: deletion now needs confirmation and a recent sign-in. */
export async function DELETE() {
  return NextResponse.json({ code: 'RETIRED', error: 'Use POST with your email address to confirm.' }, { status: 410 })
}
