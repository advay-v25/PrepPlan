import { redirect } from 'next/navigation'

/**
 * /app/week is superseded by /app/calendar.
 *
 * Kept as a redirect rather than deleted so existing links, bookmarks, and any
 * saved navigation keep working. The previous implementation is preserved at
 * scripts/legacy/week-page.tsx.bak.
 */
export default async function WeekPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const target = new URLSearchParams()
  if (typeof params.week === 'string') target.set('week', params.week)
  const query = target.toString()
  redirect(query ? `/app/calendar?${query}` : '/app/calendar')
}
