import { forwardRef } from 'react'

/**
 * One card, replacing six independent declarations whose padding varied
 * 16/18/20/22/24/28px (`.log-card`, `.dashboard-hero-card`, `.source-card`,
 * `.review-queue__card`, `.purpose-card`, `.verdict`).
 *
 * `accent` covers the 3px left-border pattern that recurs across the calendar,
 * curriculum and diagnostics surfaces; it takes a product token
 * (`--layer-repair`, `--phase-final`) rather than a raw colour, so a repair
 * block looks like a repair block wherever it appears.
 */

export type CardProps = {
  padding?: 'tight' | 'default' | 'loose'
  tone?: 'default' | 'info' | 'warn' | 'danger' | 'success'
  /** A CSS custom property name, e.g. '--layer-repair'. */
  accent?: string
  interactive?: boolean
  as?: 'div' | 'section' | 'article' | 'li'
  className?: string
  children: React.ReactNode
} & Omit<React.HTMLAttributes<HTMLElement>, 'className'>

export const Card = forwardRef<HTMLElement, CardProps>(function Card(
  { padding = 'default', tone = 'default', accent, interactive, as: Tag = 'div', className, children, style, ...rest }, ref
) {
  const classes = [
    'ui-card',
    padding !== 'default' ? `ui-card--${padding}` : '',
    tone !== 'default' ? `ui-card--${tone}` : '',
    accent ? 'ui-card--accented' : '',
    interactive ? 'ui-card--interactive' : '',
    className ?? '',
  ].filter(Boolean).join(' ')

  return (
    <Tag
      ref={ref as never}
      className={classes}
      style={accent ? { ...style, ['--card-accent-line' as string]: `var(${accent})` } : style}
      {...rest}
    >
      {children}
    </Tag>
  )
})
