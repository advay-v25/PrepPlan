import type { Metadata } from 'next'
import '../styles.css'

export const metadata: Metadata = {
  title: 'Roadmap Learning Control System',
  description: 'CFA Level I Learning Control System',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        {children}
      </body>
    </html>
  )
}
