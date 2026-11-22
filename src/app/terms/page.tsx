import Link from 'next/link'
import { SupportLink } from '../../components/legal/SupportLink'

export const metadata = { title: 'Terms' }

/** DRAFT for the private beta; owner review is on the release checklist. */
export default function TermsPage() {
  return (
    <main className="legal-page">
      <Link href="/signup" className="auth-brand"><span className="brand-mark"><span /></span> Roadmap</Link>
      <article>
        <h1>Terms of use — private beta</h1>
        <p><strong>Draft for the private beta.</strong> By using Roadmap you agree to these terms. Contact: <SupportLink subject="Roadmap terms" />.</p>

        <h2>What Roadmap is</h2>
        <p>Roadmap helps you plan CFA Level I study, check what you have understood, and decide what to do next. It is not affiliated with or endorsed by CFA Institute, and it does not guarantee any exam result. An internal score is a study signal, never a prediction or a pass or fail.</p>

        <h2>The beta</h2>
        <ul>
          <li>Access is by invitation, tied to the email you were invited on. It may change or end, and features may be unavailable.</li>
          <li><strong>Practice questions are limited.</strong> Questions are used only after a human reviewer has approved them. If none are available for something (for example a full two-session rehearsal), Roadmap says so instead of offering a smaller version. You can still plan, study from your own materials and record mocks you take elsewhere.</li>
          <li>Roadmap does not teach chapters and does not reproduce provider or CFA Institute materials. Study from the materials you have the right to use.</li>
          <li>Payments are not enabled.</li>
        </ul>

        <h2>Your account</h2>
        <p>Keep your sign-in secure and use your own account. You can export your data and delete your account in Settings; see the <Link href="/privacy">privacy page</Link>.</p>

        <h2>Acceptable use</h2>
        <p>Do not attempt to access other people&rsquo;s data, disrupt the service, or copy question content out of Roadmap.</p>

        <h2>Feedback and challenges</h2>
        <p>If a question looks wrong, use “Challenge this question”. It is set aside from your evidence while it is reviewed.</p>

        <h2>Liability</h2>
        <p>Roadmap is provided as a beta, as is. Use your own judgement about your preparation; the study suggestions are not professional advice.</p>
      </article>
    </main>
  )
}
