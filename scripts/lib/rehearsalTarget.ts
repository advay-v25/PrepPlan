/** Before creating any fixture student, bind the journey runner and app to the authorised disposable project. */
export async function assertRehearsalTarget(env: Record<string, string | undefined>, baseUrl: string, send: typeof fetch = fetch) {
  const target = env.E2E_CONFIRMED_DISPOSABLE_PROJECT_REF
  if (target !== 'mnlezctdqkdfgvmipmcj') throw new Error('Rehearsal journeys require the authorised disposable project.')
  const origin = `https://${target}.supabase.co`
  if (env.NEXT_PUBLIC_SUPABASE_URL !== origin) throw new Error('Journey database does not match the disposable project.')
  if (!(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY) || !(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY)) {
    throw new Error('Configure public Auth and server keys for the disposable project.')
  }
  if (!env.HEALTHCHECK_SECRET) throw new Error('HEALTHCHECK_SECRET is required to verify the app target before creating fixtures.')
  const response = await send(new URL('/api/health?ready=1', baseUrl), {
    headers: { Authorization: `Bearer ${env.HEALTHCHECK_SECRET}` }, redirect: 'error', signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error('App readiness failed; no rehearsal fixtures were created.')
  const body = await response.json()
  if (body.ok !== true) throw new Error('App database does not match the journey target; no fixtures were created.')
  if (body.databaseOrigin === origin) return
  // Only an explicitly selected loopback harness can stand between this app and the same disposable target.
  const proxy = env.E2E_PRIVATE_PROXY_ORIGIN
  if (!proxy || !/^http:\/\/127\.0\.0\.1:\d+$/.test(proxy) || body.databaseOrigin !== proxy) throw new Error('App database does not match the journey target; no fixtures were created.')
  const proof = await send(new URL('/__prepplan_target', proxy), { redirect: 'error', signal: AbortSignal.timeout(5000) })
  const identity = proof.ok ? await proof.json() : null
  if (identity?.role !== 'private-disposable-proxy' || identity?.targetOrigin !== origin) throw new Error('Private proxy does not match the disposable target; no fixtures were created.')
}
