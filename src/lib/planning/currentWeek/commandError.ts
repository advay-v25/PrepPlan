/** Shared responses for the two commands, including failures whose outcome needs a same-request retry. */
export function currentWeekCommandError(message: string) {
  const code = ['CYCLE_ENDED', 'CYCLE_CHANGED', 'STALE_PROPOSAL', 'INVALID_PROPOSAL', 'NOT_FOUND', 'ACCESS_REQUIRED'].find(c => message.includes(c))
    ?? (/Unauthorized|not found/i.test(message) ? 'NOT_FOUND' : /Application access required/i.test(message) ? 'ACCESS_REQUIRED' : 'SAVE_UNCONFIRMED')
  const error = {
    CYCLE_ENDED: 'This cycle has ended. Prepare the next week in your weekly review.',
    CYCLE_CHANGED: 'This is no longer your active week. Open Calendar to review the current week.',
    STALE_PROPOSAL: 'Your week, setup or remaining study time changed. Rebuild the plan to see what fits now.',
    INVALID_PROPOSAL: 'This plan could not be validated. Rebuild it before continuing.',
    NOT_FOUND: 'That plan was not found.',
    ACCESS_REQUIRED: 'Verify your email and complete setup before using your plan.',
    SAVE_UNCONFIRMED: 'The save could not be confirmed. Retry the same request to check its outcome safely.',
  }[code]!
  return {
    ok: false as const, code, error,
    rebuild: code === 'STALE_PROPOSAL' || code === 'INVALID_PROPOSAL',
    uncertain: code === 'SAVE_UNCONFIRMED',
    nextUrl: code === 'CYCLE_ENDED' ? '/app/review-week' : code === 'CYCLE_CHANGED' ? '/app/calendar' : null,
    status: code === 'NOT_FOUND' ? 404 : code === 'ACCESS_REQUIRED' ? 403 : code === 'SAVE_UNCONFIRMED' ? 503 : 409,
  }
}
