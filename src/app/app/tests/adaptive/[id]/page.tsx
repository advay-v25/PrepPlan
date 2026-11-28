import { notFound, redirect } from 'next/navigation'
import { createClient } from '../../../../../lib/supabase/server'
import { requireApplicationAccess } from '../../../../../lib/auth/applicationAccess'
import { loadAdaptiveItemRun } from '../../../../../lib/tests/adaptiveItemPractice'
import { AdaptiveItemRunner } from '../../../../../components/tests/AdaptiveItemRunner'

export const dynamic = 'force-dynamic'
const UUID = /^[0-9a-f-]{36}$/i

export default async function AdaptiveItemPage({ params }: { params: Promise<{ id: string }> }) {
  const access = await requireApplicationAccess(await createClient())
  if (!access.ok) redirect('/login')
  const { id } = await params
  if (!UUID.test(id)) notFound()
  const run = await loadAdaptiveItemRun(access.user.id, id)
  if (!run) notFound()
  return <AdaptiveItemRunner initialRun={run} />
}
