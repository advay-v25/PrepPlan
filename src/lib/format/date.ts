const FORMATS = {
  short: { weekday: 'short', day: 'numeric', month: 'short' },
  long: { weekday: 'long', day: 'numeric', month: 'long' },
  dayMonth: { day: 'numeric', month: 'short' },
  dayMonthLong: { day: 'numeric', month: 'long' },
  date: { day: 'numeric', month: 'short', year: 'numeric' },
  fullDate: { day: 'numeric', month: 'long', year: 'numeric' },
} satisfies Record<string, Intl.DateTimeFormatOptions>

export function preferredDateLocale(acceptLanguage: string | null) {
  const choices = (acceptLanguage ?? '').slice(0, 512).split(',').map(entry => {
    const [locale, quality] = entry.trim().split(';')
    return { locale, weight: quality ? Number(quality.trim().replace(/^q=/i, '')) : 1 }
  }).filter(({ locale, weight }) => /^[a-z]{2,3}(?:-[a-z\d]{2,8})*$/i.test(locale) && weight > 0 && weight <= 1)
  for (const { locale } of choices.sort((a, b) => b.weight - a.weight)) {
    try { if (Intl.DateTimeFormat.supportedLocalesOf(locale).length) return locale } catch { /* Try the next valid preference. */ }
  }
  return 'en-GB'
}

/** Formats a calendar date without changing which day it represents. */
export function formatStudyDate(date: string, style: keyof typeof FORMATS = 'short', locale = 'en-GB') {
  return new Intl.DateTimeFormat(locale, { ...FORMATS[style], timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`))
}

/** A clock label for minutes from local midnight. The end of the day wraps to 12am. */
export function clockTime(minutes: number, withSuffix = true) {
  const h = Math.floor(minutes / 60) % 24
  const m = minutes % 60
  const hour12 = h % 12 || 12
  const time = m === 0 ? `${hour12}` : `${hour12}:${String(m).padStart(2, '0')}`
  return withSuffix ? `${time}${h < 12 ? 'am' : 'pm'}` : time
}

export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const utc = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(utc.getTime()) && utc.toISOString().slice(0, 10) === value
}
