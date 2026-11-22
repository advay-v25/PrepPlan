import { redirect } from 'next/navigation'

export const validPaperId = (id: string) => /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)

export function paperUnavailable(): never {
  redirect('/app/tests?notice=paper-unavailable')
}
