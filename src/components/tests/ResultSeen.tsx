'use client'

import { useEffect } from 'react'

/** Tells the server the result was opened, once, so Home's "See result" step can complete. Renders nothing; failure is harmless. */
export function ResultSeen({ attemptId }: { attemptId: string }) {
  useEffect(() => { void fetch(`/api/tests/attempt/${encodeURIComponent(attemptId)}/viewed`, { method: 'POST' }).catch(() => {}) }, [attemptId])
  return null
}
