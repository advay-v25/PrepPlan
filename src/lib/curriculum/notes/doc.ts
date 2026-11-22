/**
 * Note documents (TipTap/ProseMirror JSON): a whitelist validator and the
 * starter template. Everything a student saves is validated here first — only
 * known structure, safe link schemes, bounded size and depth.
 */

export type NoteDoc = { type: 'doc'; content?: NoteNode[] }
export type NoteNode = { type: string; attrs?: Record<string, unknown>; content?: NoteNode[]; marks?: { type: string; attrs?: Record<string, unknown> }[]; text?: string }

export const MAX_DOC_BYTES = 200_000
const MAX_DEPTH = 24

const NODES = new Set([
  'doc', 'paragraph', 'text', 'heading', 'bulletList', 'orderedList', 'listItem', 'taskList', 'taskItem',
  'blockquote', 'codeBlock', 'horizontalRule', 'hardBreak', 'table', 'tableRow', 'tableCell', 'tableHeader',
])
const MARKS = new Set(['bold', 'italic', 'underline', 'strike', 'code', 'highlight', 'link'])
const SAFE_HREF = /^(https?:\/\/|mailto:)/i

export function validateNoteDoc(input: unknown): { ok: true; doc: NoteDoc } | { ok: false; reason: string } {
  if (!input || typeof input !== 'object' || (input as any).type !== 'doc') return { ok: false, reason: 'Not a note document.' }
  let bytes = 0
  try { bytes = Buffer.byteLength(JSON.stringify(input)) } catch { return { ok: false, reason: 'Not a note document.' } }
  if (bytes > MAX_DOC_BYTES) return { ok: false, reason: 'This note is too large.' }

  const walk = (node: any, depth: number): string | null => {
    if (depth > MAX_DEPTH) return 'This note is nested too deeply.'
    if (!node || typeof node !== 'object' || typeof node.type !== 'string' || !NODES.has(node.type)) return `Unsupported content (${String(node?.type)}).`
    if (node.type === 'heading') {
      const lvl = node.attrs?.level
      if (![1, 2, 3].includes(lvl)) return 'Unsupported heading level.'
    }
    if (node.type === 'text' && typeof node.text !== 'string') return 'Malformed text.'
    if (node.attrs !== undefined && (node.attrs === null || typeof node.attrs !== 'object' || Array.isArray(node.attrs))) return 'Malformed content.'
    if (node.marks !== undefined && !Array.isArray(node.marks)) return 'Malformed formatting.'
    if (node.text !== undefined && node.type !== 'text') return 'Malformed content.'
    for (const m of node.marks ?? []) {
      if (!m || typeof m !== 'object' || typeof m.type !== 'string' || !MARKS.has(m.type)) return `Unsupported formatting (${String(m?.type)}).`
      if (m.attrs !== undefined && (m.attrs === null || typeof m.attrs !== 'object' || Array.isArray(m.attrs))) return 'Malformed formatting.'
      if (m.type === 'link') {
        const href = m.attrs?.href
        if (typeof href !== 'string' || !SAFE_HREF.test(href.trim())) return 'Links must start with http://, https:// or mailto:.'
      }
    }
    if (node.content !== undefined) {
      if (!Array.isArray(node.content)) return 'Malformed content.'
      for (const c of node.content) { const err = walk(c, depth + 1); if (err) return err }
    }
    return null
  }
  const err = walk(input, 0)
  return err ? { ok: false, reason: err } : { ok: true, doc: input as NoteDoc }
}

const h = (text: string): NoteNode => ({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text }] })
const p = (): NoteNode => ({ type: 'paragraph' })

/** A structured start: fixed sections the student can rename, delete or extend. */
export function starterDoc(kind: 'reading' | 'subject'): NoteDoc {
  return {
    type: 'doc',
    content: kind === 'reading'
      ? [h('Key ideas'), p(), h('Common mistakes'), p(), h('Formulas'), p()]
      : [h('How this subject fits together'), p(), h('Topics I find hard'), p(), h('Formulas and rules to remember'), p()],
  }
}

/** Plain text of a note (used by tests and any future search). */
export function noteText(doc: NoteDoc): string {
  const out: string[] = []
  const walk = (n: NoteNode) => { if (n.text) out.push(n.text); n.content?.forEach(walk) }
  walk(doc as NoteNode)
  return out.join(' ')
}

/** Key-order-independent JSON (jsonb does not preserve key order), for comparing a stored note with a submitted one. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`
  if (v && typeof v === 'object') return `{${Object.keys(v as object).sort().map(k => `${JSON.stringify(k)}:${canonicalJson((v as any)[k])}`).join(',')}}`
  return JSON.stringify(v)
}
