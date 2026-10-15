'use client'

import { useId } from 'react'

/**
 * A labelled form control.
 *
 * There were two incompatible input systems: `.modal-card input` at a fixed
 * 46px, and `.field input` at roughly 40px from padding. Same purpose, different
 * metrics, chosen by which container you happened to be inside.
 *
 * It also wires `aria-describedby` and `aria-invalid` automatically. Error text
 * was previously a loose paragraph with no programmatic link to the field it
 * described, at fifteen call sites.
 */
export function Field({
  label, hint, error, required, size = 'md', children, className,
}: {
  label: string
  hint?: string
  error?: string
  required?: boolean
  size?: 'md' | 'lg'
  /** Receives the props the control must spread onto itself. */
  children: (props: {
    id: string
    'aria-describedby'?: string
    'aria-invalid'?: boolean
    required?: boolean
  }) => React.ReactNode
  className?: string
}) {
  const id = useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const describedBy = [hint ? hintId : '', error ? errorId : ''].filter(Boolean).join(' ')

  return (
    <div className={`ui-field ${size === 'lg' ? 'ui-field--lg' : ''} ${error ? 'is-invalid' : ''} ${className ?? ''}`.trim()}>
      <label htmlFor={id}>
        {label}
        {required && <span aria-hidden className="ui-field__required"> *</span>}
      </label>
      {children({
        id,
        'aria-describedby': describedBy || undefined,
        'aria-invalid': error ? true : undefined,
        required,
      })}
      {hint && !error && <p id={hintId} className="ui-field__hint">{hint}</p>}
      {error && <p id={errorId} className="ui-field__error" role="alert">{error}</p>}
    </div>
  )
}
