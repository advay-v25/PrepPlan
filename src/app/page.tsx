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
            We don&apos;t teach CFA.<br />We tell you how to study it.
          </h1>
          <p className="landing-hero-section__subtitle">
            Roadmap doesn&apos;t replace your notes, your course, or your classes. It watches what you&apos;ve
            covered, what diagnostics show you actually know, and tells you exactly what to study next, how much
            time it needs, and whether you&apos;re actually ready — one real week at a time.
          </p>
          <div className="landing-hero-section__actions">
            <ButtonLink size="lg" href="/signup">Get started</ButtonLink>
            <span className="landing-hero-section__meta">No readiness screening to get in. No prescribed hours.</span>
          </div>
        </div>
      </section>

      {/* ── Readiness demo ───────────────────────────────────────────── */}
      <section className="story-section">
        <ScrollReveal className="story-section__head">
          <p className="story-section__eyebrow">What &ldquo;telling you how to study&rdquo; looks like</p>
          <h2>Four signals, never blended into one number</h2>
          <p className="story-section__lede">
            Studying isn&apos;t understanding, following the plan isn&apos;t knowing it, and feeling confident isn&apos;t
            being right. Roadmap tracks each separately, because collapsing them into one score is how students end
            up surprised on exam day.
          </p>
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
            <p>Delivers the syllabus in order, at its own pace, whether or not it matches what you still need.</p>
          </div>
          <div className="contrast-card">
            <Badge tone="neutral">A tutor</Badge>
            <h3>Repeats what you got wrong</h3>
            <p>Reacts to your last mistake, but rarely tracks whether the repair actually held two weeks later.</p>
          </div>
          <div className="contrast-card contrast-card--accent">
            <Badge tone="accent">Roadmap</Badge>
            <h3>Tells you what to study, when, and how much</h3>
            <p>Orders the syllabus, sizes each week to your real hours, and re-checks a repair before calling it done.</p>
          </div>
        </ScrollStagger>
      </section>

      {/* ── How it works ─────────────────────────────────────────────── */}
      <section className="story-section">
        <ScrollReveal className="story-section__head">
          <p className="story-section__eyebrow">The cycle, every week</p>
          <h2>An evidence-driven loop, not a syllabus you scroll through</h2>
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
          <h2>The plan adjusts to your week — not the other way round</h2>
          <p className="story-section__lede">
            Tell it what you can commit, and the roadmap places real work inside your real hours. A diagnostic
            closes every week and the following week is rebuilt from what it finds — not from a schedule that
            assumed you&apos;d get to everything.
          </p>
        </ScrollReveal>
        <WeekPreview />
      </section>

      {/* ── Mechanism stats ──────────────────────────────────────────── */}
      <section className="story-section">
        <ScrollStagger className="stats-row" stagger={0.1}>
          <div className="stat-card">
            <strong><CountUpStat value={4} /></strong>
            <span>Signals tracked separately — never blended into one score</span>
          </div>
          <div className="stat-card">
            <strong><CountUpStat value={0} /></strong>
            <span>Hours prescribed before you tell it what you actually have</span>
          </div>
          <div className="stat-card">
            <strong><CountUpStat value={1} /></strong>
            <span>Diagnostic closing every study week, rebuilding what&apos;s next</span>
          </div>
        </ScrollStagger>
      </section>

      {/* ── Final CTA ────────────────────────────────────────────────── */}
      <section className="landing-cta">
        <ScrollReveal className="landing-cta__inner">
          <CheckCircle2 size={28} aria-hidden />
          <h2>Tell Roadmap what you can commit.</h2>
          <p>Six short screens, every answer editable later. No readiness screening to get in.</p>
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
