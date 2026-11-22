'use client'

import { forwardRef } from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'

/**
 * The app's button, in one place.
 *
 * Replaces 23 hand-written `primary-button`, 22 `secondary-button`, 13
 * `text-button` and 9 `icon-button` usages, plus the `busy ? <Loader2/> : label`
 * pattern rewritten at every submit site.
 *
 * `tone` is orthogonal to `variant` because `.is-danger` already existed on both
 * `.secondary-button` and `.text-button` — danger is a colour, not a fifth kind
 * of button.
 */

type Variant = 'primary' | 'secondary' | 'text'
type Tone = 'default' | 'danger'
type Size = 'sm' | 'md' | 'lg'

type CommonProps = {
  variant?: Variant
  tone?: Tone
  size?: Size
  loading?: boolean
  fullWidth?: boolean
  children?: React.ReactNode
  className?: string
}

function classesFor({ variant = 'primary', tone = 'default', size = 'md', fullWidth, className }: CommonProps) {
  const base = variant === 'primary' ? 'primary-button'
    : variant === 'secondary' ? 'secondary-button'
    : 'text-button'
  return [
    base,
    tone === 'danger' ? 'is-danger' : '',
    size !== 'md' ? `is-${size}` : '',
    fullWidth ? 'is-full' : '',
    className ?? '',
  ].filter(Boolean).join(' ')
}

export type ButtonProps = CommonProps &
  Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'className'>

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, tone, size, loading, fullWidth, className, children, disabled, type = 'button', ...rest }, ref
) {
  return (
    <button
      ref={ref}
      type={type}
      className={classesFor({ variant, tone, size, fullWidth, className })}
      // Disabled while loading so a double submit is impossible, and announced
      // so a screen reader knows the control is working rather than broken.
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <Loader2 size={16} className="animate-spin" aria-hidden />}
      {children}
    </button>
  )
})

export type ButtonLinkProps = CommonProps &
  Omit<React.ComponentProps<typeof Link>, 'className'>

/** The same button, when it navigates. Used in at least six places today. */
export function ButtonLink({ variant, tone, size, fullWidth, className, children, ...rest }: ButtonLinkProps) {
  return (
    <Link className={classesFor({ variant, tone, size, fullWidth, className })} {...rest}>
      {children}
    </Link>
  )
}

export type IconButtonProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'className'> & {
  /** Required: an icon-only control with no accessible name is unusable. */
  label: string
  className?: string
}

/**
 * Icon-only control.
 *
 * `label` is required at the type level rather than by convention, and the CSS
 * gives it a 44px hit target — `.icon-button` previously declared no dimensions
 * at all, so every icon control was as small as its glyph.
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, className, children, ...rest }, ref
) {
  return (
    <button type="button" ref={ref} className={`icon-button ${className ?? ''}`.trim()} aria-label={label} {...rest}>
      {children}
    </button>
  )
})
