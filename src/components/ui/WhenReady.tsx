'use client'

import { useSyncExternalStore } from 'react'

/**
 * False only while a server-rendered page is still being taken over by React. Anything typed or pressed before then is lost, so such forms stay
 * disabled until it is true. A form mounted on the client is ready from its first render, so its initial focus is untouched.
 */
export const useHydrated = () => useSyncExternalStore(() => () => {}, () => true, () => false)

/** Holds a server-rendered form's controls until they can be heard. `display: contents` keeps the layout as it was. */
export function WhenReady({ children }: { children: React.ReactNode }) {
  const ready = useHydrated()
  return <fieldset disabled={!ready} aria-busy={!ready} style={{ display: 'contents' }}>{children}</fieldset>
}
