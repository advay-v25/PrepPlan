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
  saved: 'Saved', saving: 'Saving…', unsaved: 'Unsaved changes', conflict: 'This note changed elsewhere', error: 'Not saved',
}
const MAX_AUTO_RETRIES = 3
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/**
 * Block notes for one subject or reading, autosaved with a revision guard.
 *  - Saves are serial. What is acknowledged is the exact document that was sent: "Saved" is shown only when the visible document IS that one,
 *    and a failure never replaces a newer draft with an older one.
 *  - A conflict keeps BOTH versions: the student chooses the saved version, or keeps their own, or copies their text first.
 *  - Permanent refusals (4xx) are not retried; transient failures retry a bounded number of times, then wait for the student's Retry.
 *  - Every unsaved state is also kept locally (per signed-in user, per note) and offered back after a refresh or a failed navigation.
 */
export function NoteEditor(props: { scopeType: 'subject' | 'reading'; scopeId: string; initialDoc: unknown; initialRevision: number; label: string; ownerId?: string }) {
  const [status, setStatus] = useState<Status>('saved')
  const [message, setMessage] = useState<string | null>(null)
  const [serverCopy, setServerCopy] = useState<{ doc: unknown; revision: number } | null>(null)
  const [recovered, setRecovered] = useState<{ doc: unknown; at: string } | null>(null)
  const revision = useRef(props.initialRevision)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef<unknown>(null)          // the newest document in the editor that has not been acknowledged (null = nothing unsaved)
  const saving = useRef(false)
  const retries = useRef(0)
  const stopped = useRef(false)                  // conflict or permanent refusal: no automatic saving until the student chooses
  const draftKey = props.ownerId ? `roadmap-note-draft:${props.ownerId}:${props.scopeType}:${props.scopeId}` : null

  const keepDraft = (doc: unknown) => { if (draftKey) try { localStorage.setItem(draftKey, JSON.stringify({ doc, at: new Date().toISOString(), base: revision.current })) } catch {} }
  const clearDraft = () => { if (draftKey) try { localStorage.removeItem(draftKey) } catch {} }

  const save = async () => {
    if (saving.current || latest.current === null || stopped.current) return
    saving.current = true
    const sent = latest.current
    setStatus('saving'); setMessage(null)
    let outcome: 'ok' | 'conflict' | 'permanent' | 'transient' = 'transient'
    let body: any = null
    try {
      const res = await fetch('/api/curriculum/notes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scopeType: props.scopeType, scopeId: props.scopeId, doc: sent, expectedRevision: revision.current }),
      })
      body = await res.json().catch(() => null)
      outcome = body?.ok ? 'ok' : body?.code === 'stale_revision' ? 'conflict' : res.status >= 400 && res.status < 500 ? 'permanent' : 'transient'
    } catch { outcome = 'transient' }
    saving.current = false
    if (outcome === 'ok') {
      revision.current = body.revision; retries.current = 0
      if (same(latest.current, sent)) { latest.current = null; clearDraft(); setStatus('saved') }   // acknowledged exactly what is on screen
      else { setStatus('unsaved'); schedule(0) }                                                       // typed more meanwhile: save that next
      return
    }
    keepDraft(latest.current)                                                                        // whatever the failure, the newest text stays
    if (outcome === 'conflict') { stopped.current = true; setServerCopy({ doc: body.doc, revision: body.revision }); setStatus('conflict'); return }
    if (outcome === 'permanent') { stopped.current = true; setStatus('error'); setMessage(body?.error ?? 'This note could not be saved as written.'); return }
    setStatus('error')
    if (retries.current < MAX_AUTO_RETRIES) { retries.current += 1; setMessage('Could not reach the server. Trying again…'); schedule(2000 * retries.current) }
    else setMessage('Still not saved. Your text is kept here; press Retry when your connection is back.')
  }
  const schedule = (ms = 1200) => { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(save, ms) }
  const retryNow = () => { stopped.current = false; retries.current = 0; void save() }

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: { openOnClick: true, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' } } }),
      Highlight, TableKit, TaskList, TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: `Notes on ${props.label}. Write freely, add a checklist or a table, and paste a link to keep it handy.` }),
    ],
    content: props.initialDoc as any,
    editorProps: {
      attributes: { class: 'note-editor__content', 'aria-label': `Notes on ${props.label}`, role: 'textbox', 'aria-multiline': 'true' },
      // IME: a composition in progress is not a finished edit. The text is kept locally as it changes, but saving waits for the composition to end.
      handleDOMEvents: { compositionend: () => { if (!stopped.current && latest.current !== null) schedule(); return false } },
    },
    onUpdate: ({ editor }) => {
      latest.current = editor.getJSON(); keepDraft(latest.current)
      if (!stopped.current) { setStatus('unsaved'); if (!editor.view.composing) schedule() }
    },
  })

  // A draft left behind by a refresh, a failed save or a closed tab: offered back, never applied silently.
  useEffect(() => {
    if (!draftKey) return
    try {
      const raw = localStorage.getItem(draftKey); if (!raw) return
      const d = JSON.parse(raw) as { doc: unknown; at: string }
      if (d?.doc && !same(d.doc, props.initialDoc)) setRecovered({ doc: d.doc, at: d.at }); else clearDraft()
    } catch {}
  }, [draftKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Leaving the page or switching notes: flush what is unsaved (the local draft already holds it), and stop timers.
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); if (latest.current !== null && !stopped.current && !saving.current) void save() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (latest.current !== null || status === 'saving') e.preventDefault() }
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
        {btn('Add mistake notes', false, () => editor.chain().focus('end').insertContent([
          { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'What I missed' }] }, { type: 'paragraph' },
          { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'What I will check next' }] }, { type: 'paragraph' },
          { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Personal reference' }] }, { type: 'paragraph' },
        ]).run())}
        <span className={`note-editor__status is-${status}`} role="status" aria-live="polite">{LABEL[status]}</span>
      </div>
      {recovered && (
        <p role="status" className="note">An unsaved draft from {new Date(recovered.at).toLocaleString('en-GB')} was kept on this device.{' '}
          <button type="button" className="text-button" onClick={() => { editor.commands.setContent(recovered.doc as any); latest.current = editor.getJSON(); setRecovered(null); setStatus('unsaved'); schedule(0) }}>Restore it</button>{' · '}
          <button type="button" className="text-button" onClick={() => { clearDraft(); setRecovered(null) }}>Discard it</button></p>
      )}
      {status === 'error' && <p role="alert" className="review-error">{message ?? 'Not saved.'}{' '}<button type="button" className="text-button" onClick={retryNow}>Retry</button></p>}
      {status === 'conflict' && (
        <div role="alert" className="review-error">
          <p>This note was changed somewhere else, so nothing was overwritten. Your text is still here.</p>
          <p>
            <button type="button" className="text-button" onClick={() => { void navigator.clipboard?.writeText(JSON.stringify(editor.getText())) .catch(() => {}); setMessage('Your text was copied.') }}>Copy my text</button>{' · '}
            <button type="button" className="text-button" onClick={() => { if (serverCopy) { revision.current = serverCopy.revision; editor.commands.setContent((serverCopy.doc ?? { type: 'doc', content: [{ type: 'paragraph' }] }) as any); latest.current = null; clearDraft(); stopped.current = false; setServerCopy(null); setStatus('saved') } }}>Use the saved version</button>{' · '}
            <button type="button" className="text-button" onClick={() => { if (serverCopy) { revision.current = serverCopy.revision; stopped.current = false; setServerCopy(null); retryNow() } }}>Keep mine and replace it</button>
          </p>
        </div>
      )}
      <EditorContent editor={editor} />
    </div>
  )
}
