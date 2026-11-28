import { CheckEmail } from '../../components/auth/RecoveryForms'

export const metadata = { title: 'Check your email' }

export default async function CheckEmailPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  return <CheckEmail afterSignup={(await searchParams).from === 'signup'} />
}
