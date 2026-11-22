export const MIN_PASSWORD_LENGTH = 12
export const MAX_PASSWORD_BYTES = 72

export function passwordRule(password: string) {
  if (Array.from(password).length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`
  if (new TextEncoder().encode(password).length > MAX_PASSWORD_BYTES) return 'This password is too long. Choose a shorter passphrase.'
  return null
}

export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ''
export const GOOGLE_SIGN_IN_ENABLED = process.env.NEXT_PUBLIC_GOOGLE_SIGN_IN === '1'

export const VERIFICATION_TYPES = ['signup', 'magiclink', 'recovery'] as const
export type VerificationType = typeof VERIFICATION_TYPES[number]
