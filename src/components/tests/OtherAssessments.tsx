import type { OtherAssessments as Data } from '../../lib/tests/testsOverview'
import { StartButton, BaselineStart } from './StartButton'

type Catalog = { id: string; name: string; readings: { id: string; no: number; title: string }[] }[]

/** Reading, Subject, Repair and Mock assessments, each with its eligibility and limit stated. */
export function OtherAssessments({ data, catalog }: { data: Data; catalog: Catalog }) {
  return (
    <section className="other-assessments" aria-labelledby="other-h">
      <h2 id="other-h">Other checks</h2>
      <p className="muted">These respect what you have completed. None exceeds 90 questions.</p>

      <div className="other-assessments__grid">
        <article>
          <h3>Reading diagnostic</h3>
          <p>Tests the completed part of one reading.</p>
          {data.readings.length === 0 ? <p className="muted">Nothing is completed yet.</p> : (
            <ul>{data.readings.map(r => <li key={r.id}>{r.name} <small>({r.outcomes} outcome{r.outcomes === 1 ? '' : 's'})</small> <StartButton className="secondary-button" label="Start" body={{ kind: 'reading', readingId: r.id }} /></li>)}</ul>
          )}
        </article>

        <article>
          <h3>Subject diagnostic</h3>
          <p>Samples broadly across the completed scope of one subject.</p>
          {data.subjects.length === 0 ? <p className="muted">Nothing is completed yet.</p> : (
            <ul>{data.subjects.map(s => <li key={s.id}>{s.name} <small>({s.outcomes} outcomes)</small> <StartButton className="secondary-button" label="Start" body={{ kind: 'subject', subjectId: s.id }} /></li>)}</ul>
          )}
        </article>

        <article>
          <h3>Repair re-check</h3>
          <p>Independent, unseen questions on outcomes you previously missed.</p>
          {data.repair.count === 0 ? <p className="muted">You have no open repair work.</p> : (
            <><p>{data.repair.count} outcome{data.repair.count === 1 ? '' : 's'} to re-check.</p><StartButton className="secondary-button" label="Start re-check" body={{ kind: 'repair' }} /></>
          )}
        </article>

        <article>
          <h3>Mock session</h3>
          <p>{data.mock.questions} questions in {data.mock.minutes} minutes, timed exam-style with a strict clock (no pause).</p>
          <p className={data.mock.eligible ? '' : 'muted'}>{data.mock.eligible ? 'Ready.' : `Not available yet: the bank has ${data.mock.unseenApproved} unseen approved questions and ${data.mock.needed} are needed for a full mock.`}</p>
          <StartButton className="secondary-button" label="Start mock" disabled={!data.mock.eligible} body={{ kind: 'mock' }} />
        </article>
      </div>

      <BaselineStart subjects={catalog} />
    </section>
  )
}
