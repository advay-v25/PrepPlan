/**
 * Test fixture: prepare an owned student's first-week draft as of an earlier instant, through the real generator. Local stack only.
 *   npx tsx scripts/prepare-draft.ts <userId> <minutesAgo>     prints {"draftId","revision"}
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
if (process.env.LOCAL_STACK !== '1' || !/^http:\/\/127\.0\.0\.1:\d+$/.test(new URL(url).origin)) throw new Error('Local stack only.')
const [userId, minutesAgo] = process.argv.slice(2)
async function main() {
  const { generatePreview } = await import('../src/lib/onboarding/previewService')
  const { draftId, revision } = await generatePreview(userId, { now: new Date(Date.now() - Number(minutesAgo) * 60_000) })
  console.log(JSON.stringify({ draftId, revision }))
}
main().catch(e => { console.error(e); process.exit(1) })
