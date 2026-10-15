export function ProgressBar({ value, tone = 'blue', label }: { value: number; tone?: 'blue' | 'green' | 'amber'; label?: string }) {
  return (
    <div className="progress-wrap" aria-label={label ?? `${value}% complete`}>
      <span className="progress-track"><span className={`progress-fill progress-fill--${tone}`} style={{ width: `${value}%` }} /></span>
    </div>
  )
}
