import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

let scrollTriggerRegistered = false
function ensureScrollTrigger() {
  if (scrollTriggerRegistered || typeof window === 'undefined') return
  gsap.registerPlugin(ScrollTrigger)
  scrollTriggerRegistered = true
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return true
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function fadeInUp(target: gsap.TweenTarget, opts?: { delay?: number }) {
  if (prefersReducedMotion()) {
    gsap.set(target, { opacity: 1, y: 0 })
    return
  }
  gsap.fromTo(
    target,
    { opacity: 0, y: 12 },
    { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out', delay: opts?.delay ?? 0 }
  )
}

export function staggerIn(targets: gsap.TweenTarget, opts?: { stagger?: number }) {
  if (prefersReducedMotion()) {
    gsap.set(targets, { opacity: 1, y: 0 })
    return
  }
  gsap.fromTo(
    targets,
    { opacity: 0, y: 12 },
    { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out', stagger: opts?.stagger ?? 0.05 }
  )
}

export function slideDrawer(el: gsap.TweenTarget, direction: 'in' | 'out', onComplete?: () => void) {
  if (prefersReducedMotion()) {
    gsap.set(el, { xPercent: direction === 'in' ? 0 : -100 })
    onComplete?.()
    return
  }
  if (direction === 'in') {
    gsap.set(el, { xPercent: -100 })
    gsap.to(el, { xPercent: 0, duration: 0.28, ease: 'power2.out', onComplete })
  } else {
    gsap.to(el, { xPercent: -100, duration: 0.2, ease: 'power2.in', onComplete })
  }
}

/**
 * Runs `onEnter` the first time `target` enters the viewport (with a margin
 * so it fires slightly before the element is fully on screen), then
 * disconnects. Deliberately IntersectionObserver rather than
 * ScrollTrigger's scroll-position math for this "has it appeared yet"
 * question: ScrollTrigger's start position is computed once (at creation)
 * from the element's offset, which goes stale if a web font swap or a late
 * image load shifts layout afterward — exactly what this page's
 * `display: swap` serif/body fonts do. An IntersectionObserver re-evaluates
 * against live layout on every frame, so it can't go stale the same way.
 * ScrollTrigger is kept for `parallaxLayer`, where the effect is continuous
 * scroll position itself, not a one-time "has this appeared" boolean.
 */
function onEnterViewport(target: Element, onEnter: () => void): () => void {
  if (typeof IntersectionObserver === 'undefined') { onEnter(); return () => {} }
  const observer = new IntersectionObserver((entries) => {
    if (entries.some(e => e.isIntersecting)) { onEnter(); observer.disconnect() }
  }, { threshold: 0.1, rootMargin: '0px 0px -10% 0px' })
  observer.observe(target)
  return () => observer.disconnect()
}

/**
 * The landing page's story sections: each reveals once, the first time it
 * scrolls into view, rather than on mount (most of them are off-screen at
 * load). Returns a cleanup function — callers must run it on unmount so a
 * pending observer doesn't fire a tween on a detached element.
 */
export function scrollReveal(target: Element, opts?: { delay?: number; y?: number }): () => void {
  if (prefersReducedMotion()) {
    gsap.set(target, { opacity: 1, y: 0 })
    return () => {}
  }
  gsap.set(target, { opacity: 0, y: opts?.y ?? 24 })
  return onEnterViewport(target, () => {
    gsap.to(target, { opacity: 1, y: 0, duration: 0.6, ease: 'power2.out', delay: opts?.delay ?? 0 })
  })
}

/** Same as scrollReveal, but staggers the container's direct children. */
export function scrollStagger(container: Element, opts?: { stagger?: number }): () => void {
  const items = container.querySelectorAll(':scope > *')
  if (prefersReducedMotion()) {
    gsap.set(items, { opacity: 1, y: 0 })
    return () => {}
  }
  gsap.set(items, { opacity: 0, y: 20 })
  return onEnterViewport(container, () => {
    gsap.to(items, { opacity: 1, y: 0, duration: 0.5, ease: 'power2.out', stagger: opts?.stagger ?? 0.08 })
  })
}

/**
 * A subtle scroll-scrubbed vertical drift for decorative background layers
 * only — never body copy or interactive controls (it degrades reading
 * comfort and can read as motion sickness at larger deltas). Skipped
 * entirely under reduced motion rather than jumping to a static offset,
 * since a parallax layer has no meaningful "settled" position of its own.
 */
export function parallaxLayer(target: Element, speedPercent = 10): () => void {
  if (prefersReducedMotion()) return () => {}
  ensureScrollTrigger()
  const tween = gsap.to(target, {
    yPercent: speedPercent, ease: 'none',
    scrollTrigger: { trigger: target.parentElement ?? target, scrub: 0.5 },
  })
  return () => { tween.scrollTrigger?.kill(); tween.kill() }
}

/**
 * Counts a number display up to its target once scrolled into view. `el`'s
 * own text is the source of truth for the target value and formatting
 * (read once, then driven by the tween) so the server-rendered markup is
 * never a placeholder — a visitor with JS disabled simply sees the real
 * final number immediately, never a stuck "0".
 */
export function countUp(el: HTMLElement, opts?: { duration?: number; delay?: number }): () => void {
  const target = Number(el.dataset.countTo ?? el.textContent?.replace(/[^0-9.-]/g, ''))
  const suffix = el.dataset.countSuffix ?? ''
  if (!Number.isFinite(target) || prefersReducedMotion()) return () => {}
  const counter = { value: 0 }
  return onEnterViewport(el, () => {
    gsap.to(counter, {
      value: target, duration: opts?.duration ?? 1.4, delay: opts?.delay ?? 0, ease: 'power2.out',
      onUpdate: () => { el.textContent = `${Math.round(counter.value)}${suffix}` },
    })
  })
}

/**
 * Fills a progress bar's fill element to its target width (read from
 * `data-fill-to`, a 0-100 percentage already baked into the server-rendered
 * inline style) once scrolled into view. The bar is already at its correct
 * final width without JS — this only replays the fill as a reveal.
 */
export function progressFill(el: HTMLElement, opts?: { delay?: number }): () => void {
  const target = Number(el.dataset.fillTo ?? 0)
  if (prefersReducedMotion()) { gsap.set(el, { width: `${target}%` }); return () => {} }
  gsap.set(el, { width: '0%' })
  return onEnterViewport(el, () => {
    gsap.to(el, { width: `${target}%`, duration: 1, ease: 'power2.out', delay: opts?.delay ?? 0 })
  })
}
