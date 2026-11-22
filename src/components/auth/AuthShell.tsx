import Link from 'next/link'
import type { ReactNode } from 'react'

/**
 * One frame for every authentication screen (sign in, sign up, reset, verify, errors): brand and one link at the top, the form in a centred column,
 * and an optional dark panel on the right. With no panel the screen is a single centred card, so all of them line up.
 */
export function AuthShell({ top, aside, children }: { top?: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <main className={`su${aside ? '' : ' su--solo'}`}>
      <section className="su-main">
        <header className="su-top">
          <Link href="/" className="auth-brand"><span className="brand-mark" aria-hidden="true" /> PrepPlan</Link>
          {top ? <p>{top}</p> : null}
        </header>
        <div className="su-card">{children}</div>
        <p className="su-foot">Not affiliated with CFA Institute</p>
      </section>
      {aside}
    </main>
  )
}
