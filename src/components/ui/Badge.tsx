/**
 * A small-caps, letter-spaced status chip — phase names, test states, repair
 * flags. One component so a given tone always looks the same wherever it
 * appears, replacing the ad-hoc <span> status labels scattered across Tests,
 * Curriculum and Calendar.
 */

export type BadgeTone = 'accent' | 'gold' | 'success' | 'warning' | 'danger' | 'neutral'

export type BadgeProps = {
  tone?: BadgeTone
  children: React.ReactNode
  className?: string
}

export function Badge({ tone = 'neutral', children, className }: BadgeProps) {
  return (
    <span className={['ui-badge', `ui-badge--${tone}`, className ?? ''].filter(Boolean).join(' ')}>
      {children}
    </span>
  )
}
