import Link from 'next/link'
import { redirect } from 'next/navigation'
import { BarChart3, BookOpenCheck, CheckCircle2, ShieldCheck, Wrench } from 'lucide-react'
import { createClient } from '../lib/supabase/server'
import { Badge } from '../components/ui/Badge'
import { ButtonLink } from '../components/ui/Button'
import { ScrollReveal } from '../components/landing/ScrollReveal'
import { ScrollStagger } from '../components/landing/ScrollStagger'
import { ParallaxLayer } from '../components/landing/ParallaxLayer'
import { ReadinessDemo } from '../components/landing/ReadinessDemo'
import { WeekPreview } from '../components/landing/WeekPreview'
import { CountUpStat } from '../components/landing/CountUpStat'

export const metadata = { title: { absolute: 'CFA Level I study planner · Roadmap' } }

export const dynamic = 'force-dynamic'

const STEPS = [
  { icon: BookOpenCheck, title: 'Class or self-study', detail: 'Capture what was covered and what fits your real week.' },
  { icon: BarChart3, title: 'Diagnostic', detail: 'Measure application, missed detail and confidence calibration.' },
  { icon: Wrench, title: 'Repair', detail: 'Target the prerequisite or misconception causing the miss.' },
  { icon: ShieldCheck, title: 'Re-verify', detail: 'Confirm that the repair held before readiness moves.' },
] as const

/**
 * A signed-in visitor has nothing to see here — /app's own layout resolves
 * whether they land in onboarding or the workspace, so this route only needs
 * to hand them off.
 */
export default async function LandingPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) redirect('/app')

  return (
    <main className="landing-page">
      <header className="landing-header">
        <strong>Roadmap</strong>
        <Link href="/login">Sign in</Link>
      </header>

      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <section className="landing-hero-section">
        <ParallaxLayer className="landing-hero-section__accent" speed={14}>
          <span className="landing-ring landing-ring--a" />
          <span className="landing-ring landing-ring--b" />
          <span className="landing-ring landing-ring--c" />
        </ParallaxLayer>
        <div className="landing-hero-section__inner">
          <p className="landing-hero-section__eyebrow">CFA Level I &middot; Built from what actually happened</p>
          <h1 className="landing-hero-section__title">
            How to study.<br />When to study.
          </h1>
          <p className="landing-hero-section__subtitle">
            A CFA Level I plan built around your real week, and rebuilt from what you actually cover and get right.
          </p>
          <div className="landing-hero-section__actions">
            <ButtonLink size="lg" href="/signup">Get started</ButtonLink>
            <Link className="secondary-button" href="/demo">Try the walkthrough</Link>
            <span className="landing-hero-section__meta">Private beta · sign-up needs an invitation.</span>
          </div>
        </div>
      </section>

      {/* ── Readiness demo ───────────────────────────────────────────── */}
      <section className="story-section">
        <ScrollReveal className="story-section__head">
          <p className="story-section__eyebrow">What &ldquo;telling you how to study&rdquo; looks like</p>
          <h2>Four signals, never blended into one number</h2>
          <p className="story-section__lede">Studying isn&apos;t understanding, and confidence isn&apos;t accuracy. Roadmap tracks each on its own.</p>
        </ScrollReveal>
        <ReadinessDemo />
      </section>

      {/* ── Not teaching, telling ────────────────────────────────────── */}
      <section className="story-section story-section--tint">
        <ScrollReveal className="story-section__head">
          <p className="story-section__eyebrow">The difference that matters</p>
          <h2>Not teaching. Telling.</h2>
        </ScrollReveal>
        <ScrollStagger className="contrast-grid" stagger={0.1}>
          <div className="contrast-card">
            <Badge tone="neutral">A course</Badge>
            <h3>Teaches content</h3>
            <p>Delivers the syllabus in order, whatever you still need.</p>
          </div>
          <div className="contrast-card">
            <Badge tone="neutral">A tutor</Badge>
            <h3>Repeats what you got wrong</h3>
            <p>Reacts to your last mistake, but rarely checks the repair held.</p>
          </div>
          <div className="contrast-card contrast-card--accent">
            <Badge tone="accent">Roadmap</Badge>
            <h3>Tells you what, when and how much</h3>
            <p>Orders the syllabus, sizes each week to your hours, and re-checks every repair.</p>
          </div>
        </ScrollStagger>
      </section>

      {/* ── How it works ─────────────────────────────────────────────── */}
      <section className="story-section">
        <ScrollReveal className="story-section__head">
          <p className="story-section__eyebrow">The cycle, every week</p>
          <h2>An evidence-driven loop</h2>
        </ScrollReveal>
        <ScrollStagger className="steps-row" stagger={0.1}>
          {STEPS.map((step, i) => (
            <div key={step.title} className="step-card">
              <span className="step-card__index">{String(i + 1).padStart(2, '0')}</span>
              <step.icon size={20} aria-hidden />
              <h3>{step.title}</h3>
              <p>{step.detail}</p>
            </div>
          ))}
        </ScrollStagger>
      </section>

      {/* ── Week preview ─────────────────────────────────────────────── */}
      <section className="story-section story-section--tint">
        <ScrollReveal className="story-section__head">
          <p className="story-section__eyebrow">Your actual week, not a fixed calendar</p>
          <h2>The plan adapts to your week</h2>
          <p className="story-section__lede">Work is placed inside your real hours, and each week is rebuilt from what the last one showed.</p>
        </ScrollReveal>
        <WeekPreview />
      </section>

      {/* ── Mechanism stats ──────────────────────────────────────────── */}
      <section className="story-section">
        <ScrollStagger className="stats-row" stagger={0.1}>
          <div className="stat-card">
            <strong><CountUpStat value={4} /></strong>
            <span>signals, never blended into one score</span>
          </div>
          <div className="stat-card">
            <strong><CountUpStat value={0} /></strong>
            <span>hours prescribed before you share yours</span>
          </div>
          <div className="stat-card">
            <strong><CountUpStat value={1} /></strong>
            <span>diagnostic closes each week</span>
          </div>
        </ScrollStagger>
      </section>

      {/* ── Final CTA ────────────────────────────────────────────────── */}
      <section className="landing-cta">
        <ScrollReveal className="landing-cta__inner">
          <CheckCircle2 size={28} aria-hidden />
          <h2>Tell Roadmap what you can commit.</h2>
          <p>Five short steps, every answer editable later.</p>
          <ButtonLink size="lg" href="/signup">Get started</ButtonLink>
        </ScrollReveal>
      </section>

      <footer className="landing-footer">
        <span>&copy; {new Date().getFullYear()} Roadmap</span>
        <span>
          <Link href="/terms">Terms</Link> &middot; <Link href="/privacy">Privacy</Link>
        </span>
      </footer>
    </main>
  )
}
