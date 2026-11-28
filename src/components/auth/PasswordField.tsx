'use client'

import { useId, useState } from 'react'
import { Check, Eye, EyeOff } from 'lucide-react'
import { MIN_PASSWORD_LENGTH } from '../../lib/auth/authPolicy'

/** A password input with a show/hide toggle and, when choosing a new password, a meter that fills to the minimum length. */
export function PasswordField({
  label = 'Password', value, onChange, autoComplete = 'new-password', meter = true, rightLabel, autoFocus, maxLength = 72, match,
}: {
  label?: string; value: string; onChange: (v: string) => void; autoComplete?: string; meter?: boolean
  rightLabel?: React.ReactNode; autoFocus?: boolean; maxLength?: number
  /** When set, shows whether the value equals the other password. */
  match?: string
}) {
  const [show, setShow] = useState(false)
  const id = useId()
  const length = Array.from(value).length
  const filled = Math.min(4, Math.floor((length / MIN_PASSWORD_LENGTH) * 4))
  const ok = length >= MIN_PASSWORD_LENGTH
  return (
    <div className="su-field">
      <span className="su-fieldrow"><label htmlFor={id}>{label}</label>{rightLabel}</span>
      <span className="su-pass">
        <input id={id} type={show ? 'text' : 'password'} value={value} onChange={e => onChange(e.target.value)} autoComplete={autoComplete}
          required maxLength={maxLength} minLength={meter ? MIN_PASSWORD_LENGTH : undefined} autoFocus={autoFocus}
          aria-describedby={meter ? `${id}-meter` : undefined} />
        <button type="button" onClick={() => setShow(v => !v)} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}>
          {show ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </span>
      {meter ? (
        <span id={`${id}-meter`} className={`su-meter${ok ? ' is-ok' : ''}`}>
          <span className="su-meter__bars" aria-hidden>{[0, 1, 2, 3].map(i => <i key={i} className={i < filled || ok ? 'on' : ''} />)}</span>
          <span>{ok ? <><Check size={13} aria-hidden /> Long enough</> : `${MIN_PASSWORD_LENGTH}+ characters`}</span>
        </span>
      ) : null}
      {match !== undefined && value ? <span className={`su-meter${value === match ? ' is-ok' : ''}`} aria-live="polite">{value === match ? <><Check size={13} aria-hidden /> Passwords match</> : 'Passwords do not match yet'}</span> : null}
    </div>
  )
}
