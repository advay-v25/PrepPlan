import { redirect } from 'next/navigation'

/**
 * /app/syllabus is superseded by /app/curriculum, which owns the long-term
 * roadmap. Kept as a redirect so existing links keep working.
 */
export default function SyllabusPage() {
  redirect('/app/curriculum')
}
