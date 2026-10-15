export function safeNextPath(value: string | null, fallback = '/app') {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return fallback
  try {
    const parsed = new URL(value, 'https://roadmap.local')
    return parsed.origin === 'https://roadmap.local' ? `${parsed.pathname}${parsed.search}${parsed.hash}` : fallback
  } catch { return fallback }
}
