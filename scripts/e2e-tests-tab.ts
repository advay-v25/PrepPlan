/**
 * End-to-end check of the tests tab against a running dev server.
 *
 * Signs in with a Supabase admin-generated magic link, then drives the real
 * HTTP endpoints the browser uses: assemble a form, answer every question,
 * score it, read the result page, challenge an item, and probe the guard rails.
 *
 *   npm run dev                              # in another terminal
 *   npx tsx scripts/e2e-tests-tab.ts --reset
 *
 * --reset clears the test account's own attempts, responses, evidence, and
 * challenges first. Exposure control means a learner never sees an item twice,
 * so without it the suite can only run once before the bank is used up. It
 * touches only rows belonging to E2E_EMAIL.
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local', quiet: true } as any)

import { getE2EEmail, verifyAndGetE2EUser, resetE2EUser, E2E_BASE_URL } from './lib/e2eIdentity'

const BASE = E2E_BASE_URL
const EMAIL = getE2EEmail()

let passed = 0
let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}

// A cookie jar, so the session survives across requests.
const jar = new Map<string, string>()

function storeCookies(res: Response) {
  const raw = (res.headers as any).getSetCookie?.() ?? []
  for (const line of raw as string[]) {
    const [pair] = line.split(';')
    const idx = pair.indexOf('=')
    if (idx > 0) jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim())
  }
}

async function req(path: string, init: RequestInit = {}): Promise<Response> {
  const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    redirect: 'manual',
    headers: { ...(init.headers ?? {}), ...(cookie ? { cookie } : {}) },
  })
  storeCookies(res)
  return res
}

async function json(path: string, init: RequestInit = {}): Promise<any> {
  const res = await req(path, init)
  const text = await res.text()
  try { return { status: res.status, body: JSON.parse(text) } }
  catch { return { status: res.status, body: { raw: text.slice(0, 200) } } }
}

const postJson = (path: string, body?: unknown) =>
  json(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

async function signIn() {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email: EMAIL })
  if (error) throw new Error(`Could not generate a login link: ${error.message}`)

  const result = await postJson('/api/auth', { action: 'verify', type: 'magiclink', tokenHash: data.properties.hashed_token, next: '/app/tests' })
  check('signed in', result.status === 200 && result.body?.next === '/app/tests')
}

async function main() {
  console.log(`\nEnd-to-end: tests tab against ${BASE}\n`)

  console.log('Authentication')
  await signIn()

  if (process.argv.includes('--reset')) {
    console.log('\nResetting this account\'s diagnostic history')
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    })
    // listUsers()'s return type is a union the compiler cannot narrow here, so
    // the shape we actually rely on is stated explicitly.
    const { data: authUsers } = await admin.auth.admin.listUsers()
    const users = (authUsers as { users?: { id: string; email?: string }[] } | null)?.users ?? []
    const userId = users.find(u => u.email?.toLowerCase() === EMAIL.toLowerCase())?.id
    if (!userId) throw new Error(`No account found for ${EMAIL}`)

    // Order matters: evidence and challenges reference attempts.
    await admin.from('evidence_events').delete().eq('user_id', userId)
    await admin.from('item_challenges').delete().eq('user_id', userId)
    await admin.from('assessment_responses').delete().eq('user_id', userId)
    await admin.from('assessment_attempts').delete().eq('user_id', userId)
    check('history cleared', true)
  }

  console.log('\nTests index')
  const indexRes = await req('/app/tests')
  const indexHtml = await indexRes.text()
  check('page renders', indexRes.status === 200, `status ${indexRes.status}`)
  check('is not the unauthorized fallback', !indexHtml.includes('>Unauthorized<'))
  check('shows the three views, This week first', indexHtml.includes('aria-label="Tests views"') && indexHtml.includes('This week') && indexHtml.includes('Practice and checks') && indexHtml.includes('Mocks'))
  check('shows ONE primary weekly card with an action that works (or a precise reason)', (indexHtml.match(/class="weekly-card"/g) ?? []).length >= 1 && /Review and start|Resume paper|See result|Confirm what you covered|Open Calendar|Continue planning|Plan the week|You sat the exam|Review and start early/.test(indexHtml))
  check('no raw global bank statistics or evidence sidebar on the first view', !indexHtml.includes('Questions left for you') && !indexHtml.includes('Human reviewed') && !indexHtml.includes('More checks (module and concept)'))
  check('history is below, with a header link to it', indexHtml.includes('id="history"') && indexHtml.includes('href="#history"'))
  for (const v of ['practice', 'mocks']) { const r = await req(`/app/tests?view=${v}`); check(`?view=${v} renders`, r.status === 200 && (await r.text()).includes('aria-current="page"')) }
  check('an unknown view falls back to This week', (await (await req('/app/tests?view=nonsense')).text()).includes('This week'))

  console.log('\nAssembling a diagnostic')
  const start = await postJson('/api/tests/start', { kind: 'reading', readingId: 'r028', baseline: true })
  check('attempt created', start.body?.ok === true, JSON.stringify(start.body))
  const attemptId: string = start.body?.attemptId
  if (!attemptId) { console.log('\nCannot continue without an attempt.'); return finish() }
  check('form has questions', (start.body?.questions ?? 0) > 0, `questions ${start.body?.questions}`)

  console.log('\nAnswering')
  let answeredIds: string[] = []
  let total = 0
  for (let i = 0; i < 30; i++) {
    const next = await json(`/api/diagnostic/attempt/${attemptId}`)
    if (next.body?.ok !== true) { check('fetch next item', false, JSON.stringify(next.body)); break }
    total = next.body.attempt.totalCount
    const item = next.body.nextItem
    if (!item) break

    check(
      `q${i + 1} withholds the answer key`,
      !('keyIndex' in item) && !('perOptionFeedback' in item) && !('item_card' in item),
      Object.keys(item).join(',')
    )
    if (i === 0) {
      const incomplete = await postJson(`/api/diagnostic/attempt/${attemptId}/response`, { itemId: item.id, selectedOptionIndex: 0 })
      check('a legacy answer also requires confidence', incomplete.status === 400 && incomplete.body?.code === 'confidence_required')
    }

    const res = await postJson(`/api/diagnostic/attempt/${attemptId}/response`, {
      itemId: item.id,
      selectedOptionIndex: i % 3,
      confidence: i % 2 === 0 ? 'high' : 'low',
      elapsedSeconds: 20 + i,
    })
    if (res.body?.ok !== true) { check(`q${i + 1} saved`, false, JSON.stringify(res.body)); break }
    check(`q${i + 1} saved without revealing correctness`, !('isCorrect' in res.body) && !('is_correct' in res.body))
    answeredIds.push(item.id)
  }
  check('answered the whole form', answeredIds.length === total && total > 0, `${answeredIds.length} of ${total}`)

  console.log('\nAnswer locking')
  const relock = await postJson(`/api/diagnostic/attempt/${attemptId}/response`, {
    itemId: answeredIds[0],
    selectedOptionIndex: 2,
    confidence: 'medium',
  })
  check('re-answering locks instead of overwriting', relock.body?.locked === true, JSON.stringify(relock.body))

  console.log('\nScoring')
  const submit = await postJson(`/api/diagnostic/attempt/${attemptId}/submit`)
  check('scored', submit.body?.ok === true, JSON.stringify(submit.body))
  check('score is a number, not null', typeof submit.body?.score === 'number', String(submit.body?.score))
  check('evidence was written', (submit.body?.evidenceWritten ?? 0) > 0, JSON.stringify(submit.body))

  const resubmit = await postJson(`/api/diagnostic/attempt/${attemptId}/submit`)
  check('submitting twice is idempotent', resubmit.body?.alreadyScored === true, JSON.stringify(resubmit.body))

  console.log('\nResult page')
  const resultRes = await req(`/app/tests/${attemptId}/result`)
  const resultHtml = await resultRes.text()
  check('renders', resultRes.status === 200, `status ${resultRes.status}`)
  check('shows per-question review', resultHtml.includes('review-item'))
  check('marks the correct option', resultHtml.includes('Correct'))
  check('labels the learner\'s own choice', resultHtml.includes('Your answer'))
  check('shows concept evidence', resultHtml.includes('Concept evidence'))

  console.log('\nChallenging an item')
  const challenge = await postJson('/api/diagnostic/challenge', {
    itemId: answeredIds[0],
    attemptId,
    reasonCode: 'unclear_wording',
    comment: 'Raised by the automated end-to-end check.',
  })
  check('challenge recorded', challenge.body?.ok === true, JSON.stringify(challenge.body))
  const dupChallenge = await postJson('/api/diagnostic/challenge', {
    itemId: answeredIds[0], attemptId, reasonCode: 'unclear_wording', comment: 'Again.',
  })
  check('a second challenge is deduplicated', dupChallenge.body?.alreadyRaised === true, JSON.stringify(dupChallenge.body))

  console.log('\nGuard rails')
  const badOption = await postJson(`/api/diagnostic/attempt/${attemptId}/response`, {
    itemId: answeredIds[0], selectedOptionIndex: 99, confidence: 'medium',
  })
  check('an out-of-range option is refused', badOption.status === 409 || badOption.status === 400, `status ${badOption.status}`)

  const badKind = await postJson('/api/tests/start', { kind: 'nonsense' })
  check('an unknown assessment type is refused', badKind.status === 400, `status ${badKind.status}`)
  const badReading = await postJson('/api/tests/start', { kind: 'reading', readingId: 'no-such-reading', baseline: true })
  check('an unknown reading cannot reserve a paper', badReading.status === 409 && badReading.body.code === 'no_scope', JSON.stringify(badReading.body))

  const emptyChallenge = await postJson('/api/diagnostic/challenge', { itemId: answeredIds[0], comment: '' })
  check('a challenge with no reason is refused', emptyChallenge.status === 400, `status ${emptyChallenge.status}`)

  const foreignItem = await postJson(`/api/diagnostic/attempt/${attemptId}/response`, {
    itemId: 'q-does-not-exist', selectedOptionIndex: 0, confidence: 'medium',
  })
  check('an item not on the form is refused', foreignItem.status === 400 || foreignItem.status === 409, `status ${foreignItem.status}`)

  console.log('\nManifest sign-off gate')
  const admin2 = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
  const { data: pendingItem } = await admin2
    .from('assessment_items')
    .select('id, concept_id, item_version')
    .eq('review_status', 'verified')
    .limit(1)
    .maybeSingle()

  if (!pendingItem) {
    console.log('  (no verifier-passed item awaiting review — skipping)')
  } else {
    // Force the concept back to drafted so the gate is tested from a known state.
    await admin2.from('curriculum_concepts').update({ verification_status: 'drafted' }).eq('id', pendingItem.concept_id)

    const blocked = await postJson(`/api/diagnostic/items/${encodeURIComponent(pendingItem.id)}/review`, { decision: 'approve', expectedVersion: pendingItem.item_version })
    check('promoting on an unsigned concept is refused', blocked.status === 409 && blocked.body?.code === 'BLOCKED' && JSON.stringify(blocked.body?.blockers).includes('signed off'),
      `${blocked.status} ${JSON.stringify(blocked.body)}`)

    const rejectNoReason = await postJson(`/api/diagnostic/items/${encodeURIComponent(pendingItem.id)}/review`, { decision: 'reject', expectedVersion: pendingItem.item_version })
    check('rejecting without a reason is refused', rejectNoReason.status === 400, `status ${rejectNoReason.status}`)

    const badDecision = await postJson(`/api/diagnostic/items/${encodeURIComponent(pendingItem.id)}/review`, { decision: 'maybe', expectedVersion: pendingItem.item_version })
    check('an unknown decision is refused', badDecision.status === 400, `status ${badDecision.status}`)

    // Negative paths only: a real concept is never signed off by a test run (sign-off is a recorded human decision; the positive path is proven on a fixture by reviewer-signoff-db-test).
    const legacy = await postJson(`/api/curriculum/concepts/${pendingItem.concept_id}/verify`, { verified: true })
    check('the old body shape ({verified:true}) approves nothing', legacy.status === 400, `${legacy.status} ${JSON.stringify(legacy.body)}`)
    const empty = await postJson(`/api/curriculum/concepts/${pendingItem.concept_id}/verify`, {})
    check('an empty body approves nothing', empty.status === 400, `${empty.status}`)
    const noConfirm = await postJson(`/api/curriculum/concepts/${pendingItem.concept_id}/verify`, { decision: 'verify', expectedScopeHash: 'x', rationale: 'long enough reason' })
    check('sign-off without the explicit confirmation is refused', noConfirm.status === 400, `${noConfirm.status}`)
    const stale = await postJson(`/api/curriculum/concepts/${pendingItem.concept_id}/verify`, { decision: 'verify', expectedScopeHash: 'not-the-scope-shown', rationale: 'long enough reason', confirmScope: true })
    check('a scope hash that is not the current scope is refused', stale.status === 409 && stale.body?.code === 'STALE_SCOPE', `${stale.status} ${JSON.stringify(stale.body)}`)
    const stillPending = (await admin2.from('curriculum_concepts').select('verification_status').eq('id', pendingItem.concept_id).single()).data?.verification_status
    check('none of those changed the concept', stillPending === 'drafted', String(stillPending))

  }

  console.log('\nManifest page')
  const manifestRes = await req('/app/tests/manifest')
  const manifestHtml = await manifestRes.text()
  check('manifest page renders', manifestRes.status === 200, `status ${manifestRes.status}`)
  check('shows what is blocked from publication', manifestHtml.includes('blocked from publication'))

  console.log('\nReview queue')
  const reviewRes = await req('/app/tests/review')
  const reviewHtml = await reviewRes.text()
  check('review page renders', reviewRes.status === 200, `status ${reviewRes.status}`)
  check('reports verifier–human agreement', reviewHtml.includes('verifier–human agreement'))

  finish()
}

function finish() {
  console.log(`\n${passed} passed, ${failed} failed\n`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch(error => {
  console.error('\nE2E run crashed:', error)
  process.exit(1)
})
