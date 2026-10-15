'use client'

import { useCallback, useRef, useState } from 'react'

/**
 * Dragging and resizing on the time grid, via pointer events.
 *
 * Pointer events rather than HTML5 drag-and-drop: DnD gives no continuous
 * position, cannot express a resize, and behaves badly on touch. Pointer
 * capture keeps the gesture attached to the element even when the cursor leaves
 * it, which matters when dragging across day columns.
 */

export const SNAP_MINUTES = 15

export type DragMode = 'move' | 'resize'

export type DragState = {
  id: string
  mode: DragMode
  /** Where it would land if released now. */
  date: string
  startMinutes: number
  durationMinutes: number
  /** True once the pointer has moved far enough to count as a drag, not a click. */
  active: boolean
}

type Geometry = {
  /** Pixels per minute on the vertical axis. */
  pxPerMinute: number
  /** First minute rendered at the top of the grid. */
  originMinute: number
  /** Column rectangles, keyed by local date. */
  columns: Map<string, DOMRect>
}

export type CommitPayload = {
  id: string
  date: string
  startMinutes: number
  durationMinutes: number
  mode: DragMode
}

const DRAG_THRESHOLD_PX = 4
const MIN_DURATION = 15

export function useDragPlacement(options: {
  pxPerMinute: number
  originMinute: number
  onCommit: (payload: CommitPayload) => void | Promise<void>
}) {
  const [drag, setDrag] = useState<DragState | null>(null)
  // The same value in a ref. `finish` must read what the gesture actually
  // resolved to, and React state is not guaranteed to have re-rendered — a fast
  // flick can land pointerdown, move and up inside one batch.
  const live = useRef<DragState | null>(null)
  const geometry = useRef<Geometry | null>(null)
  const origin = useRef<{ x: number; y: number; startMinutes: number; durationMinutes: number; date: string } | null>(null)
  const columnRefs = useRef<Map<string, HTMLElement>>(new Map())
  const cancelled = useRef(false)

  const registerColumn = useCallback((date: string, el: HTMLElement | null) => {
    if (el) columnRefs.current.set(date, el)
    else columnRefs.current.delete(date)
  }, [])

  const snapshotGeometry = useCallback(() => {
    const columns = new Map<string, DOMRect>()
    for (const [date, el] of columnRefs.current) columns.set(date, el.getBoundingClientRect())
    geometry.current = { pxPerMinute: options.pxPerMinute, originMinute: options.originMinute, columns }
  }, [options.pxPerMinute, options.originMinute])

  const dateAt = useCallback((clientX: number, fallback: string): string => {
    const geo = geometry.current
    if (!geo) return fallback
    for (const [date, rect] of geo.columns) {
      if (clientX >= rect.left && clientX <= rect.right) return date
    }
    return fallback
  }, [])

  const begin = useCallback((
    e: React.PointerEvent,
    entry: { id: string; date: string; startMinutes: number; durationMinutes: number },
    mode: DragMode
  ) => {
    // Only a primary button drag; right-click and modifier clicks are left alone.
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()

    snapshotGeometry()
    cancelled.current = false
    origin.current = {
      x: e.clientX, y: e.clientY,
      startMinutes: entry.startMinutes,
      durationMinutes: entry.durationMinutes,
      date: entry.date,
    }
    const started: DragState = { ...entry, mode, active: false }
    live.current = started
    setDrag(started)
    // Capture keeps the gesture attached while the pointer crosses columns.
    // It throws if the pointer id is not currently active, which is not fatal.
    try { (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId) } catch { /* not capturable */ }
  }, [snapshotGeometry])

  const move = useCallback((e: React.PointerEvent) => {
    const start = origin.current
    const geo = geometry.current
    if (!start || !geo) return

    const dx = e.clientX - start.x
    const dy = e.clientY - start.y
    const moved = Math.abs(dx) > DRAG_THRESHOLD_PX || Math.abs(dy) > DRAG_THRESHOLD_PX

    const prev = live.current
    if (!prev) return
    const deltaMinutes = Math.round(dy / geo.pxPerMinute / SNAP_MINUTES) * SNAP_MINUTES

    let next: DragState
    if (prev.mode === 'resize') {
      next = {
        ...prev,
        durationMinutes: Math.max(MIN_DURATION, start.durationMinutes + deltaMinutes),
        active: prev.active || moved,
      }
    } else {
      next = {
        ...prev,
        date: dateAt(e.clientX, start.date),
        startMinutes: Math.max(0, Math.min(24 * 60 - prev.durationMinutes, start.startMinutes + deltaMinutes)),
        active: prev.active || moved,
      }
    }
    live.current = next
    setDrag(next)
  }, [dateAt])

  const finish = useCallback((e: React.PointerEvent) => {
    const current = live.current
    origin.current = null
    live.current = null
    setDrag(null)
    try { (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId) } catch { /* already released */ }

    if (!current || !current.active || cancelled.current) return
    void options.onCommit({
      id: current.id,
      date: current.date,
      startMinutes: current.startMinutes,
      durationMinutes: current.durationMinutes,
      mode: current.mode,
    })
  }, [options])

  /** Escape abandons the gesture without writing anything. */
  const cancel = useCallback(() => {
    cancelled.current = true
    origin.current = null
    live.current = null
    setDrag(null)
  }, [])

  return { drag, begin, move, finish, cancel, registerColumn }
}
