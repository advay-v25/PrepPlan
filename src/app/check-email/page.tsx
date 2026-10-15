import { CheckEmail } from '../../components/auth/RecoveryForms'
export default async function CheckEmailPage({ searchParams }: { searchParams: Promise<{ email?: string }> }) { const { email } = await searchParams; return <CheckEmail email={email} /> }
