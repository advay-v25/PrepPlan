import type { Metadata } from 'next'
import { connection } from 'next/server'
import { Geist, Geist_Mono } from 'next/font/google'
import { cookies } from 'next/headers'
import { parseTheme, THEME_COOKIE } from '../lib/theme/theme'
import '../styles.css'
import '../overhaul.css'

const geist = Geist({ subsets: ['latin'], display: 'swap', variable: '--font-geist' })
const geistMono = Geist_Mono({ subsets: ['latin'], display: 'swap', variable: '--font-geist-mono' })

export const metadata: Metadata = {
  title: { default: 'PrepPlan', template: '%s · PrepPlan' },
  description: 'CFA Level I Learning Control System',
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // The request carries the nonce Next uses on its streamed HTML and scripts.
  await connection()
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value)
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable}`} data-theme={theme === 'system' ? undefined : theme} suppressHydrationWarning>
      <body suppressHydrationWarning>
        {children}
      </body>
    </html>
  )
}
