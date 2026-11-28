import gsap from 'gsap'

/** Motion is skipped for people who ask for less of it; content is always visible without it. */
export const calm = () => typeof window === 'undefined' || window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** One entrance for a screen: children rise a few pixels and fade in, in order. Quick, because people see it on every step. */
export function enter(targets: gsap.TweenTarget, opts: { delay?: number; y?: number } = {}) {
  if (calm()) return
  gsap.fromTo(targets, { autoAlpha: 0, y: opts.y ?? 14 }, { autoAlpha: 1, y: 0, duration: 0.42, ease: 'power3.out', stagger: 0.05, delay: opts.delay ?? 0, clearProps: 'transform,opacity,visibility' })
}
