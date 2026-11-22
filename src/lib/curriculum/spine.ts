import { refCache } from '../ops/refCache'
import { cache } from 'react'
import { createAdminClient } from '../supabase/admin'

/**
 * Read model for the 2027 curriculum spine: subject -> reading -> module -> outcome.
 * Reference data only; per-student status is layered on by the callers.
 */

export type SubjectSummary = {
  id: string; name: string; summary: string; weightMin: number; weightMax: number; sequence: number
  readingCount: number; pageCount: number; structurePending: boolean
}

export type ReadingCard = {
  id: string; readingNo: number; title: string; summary: string | null; relevance: string | null
  sequence: number; pageCount: number; effortBand: number; structurePending: boolean
  outcomeCount: number; moduleCount: number
}

export type ReadingDetail = ReadingCard & {
  subject: { id: string; name: string }
  startPage: number
  modules: { id: string; moduleNo: string; title: string; startPage: number; outcomes: { id: string; code: string; title: string; page: number }[] }[]
  prev: { id: string; title: string } | null
  next: { id: string; title: string } | null
}

export async function getSubjects(): Promise<SubjectSummary[]> {
  const admin = createAdminClient()
  const [{ data: topics }, { data: readings }] = await refCache('spine.subjects', () => Promise.all([
    admin.from('topics').select('id, name, summary, exam_weight_min, exam_weight_max, default_sequence').order('default_sequence').throwOnError(),
    admin.from('curriculum_readings').select('topic_id, page_count, structure_pending').eq('is_active', true).throwOnError(),
  ]))
  return (topics ?? []).map(t => {
    const rs = (readings ?? []).filter(r => r.topic_id === t.id)
    return {
      id: t.id as string, name: t.name as string, summary: (t.summary ?? '') as string,
      weightMin: Number(t.exam_weight_min), weightMax: Number(t.exam_weight_max), sequence: Number(t.default_sequence),
      readingCount: rs.length, pageCount: rs.reduce((s, r) => s + Number(r.page_count), 0),
      structurePending: rs.length > 0 && rs.every(r => r.structure_pending),
    }
  })
}

export const getSubjectReadings = cache(async (subjectId: string): Promise<{ subject: SubjectSummary; readings: ReadingCard[] } | null> => {
  const admin = createAdminClient()
  const subject = (await getSubjects()).find(s => s.id === subjectId)
  if (!subject) return null
  const { data: readings } = await admin.from('curriculum_readings').select('*').eq('topic_id', subjectId).eq('is_active', true).order('sequence').throwOnError()
  const ids = (readings ?? []).map(r => r.id)
  if (!ids.length) return { subject, readings: [] }
  const [{ data: los }, { data: mods }] = await Promise.all([
    admin.from('reading_los').select('reading_id').in('reading_id', ids).throwOnError(),
    admin.from('reading_modules').select('reading_id').in('reading_id', ids).throwOnError(),
  ])
  const count = (rows: { reading_id: unknown }[] | null, id: string) => (rows ?? []).filter(r => r.reading_id === id).length
  return {
    subject,
    readings: (readings ?? []).map(r => ({
      id: r.id as string, readingNo: r.reading_no as number, title: r.title as string,
      summary: (r.summary ?? null) as string | null, relevance: (r.relevance ?? null) as string | null,
      sequence: r.sequence as number, pageCount: r.page_count as number, effortBand: r.effort_band as number,
      structurePending: Boolean(r.structure_pending), outcomeCount: count(los, r.id as string), moduleCount: count(mods, r.id as string),
    })),
  }
})

export const getReading = cache(async (subjectId: string, readingId: string): Promise<ReadingDetail | null> => {
  const admin = createAdminClient()
  const { data: r, error: readError } = await admin.from('curriculum_readings').select('*').eq('id', readingId).eq('topic_id', subjectId).eq('is_active', true).maybeSingle()
  if (readError) throw new Error('The reading could not be read.')   // a failed read is not an unknown reading
  if (!r) return null
  const [{ data: subject }, { data: modules }, { data: los }, { data: siblings }] = await Promise.all([
    admin.from('topics').select('id, name').eq('id', subjectId).single().throwOnError(),
    admin.from('reading_modules').select('id, module_no, title, start_page, sequence').eq('reading_id', readingId).order('sequence').throwOnError(),
    admin.from('reading_los').select('id, module_id, code, title, page, sequence').eq('reading_id', readingId).order('sequence').throwOnError(),
    admin.from('curriculum_readings').select('id, title, sequence').eq('topic_id', subjectId).eq('is_active', true).order('sequence').throwOnError(),
  ])
  const sibs = siblings ?? []
  const i = sibs.findIndex(s => s.id === readingId)
  return {
    id: r.id as string, readingNo: r.reading_no as number, title: r.title as string,
    summary: (r.summary ?? null) as string | null, relevance: (r.relevance ?? null) as string | null,
    sequence: r.sequence as number, pageCount: r.page_count as number, effortBand: r.effort_band as number,
    structurePending: Boolean(r.structure_pending), outcomeCount: (los ?? []).length, moduleCount: (modules ?? []).length,
    subject: { id: subject!.id as string, name: subject!.name as string }, startPage: r.start_page as number,
    modules: (modules ?? []).map(m => ({
      id: m.id as string, moduleNo: m.module_no as string, title: m.title as string, startPage: m.start_page as number,
      outcomes: (los ?? []).filter(l => l.module_id === m.id).map(l => ({ id: l.id as string, code: l.code as string, title: l.title as string, page: l.page as number })),
    })),
    prev: i > 0 ? { id: sibs[i - 1].id as string, title: sibs[i - 1].title as string } : null,
    next: i >= 0 && i < sibs.length - 1 ? { id: sibs[i + 1].id as string, title: sibs[i + 1].title as string } : null,
  }
})
