import Link from 'next/link'
import { SupportLink } from '../../components/legal/SupportLink'

export const metadata = { title: 'Privacy' }

/** DRAFT for the private beta. Written from how the product actually handles data; the owner must review it (release checklist) before the cohort opens. */
export default function PrivacyPage() {
  return (
    <main className="legal-page">
      <Link href="/signup" className="auth-brand"><span className="brand-mark" aria-hidden="true" /> PrepPlan</Link>
      <article>
        <h1>Privacy — private beta</h1>
        <p><strong>Draft for the private beta.</strong> It describes what PrepPlan does today and will change as the product does. Contact: <SupportLink subject="PrepPlan privacy" />.</p>

        <h2>What we keep</h2>
        <ul>
          <li><strong>Account:</strong> your email address and, if you give one, your name; how you sign in (email link or password, or Google if you choose it).</li>
          <li><strong>Your setup:</strong> exam date and timezone, how you are preparing, your classes and commitments, the study windows you set, and what you tell us you have already covered.</li>
          <li><strong>Your plan and activity:</strong> the weeks and tasks you accept, what you mark done, skipped or moved, learning you log, notes, and mock dates and outcomes you record (your own words).</li>
          <li><strong>Assessments:</strong> your answers, how sure you said you were, timing, scores, challenges you raise, and the repair and revision work that follows.</li>
          <li><strong>Coach:</strong> your messages and the replies. Coach is not a tutor and gives no medical, legal or investment advice.</li>
          <li><strong>Reminders:</strong> only if you turn them on: your choices, quiet hours and the reminders sent.</li>
        </ul>
        <p>We do not ask for payment details (payments are off in the beta) and we do not sell your data.</p>

        <h2>Who processes it</h2>
        <ul>
          <li><strong>Supabase</strong> hosts the database and sign-in. Your data is stored there, protected so each student can read only their own rows.</li>
          <li><strong>An email provider</strong> sends sign-in, verification, password-reset and (if you opt in) reminder emails. It sees your address and the message.</li>
          <li><strong>An AI model provider</strong> may be used to word Coach replies. It receives your message and a short summary of your plan state (task and reading names, counts), not your email address or name. A built-in answer is used if the model is unavailable.</li>
        </ul>

        <h2>Your controls</h2>
        <ul>
          <li><strong>Export:</strong> Settings → “Download my data” gives you a file with your setup, plan, activity and assessment records.</li>
          <li><strong>Delete:</strong> Settings → “Delete Account” removes your account and the study data above, including pending reminders. You confirm with your email address and a recent sign-in.</li>
          <li><strong>Reminders:</strong> off unless you turn them on; you can turn them off at any time.</li>
        </ul>

        <h2>What stays after deletion</h2>
        <ul>
          <li>A one-way record that a deletion happened (a hash and a time, never who).</li>
          <li>Backups kept by the database provider, which age out on the provider&rsquo;s schedule; we do not restore a deleted account from them.</li>
          <li>Reviewer decisions about question content are PrepPlan content, not student data.</li>
        </ul>

        <h2>Retention</h2>
        <p>Your data is kept while your account exists. When the beta ends we will tell you before anything is removed, and you can export or delete first.</p>

        <h2>Questions or requests</h2>
        <p>Write to <SupportLink subject="PrepPlan privacy" />. See also the <Link href="/terms">terms of use</Link>.</p>
      </article>
    </main>
  )
}
