import Link from 'next/link'
import type { AppointmentSummary } from '../../lib/planning/checkpointService'

const STATUS: Record<AppointmentSummary['status'], string> = {
  planned: 'Booked', completed: 'Taken', cancelled: 'Cancelled', postponed: 'Postponed', missed: 'Not taken',
}

/** The mocks and checkpoints that belonged to a past week, as recorded: status, designation and where the debrief or record lives. Read only. */
export function PeriodAppointments({ appointments }: { appointments: AppointmentSummary[] }) {
  if (appointments.length === 0) return null
  return (
    <section className="note" aria-labelledby="period-appts-h" data-period-appointments>
      <h2 id="period-appts-h">Mocks and checkpoints that week</h2>
      <ul>
        {appointments.map(a => (
          <li key={a.id}>
            <Link href={a.href}>{a.title}</Link> · {STATUS[a.status]}{a.startTime ? ` · ${a.startTime}` : ''}
            {a.designated ? ' · counted as that week’s assessment' : ''}
            {a.report && <span data-testid="mock-report"> · you recorded {a.report.reportedResult ? `“${a.report.reportedResult}”` : 'no score'}{a.report.notes ? `; your notes: ${a.report.notes}` : ''} <small>(your own report, not test evidence)</small></span>}
            {a.rehearsal?.primary && <> · <Link href={a.rehearsal.primary.href}>{a.rehearsal.primary.label}</Link></>}
          </li>
        ))}
      </ul>
    </section>
  )
}
