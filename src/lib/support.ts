/** The beta support / privacy contact. Set NEXT_PUBLIC_SUPPORT_EMAIL before inviting students. */
export const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? ''
export const supportHref = (subject: string) => (SUPPORT_EMAIL ? `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}` : null)
