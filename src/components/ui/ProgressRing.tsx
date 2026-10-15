/**
 * A circular progress indicator, for the one number a hero card exists to show.
 *
 * Pure SVG rather than a chart library — this is one ring, not a data
 * visualisation surface, and it needs to render identically inside a dark
 * glass hero and a plain white card without pulling in a dependency.
 */
export function ProgressRing({
  percent, label, size = 64, stroke = 5, tone = 'light',
}: {
  percent: number
  label?: string
  size?: number
  stroke?: number
  tone?: 'light' | 'dark'
}) {
  const clamped = Math.max(0, Math.min(100, percent))
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - clamped / 100)
  const trackColor = tone === 'light' ? 'rgba(251,247,240,.22)' : 'var(--line)'
  const valueColor = tone === 'light' ? '#FBF7F0' : 'var(--accent)'
  const textColor = tone === 'light' ? '#FBF7F0' : 'var(--ink)'
  const labelColor = tone === 'light' ? 'rgba(251,247,240,.65)' : 'var(--muted)'

  return (
    <div
      role="img"
      aria-label={`${label ? `${label}: ` : ''}${clamped}% complete`}
      style={{ position: 'relative', width: size, height: size, flex: `0 0 ${size}px` }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={trackColor} strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={radius} fill="none"
          stroke={valueColor} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div
        aria-hidden
        style={{
          position: 'absolute', inset: 0, display: 'grid', placeItems: 'center',
          textAlign: 'center', lineHeight: 1.1,
        }}
      >
        <span>
          <strong style={{ display: 'block', fontSize: size >= 56 ? 16 : 13, fontWeight: 800, color: textColor }}>
            {clamped}%
          </strong>
          {label && size >= 56 && (
            <small style={{ display: 'block', fontSize: 9, fontWeight: 600, color: labelColor, textTransform: 'uppercase', letterSpacing: '.03em' }}>
              {label}
            </small>
          )}
        </span>
      </div>
    </div>
  )
}
