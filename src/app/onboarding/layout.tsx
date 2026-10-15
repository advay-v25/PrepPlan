import type { ReactNode } from 'react'

/**
 * Onboarding renders in the app's design system.
 *
 * It previously had its own CSS module — Arial, a different blue, seven ad-hoc
 * border colours, its own focus ring and a 300px rail against the app's 228px —
 * so crossing from the last onboarding screen into /app was a visible jolt. It
 * should read as the first room of the house, not the porch of a different one.
 */
export default function OnboardingLayout({ children }: { children: ReactNode }) {
  return <div className="ob-root">{children}</div>
}
