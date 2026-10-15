import Link from 'next/link'

export default function TermsPage() {
  return <main className="legal-page"><Link href="/signup" className="auth-brand"><span className="auth-brand-mark">//</span> Roadmap</Link><article><h1>Terms of use</h1><p><strong>MVP notice:</strong> This is a product prototype, not the final legal agreement.</p><h2>Purpose</h2><p>Roadmap supports study planning, practice and evidence tracking. It is not affiliated with or endorsed by CFA Institute and does not guarantee exam results.</p><h2>Practice content</h2><p>Roadmap creates original practice items to assess planning signals and understanding. It does not reproduce or distribute third-party curriculum text, and its outputs should be checked against the current official curriculum.</p><h2>Academic integrity</h2><p>Do not enter confidential live-exam content. Use the product for legitimate preparation and respect CFA Institute&apos;s candidate rules.</p></article></main>
}
