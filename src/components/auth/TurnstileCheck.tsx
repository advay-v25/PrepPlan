"use client"

import { useEffect, useRef, useState } from 'react'
import { TURNSTILE_SITE_KEY } from '../../lib/auth/authPolicy'

type Widget = {
  render(host: HTMLElement, options: Record<string, unknown>): string
  reset(id: string): void
  remove(id: string): void
}
const turnstile = () => (window as Window & { turnstile?: Widget }).turnstile
let scriptLoad: Promise<void> | undefined

function loadTurnstile() {
  if (turnstile()) return Promise.resolve()
  scriptLoad ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true
    const failed = () => {
      script.remove()
      reject(new Error('Turnstile could not be loaded'))
    }
    script.onload = () => { if (turnstile()) resolve(); else failed() }
    script.onerror = failed
    document.head.append(script)
  }).catch(error => {
    scriptLoad = undefined
    throw error
  })
  return scriptLoad
}

export function TurnstileCheck({ onToken, attempt }: { onToken: (token: string) => void; attempt: number }) {
  const host = useRef<HTMLDivElement>(null)
  const widget = useRef<string>(null)
  const [ready, setReady] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [status, setStatus] = useState<'waiting' | 'passed' | 'failed' | 'slow'>('waiting')

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || status !== 'waiting') return
    const timer = window.setTimeout(() => setStatus('slow'), 12_000)
    return () => window.clearTimeout(timer)
  }, [status, attempt])

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return
    // Auth pages can unmount while the browser is still loading the shared script.
    let active = true
    loadTurnstile().then(
      () => { if (active) setReady(true) },
      () => { if (active) setStatus('failed') },
    )
    return () => { active = false }
  }, [loadAttempt])

  useEffect(() => {
    const runtime = turnstile()
    if (!ready || !host.current) return
    if (!runtime) { setStatus('failed'); return }
    try {
      widget.current = runtime.render(host.current, {
        sitekey: TURNSTILE_SITE_KEY,
        size: 'flexible',
        callback: (token: string) => { setStatus('passed'); onToken(token) },
        'expired-callback': () => { setStatus('waiting'); onToken('') },
        'timeout-callback': () => { setStatus('slow'); onToken('') },
        'error-callback': () => { setStatus('failed'); onToken('') },
      })
    } catch {
      setStatus('failed')
      return
    }
    return () => {
      if (widget.current !== null) runtime.remove(widget.current)
      widget.current = null
    }
  }, [ready, onToken])

  useEffect(() => {
    if (attempt && widget.current !== null) {
      setStatus('waiting')
      try { turnstile()?.reset(widget.current) } catch { setStatus('failed') }
    }
  }, [attempt])

  if (!TURNSTILE_SITE_KEY) return null
  return <>
    <div ref={host} aria-label="Security check" />
    {status === 'waiting' ? <p className="fine-print" role="status">Complete the security check to continue.</p> : null}
    {status === 'failed' || status === 'slow' ? (
      <div role="status" className="fine-print">
        The security check is taking longer than expected.{' '}
        <button type="button" className="secondary-button" onClick={() => {
          const runtime = turnstile()
          onToken('')
          setStatus('waiting')
          if (widget.current === null || !runtime) {
            setReady(false)
            setLoadAttempt(value => value + 1)
            return
          }
          try { runtime.reset(widget.current) } catch { setStatus('failed') }
        }}>Retry security check</button>
      </div>
    ) : null}
  </>
}
