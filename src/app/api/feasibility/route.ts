import { NextResponse } from 'next/server'
export async function POST() {
  return NextResponse.json({ error: 'Readiness screening has been retired. Everyone can set up their study context.', next: '/signup' }, { status: 410 })
}
