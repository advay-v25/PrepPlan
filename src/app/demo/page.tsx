import Link from 'next/link'
import { StudyWalkthrough } from '../../components/landing/StudyWalkthrough'

export const metadata = { title: 'Planner walkthrough' }

export default function DemoPage() {
  return (
    <main className="page-content demo-page" style={{ width: '100%', maxWidth: 760, marginInline: 'auto' }}>
      <nav className="crumbs" aria-label="Breadcrumb"><Link href="/">PrepPlan</Link> / Walkthrough</nav>
      <h1>Try a study week</h1>
      <p className="muted">A fictional candidate, one example week.</p>
      <StudyWalkthrough />
    </main>
  )
}
