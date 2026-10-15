'use client'

import { useEffect, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Highlight from '@tiptap/extension-highlight'
import { TableKit } from '@tiptap/extension-table'
import { TaskList } from '@tiptap/extension-task-list'
import { TaskItem } from '@tiptap/extension-task-item'

type Status = 'saved' | 'saving' | 'unsaved' | 'conflict' | 'error'
const LABEL: Record<Status, string> = {
  saved: 'Saved', saving: 'Saving…', unsaved: 'Unsaved changes', conflict: 'This note changed elsewhere', error: 'Could not save',
}

/**
 * Notion-style block notes for one subject or reading. Autosaves after a short
 * pause with a revision guard: if the note was changed elsewhere it does NOT
 * overwrite — it asks the student to reload.
 */
export function NoteEditor(props: { scopeType: 'subject' | 'reading'; scopeId: string; initialDoc: unknown; initialRevision: number; label: string }) {
  const [status, setStatus] = useState<Status>('saved')
  const revision = useRef(props.initialRevision)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<unknown>(null)
  const saving = useRef(false)

  const save = async () => {
    if (saving.current || pending.current === null) return
    saving.current = true
    const doc = pending.current; pending.current = null
    setStatus('saving')
    try {
      const res = await fetch('/api/curriculum/notes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scopeType: props.scopeType, scopeId: props.scopeId, doc, expectedRevision: revision.current }),
      })
      const body = await res.json()
      if (body.ok) { revision.current = body.revision; setStatus(pending.current === null ? 'saved' : 'unsaved') }
      else if (body.code === 'stale_revision') { setStatus('conflict'); pending.current = null }
      else { setStatus('error'); pending.current = doc }
    } catch { setStatus('error'); pending.current = doc }
    finally { saving.current = false; if (pending.current !== null && status !== 'conflict') schedule() }
  }
  const schedule = () => { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(save, 1200) }

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: { openOnClick: true, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' } } }),
      Highlight, TableKit, TaskList, TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: `Notes on ${props.label}. Write freely, add a checklist or a table, and paste a link to keep it handy.` }),
    ],
    content: props.initialDoc as any,
    editorProps: { attributes: { class: 'note-editor__content', 'aria-label': `Notes on ${props.label}`, role: 'textbox', 'aria-multiline': 'true' } },
    onUpdate: ({ editor }) => { pending.current = editor.getJSON(); setStatus('unsaved'); schedule() },
  })

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (status === 'unsaved' || status === 'saving') e.preventDefault() }
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn)
  }, [status])

  if (!editor) return <div className="note-editor" aria-busy="true">Loading notes…</div>
  const btn = (label: string, active: boolean, run: () => void) => (
    <button type="button" className={`note-editor__btn ${active ? 'is-on' : ''}`} aria-pressed={active} onClick={run}>{label}</button>
  )
  const setLink = () => {
    const previous = editor.getAttributes('link').href as string | undefined
    const url = window.prompt('Link address (https://…)', previous ?? 'https://')
    if (url === null) return
    if (url.trim() === '') { editor.chain().focus().extendMarkRange('link').unsetLink().run(); return }
    if (!/^(https?:\/\/|mailto:)/i.test(url.trim())) { window.alert('Links must start with http://, https:// or mailto:'); return }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run()
  }

  return (
    <div className="note-editor">
      <div className="note-editor__bar" role="toolbar" aria-label="Formatting">
        {btn('H2', editor.isActive('heading', { level: 2 }), () => editor.chain().focus().toggleHeading({ level: 2 }).run())}
        {btn('H3', editor.isActive('heading', { level: 3 }), () => editor.chain().focus().toggleHeading({ level: 3 }).run())}
        {btn('Bold', editor.isActive('bold'), () => editor.chain().focus().toggleBold().run())}
        {btn('Italic', editor.isActive('italic'), () => editor.chain().focus().toggleItalic().run())}
        {btn('Highlight', editor.isActive('highlight'), () => editor.chain().focus().toggleHighlight().run())}
        {btn('Bullets', editor.isActive('bulletList'), () => editor.chain().focus().toggleBulletList().run())}
        {btn('Numbers', editor.isActive('orderedList'), () => editor.chain().focus().toggleOrderedList().run())}
        {btn('Checklist', editor.isActive('taskList'), () => editor.chain().focus().toggleTaskList().run())}
        {btn('Quote', editor.isActive('blockquote'), () => editor.chain().focus().toggleBlockquote().run())}
        {btn('Code', editor.isActive('codeBlock'), () => editor.chain().focus().toggleCodeBlock().run())}
        {btn('Table', editor.isActive('table'), () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run())}
        {btn('Link', editor.isActive('link'), setLink)}
        {btn('Divider', false, () => editor.chain().focus().setHorizontalRule().run())}
        <span className={`note-editor__status is-${status}`} role="status" aria-live="polite">{LABEL[status]}</span>
      </div>
      {status === 'conflict' && (
        <p role="alert" className="review-error">This note was changed somewhere else, so nothing was overwritten.{' '}
          <button type="button" className="text-button" onClick={() => window.location.reload()}>Reload the latest version</button></p>
      )}
      <EditorContent editor={editor} />
    </div>
  )
}
