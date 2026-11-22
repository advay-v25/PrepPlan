export function safeNextPath(value: string | null, fallback = '/app') {
  if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(value)) return fallback
  try {
    const parsed = new URL(value, 'https://roadmap.local')
    return parsed.origin === 'https://roadmap.local' && !parsed.pathname.startsWith('//') ? `${parsed.pathname}${parsed.search}${parsed.hash}` : fallback
  } catch { return fallback }
}

export function authDestination(value: string | null, fallback = '/app') {
  const next = safeNextPath(value, fallback)
  return /^\/(?:app|onboarding|account)(?:[/?#]|$)/.test(next) ? next : fallback
}
