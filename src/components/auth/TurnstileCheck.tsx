"use client"

import Script from 'next/script'
import { useEffect, useRef, useState } from 'react'
import { TURNSTILE_SITE_KEY } from '../../lib/auth/authPolicy'

type Widget = {
  render(host: HTMLElement, options: Record<string, unknown>): string
  reset(id: string): void
  remove(id: string): void
}
const turnstile = () => (window as Window & { turnstile?: Widget }).turnstile

export function TurnstileCheck({ onToken, attempt }: { onToken: (token: string) => void; attempt: number }) {
  const host = useRef<HTMLDivElement>(null)
  const widget = useRef<string>(null)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const runtime = turnstile()
    if (!ready || !runtime || !host.current) return
    widget.current = runtime.render(host.current, {
      sitekey: TURNSTILE_SITE_KEY,
      size: 'flexible',
      callback: (token: string) => { setFailed(false); onToken(token) },
      'expired-callback': () => onToken(''),
      'error-callback': () => { setFailed(true); onToken('') },
    })
    return () => {
      if (widget.current !== null) runtime.remove(widget.current)
      widget.current = null
    }
  }, [ready, onToken])

  useEffect(() => {
    if (attempt && widget.current !== null) turnstile()?.reset(widget.current)
  }, [attempt])

  if (!TURNSTILE_SITE_KEY) return null
  return <>
    <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" strategy="afterInteractive" onReady={() => setReady(true)} onError={() => setFailed(true)} />
    <div ref={host} aria-label="Security check" />
    {failed ? <p className="auth-error" role="alert">The security check could not load. Reload the page or try another connection.</p> : null}
  </>
}
