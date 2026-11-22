/** A booking refused inside the database (SQLSTATE BK409, see migration 20261128): nothing was saved. Infrastructure errors are NOT this. */
type DbError = { code?: string; message?: string; details?: string | null; hint?: string | null } | null | undefined

export const isBookingConflict = (e: DbError) => e?.code === 'BK409'

/** For commitment writers: DETAIL is the booked mock, HINT the occurrence that would land on it. */
export function commitmentConflict(e: NonNullable<DbError>) {
  const mock = e.details || 'your mock', what = e.hint || 'This'
  return {
    ok: false as const, code: 'BOOKING_CONFLICT',
    error: `${what} would overlap ${mock}, which is already booked at that time. Nothing was saved. Choose another time, or move the mock first.`,
    conflicts: [{ title: mock }],
  }
}
