import Link from 'next/link'

/** The reviewer workspace's own navigation. Rendered only by reviewer-guarded pages; students never receive it. */
const LINKS = [
  { key: 'queue', href: '/app/tests/review', label: 'Queue' },
  { key: 'batches', href: '/app/tests/review/batches', label: 'Batches' },
  { key: 'challenges', href: '/app/tests/review/challenges', label: 'Student challenges' },
  { key: 'preview', href: '/app/tests/review/preview', label: 'Preview a paper' },
  { key: 'manifest', href: '/app/tests/manifest', label: 'Curriculum sign-off' },
] as const

export function ReviewNav({ current }: { current: (typeof LINKS)[number]['key'] | 'item' }) {
  return (
    <nav className="rv-nav" aria-label="Reviewer workspace">
      {LINKS.map(l => <Link key={l.key} href={l.href} className={l.key === current ? 'text-button is-current' : 'text-button'} aria-current={l.key === current ? 'page' : undefined}>{l.label}</Link>)}
      <Link href="/app/tests" className="text-button">&larr; Diagnostics</Link>
    </nav>
  )
}
