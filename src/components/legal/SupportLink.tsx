import { SUPPORT_EMAIL, supportHref } from '../../lib/support'

/** A mailto link when the support address is configured; otherwise an honest note (never a dead address). */
export function SupportLink({ subject = 'PrepPlan support' }: { subject?: string }) {
  const href = supportHref(subject)
  return href ? <a href={href}>{SUPPORT_EMAIL}</a> : <span>the support address the person who invited you gave you</span>
}
