import { CLASS_KINDS, type ClassKind, type LogInput, type LogItemInput } from './service'

/** Validates an untrusted request body into a LogInput (or null). */
export function parseLogInput(body: any): LogInput | null {
  if (!body || typeof body !== 'object') return null
  if (typeof body.classDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.classDate)) return null
  if (!CLASS_KINDS.includes(body.kind as ClassKind)) return null
  if (!Array.isArray(body.items) || body.items.length > 60) return null
  const items: LogItemInput[] = []
  for (const i of body.items) {
    if (!i || typeof i.outcomeId !== 'string' || i.outcomeId.length > 60) return null
    if (!['part', 'full', 'continued'].includes(i.extent)) return null
    items.push({
      outcomeId: i.outcomeId, extent: i.extent,
      portionNote: typeof i.portionNote === 'string' ? i.portionNote.slice(0, 300) : undefined,
      studiedInClass: i.studiedInClass === true,
    })
  }
  if (new Set(items.map(i => i.outcomeId)).size !== items.length) return null
  return { classDate: body.classDate, kind: body.kind, note: typeof body.note === 'string' ? body.note.slice(0, 500) : undefined, items }
}
