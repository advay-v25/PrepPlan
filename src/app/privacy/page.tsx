import Link from 'next/link'

export default function PrivacyPage() {
  return <main className="legal-page"><Link href="/signup" className="auth-brand"><span className="auth-brand-mark">//</span> Roadmap</Link><article><h1>Privacy overview</h1><p><strong>MVP notice:</strong> This is a product prototype, not the final privacy policy.</p><h2>What Roadmap stores</h2><p>Account details, exam target, study constraints, class schedule, curriculum progress, diagnostic responses, confidence and plan activity.</p><h2>How planning data is used</h2><p>Roadmap uses your activity and assessment evidence to update study plans, surface weak areas and propose calendar changes. Account-scoped data is not used to expose another candidate&apos;s history.</p><h2>Your control</h2><p>Production launch should include export, deletion, retention controls and a named privacy contact before accepting real candidates.</p></article></main>
}
