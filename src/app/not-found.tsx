import Link from 'next/link'

export default function NotFound() {
  return <main className="standalone-page">
    <p className="eyebrow">PrepPlan</p>
    <h1>Page not found</h1>
    <p>This page is unavailable. Check the address or return to your workspace.</p>
    <Link className="primary-button" href="/app">Open PrepPlan</Link>
  </main>
}
