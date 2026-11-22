/** The current preflight and start flow owns eligibility and completed-learning scope. */
export async function POST() {
  return Response.json({
    ok: false,
    code: 'RETIRED',
    error: 'Open Tests to check and start your paper.',
    url: '/app/tests',
  }, { status: 410 })
}
