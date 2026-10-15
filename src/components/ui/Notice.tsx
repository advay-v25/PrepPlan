import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react'

const ICONS = { info: Info, warn: AlertTriangle, danger: XCircle, success: CheckCircle2 }

/**
 * An inline message.
 *
 * `role` defaults to nothing: a notice rendered with the page is not an alert,
 * and announcing it as one is noise. Pass `role="alert"` only when it appears in
 * response to something the user just did.
 */
export function Notice({
  tone = 'info', role, icon = true, children, className,
}: {
  tone?: 'info' | 'warn' | 'danger' | 'success'
  role?: 'status' | 'alert'
  icon?: boolean
  children: React.ReactNode
  className?: string
}) {
  const Icon = ICONS[tone]
  return (
    <div className={`ui-notice ui-notice--${tone} ${className ?? ''}`.trim()} role={role}>
      {icon && <Icon size={16} aria-hidden />}
      <div>{children}</div>
    </div>
  )
}
