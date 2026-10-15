'use client'

import { useEffect, type RefObject } from 'react'

/**
 * Keeps keyboard focus inside an overlay, and puts it back when the overlay
 * closes.
 *
 * This replaces five near-identical copies (CommitmentDialog, NewTaskDialog,
 * ConflictDialog, TaskDetailDrawer, ChallengeDialog) plus the one in AppShell.
 * They were not merely duplicated — they disagreed, and the disagreements were
 * bugs:
 *
 *   - Two omitted `[href]` from the focusable selector, so focus escaped to any
 *     link inside them.
 *   - None filtered `[disabled]` or hidden elements, so a conditionally-rendered
 *     field silently broke the trap.
 *   - None locked body scroll, so the page scrolled behind every modal.
 *
 * The best of the six was AppShell's, which nobody had copied. This is that one,
 * with the gaps closed.
 */

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

function focusableWithin(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE))
    // offsetParent is null for anything display:none or inside a hidden
    // ancestor. Without this a collapsed section breaks Tab entirely.
    .filter(el => el.offsetParent !== null || el === document.activeElement)
    .filter(el => el.getAttribute('aria-hidden') !== 'true')
}

export function useFocusTrap({
  containerRef,
  active = true,
  onEscape,
  initialFocusRef,
  restoreFocus = true,
  lockScroll = true,
}: {
  containerRef: RefObject<HTMLElement | null>
  active?: boolean
  onEscape?: () => void
  initialFocusRef?: RefObject<HTMLElement | null>
  restoreFocus?: boolean
  lockScroll?: boolean
}) {
  // Move focus in, and put it back on the way out.
  useEffect(() => {
    if (!active) return
    const previouslyFocused = document.activeElement as HTMLElement | null

    const target = initialFocusRef?.current
      ?? (containerRef.current ? focusableWithin(containerRef.current)[0] : null)
      ?? containerRef.current
    target?.focus()

    return () => {
      if (restoreFocus && previouslyFocused?.isConnected) previouslyFocused.focus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  // Stop the page scrolling behind the overlay. None of the five copies did
  // this, which is why every modal let the page move underneath it.
  useEffect(() => {
    if (!active || !lockScroll) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [active, lockScroll])

  useEffect(() => {
    if (!active) return

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && onEscape) { e.preventDefault(); onEscape(); return }
      if (e.key !== 'Tab') return

      const container = containerRef.current
      if (!container) return
      const items = focusableWithin(container)
      if (items.length === 0) { e.preventDefault(); return }

      const first = items[0]
      const last = items[items.length - 1]
      const activeEl = document.activeElement

      // Focus resting on the container itself (a drawer given tabIndex={-1})
      // needs shift-Tab to wrap to the end rather than escaping upward.
      if (e.shiftKey && (activeEl === first || activeEl === container)) {
        e.preventDefault(); last.focus()
      } else if (!e.shiftKey && activeEl === last) {
        e.preventDefault(); first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [active, onEscape, containerRef])
}
