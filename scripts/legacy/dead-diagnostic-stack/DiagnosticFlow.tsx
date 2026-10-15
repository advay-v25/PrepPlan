import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Check, CheckCircle2, ChevronDown, CircleHelp, Clock3, Flag, LogOut, ShieldCheck, Target, TrendingUp, X } from 'lucide-react'
import { questions, subjects } from '../data'
import { scoreDiagnostic, selectNextQuestion } from '../diagnosticEngine'
import type { Confidence, DiagnosticAnswer, Question, SubjectId } from '../types'

type DiagnosticPageProps = {
  initialSubject: SubjectId
  onExit: () => void
  onSubjectChange: (subject: SubjectId) => void
  onAccept: (subjectId: SubjectId, answers: DiagnosticAnswer[], result: ReturnType<typeof scoreDiagnostic>) => void
}

export function DiagnosticFlow({ initialSubject, onExit, onSubjectChange, onAccept }: DiagnosticPageProps) {
  const savedDraft = useMemo(() => {
    try {
      const saved = localStorage.getItem(`roadmap-diagnostic-${initialSubject}`)
      return saved ? JSON.parse(saved) as { answers: DiagnosticAnswer[]; seconds: number; pool?: Question[] } : { answers: [], seconds: 600 }
    } catch { return { answers: [], seconds: 600 } }
  }, [initialSubject])
  const [subjectId, setSubjectId] = useState<SubjectId>(initialSubject)
  const [answers, setAnswers] = useState<DiagnosticAnswer[]>(savedDraft.answers)
  const [pool, setPool] = useState<Question[]>(savedDraft.pool ?? questions.filter((question) => question.subject === initialSubject))
  const [current, setCurrent] = useState<Question | null>(() => selectNextQuestion(initialSubject, savedDraft.answers, new Set(savedDraft.answers.map((answer) => answer.questionId)), savedDraft.pool))
  const [generating, setGenerating] = useState(!savedDraft.pool?.length)
  const [generationError, setGenerationError] = useState(false)
  const [selected, setSelected] = useState<number | null>(null)
  const [confidence, setConfidence] = useState<Confidence>('medium')
  const [flagged, setFlagged] = useState(false)
  const [feedback, setFeedback] = useState<'correct' | 'incorrect' | null>(null)
  const [complete, setComplete] = useState(false)
  const [seconds, setSeconds] = useState(savedDraft.seconds)

  const subject = subjects.find((item) => item.id === subjectId) ?? subjects[0]
  const targetTotal = generationError ? Math.max(1, pool.length) : 10
  const progress = Math.round((answers.length / targetTotal) * 100)

  const moduleSignals = useMemo(() => subject.modules.map((module) => {
    const evidence = answers.filter((answer) => answer.module === module)
    const correct = evidence.filter((answer) => answer.correct).length
    return { module, status: current?.module === module ? 'current' : evidence.length ? (correct === evidence.length ? 'done' : 'risk') : 'waiting' }
  }), [answers, current?.module, subject.modules])

  useEffect(() => {
    if (generationError) return
    if (pool.length >= 8 && pool.every((question) => question.subject === subjectId)) { setGenerating(false); return }
    const controller = new AbortController(); setGenerating(true); setGenerationError(false); setCurrent(null)
    fetch('/api/diagnostics/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal, body: JSON.stringify({ subjectId, subjectName: subject.name, modules: subject.modules, moduleSize: 'medium', demo: process.env.NODE_ENV !== 'production' && new URLSearchParams(window.location.search).get('demo') === '1' }) })
      .then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.error); return data.questions as Question[] })
      .then((generated) => { setPool(generated); setAnswers([]); setCurrent(selectNextQuestion(subjectId, [], new Set(), generated)); setGenerating(false) })
      .catch((error) => { if (error?.name === 'AbortError') return; const fallback = questions.filter((question) => question.subject === subjectId); setPool(fallback); setCurrent(selectNextQuestion(subjectId, [], new Set(), fallback)); setGenerationError(true); setGenerating(false) })
    return () => controller.abort()
  }, [generationError, pool.length, subject, subjectId])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (complete) return
      if (event.key >= '1' && event.key <= '3' && !feedback) setSelected(Number(event.key) - 1)
      if (event.key === 'Enter' && selected !== null) document.querySelector<HTMLButtonElement>('[data-submit-answer]')?.click()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [complete, feedback, selected])

  useEffect(() => {
    if (complete) return
    const timer = window.setInterval(() => setSeconds((value) => Math.max(0, value - 1)), 1000)
    return () => window.clearInterval(timer)
  }, [complete])

  useEffect(() => {
    localStorage.setItem(`roadmap-diagnostic-${subjectId}`, JSON.stringify({ answers, seconds, pool: pool.length >= 8 ? pool : undefined }))
  }, [answers, pool, seconds, subjectId])

  const resetForSubject = (nextSubject: SubjectId) => {
    setSubjectId(nextSubject)
    onSubjectChange(nextSubject)
    setAnswers([])
    setPool(questions.filter((question) => question.subject === nextSubject))
    setCurrent(null)
    setGenerating(true)
    setGenerationError(false)
    setSelected(null)
    setFeedback(null)
    setComplete(false)
    setSeconds(600)
    localStorage.removeItem(`roadmap-diagnostic-${nextSubject}`)
  }

  const submit = () => {
    if (!current || selected === null) return
    if (!feedback) {
      setFeedback(selected === current.answer ? 'correct' : 'incorrect')
      return
    }

    const nextAnswer: DiagnosticAnswer = {
      questionId: current.id,
      selected,
      confidence,
      correct: selected === current.answer,
      module: current.module,
      misconception: current.misconception,
      flagged,
    }
    const nextAnswers = [...answers, nextAnswer]
    const seen = new Set(nextAnswers.map((answer) => answer.questionId))
    const nextQuestion = selectNextQuestion(subjectId, nextAnswers, seen, pool)
    setAnswers(nextAnswers)
    setSelected(null)
    setConfidence('medium')
    setFlagged(false)
    setFeedback(null)
    if (!nextQuestion || nextAnswers.length >= targetTotal) {
      setComplete(true)
      setCurrent(null)
    } else {
      setCurrent(nextQuestion)
    }
  }

  const goBack = () => {
    const previous = answers.at(-1)
    if (!previous) return
    setAnswers((value) => value.slice(0, -1))
    setCurrent(pool.find((question) => question.id === previous.questionId) ?? null)
    setSelected(previous.selected)
    setConfidence(previous.confidence)
    setFlagged(Boolean(previous.flagged))
    setFeedback(null)
  }

  if (complete) return <DiagnosticResult subjectId={subjectId} answers={answers} onExit={onExit} onRetry={() => resetForSubject(subjectId)} onAccept={() => { onAccept(subjectId, answers, scoreDiagnostic(answers)); localStorage.removeItem(`roadmap-diagnostic-${subjectId}`); onExit() }} />
  if (!current && generating) return <div className="empty-state page-content"><Clock3 size={42} /><h1>Building your {subject.name} diagnostic</h1><p>Roadmap is assembling a 10-question unseen form across core concepts, missed details, misconception traps and indirect application.</p><button className="secondary-button" onClick={onExit}>Cancel</button></div>
  if (!current) return <DiagnosticEmpty subject={subject.name} onExit={onExit} />

  return (
    <div className="diagnostic-page">
      <header className="diagnostic-header">
        <div><h1>{subject.name} diagnostic</h1><p>{generationError ? 'Limited offline form — live generation is temporarily unavailable' : 'Fresh 10-question form built from your selected subject and current evidence'}</p></div>
        <label className="subject-select"><span className={`subject-code subject-code--${subject.color}`}>{subject.short}</span><select value={subjectId} onChange={(event) => resetForSubject(event.target.value as SubjectId)} aria-label="Diagnostic subject">{subjects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><ChevronDown size={17} /></label>
        <button className="secondary-button exit-test" onClick={onExit}><LogOut size={17} /> Exit test</button>
      </header>

      <div className="diagnostic-workspace">
        <main className="question-area">
          <div className="question-progress-row"><span>Question <strong>{answers.length + 1}</strong> of {targetTotal}</span><span><Clock3 size={20} /><strong>{String(Math.floor(seconds / 60)).padStart(2, '0')}:{String(seconds % 60).padStart(2, '0')}</strong><small>time remaining</small></span></div>
          <div className="question-progress"><span style={{ width: `${Math.max(8, progress)}%` }} /></div>
          <div className="coverage-title">Evidence coverage <CircleHelp size={15} /></div>
          <div className="evidence-coverage">
            {moduleSignals.map((signal, index) => <div className={`coverage-node coverage-node--${signal.status}`} key={signal.module}><span>{signal.status === 'done' ? <Check size={13} /> : index + 1}</span><strong>{signal.module}</strong></div>)}
          </div>

          <article className="question-card">
            <p className="question-meta">{current.cognitive} · Difficulty {current.difficulty} · {current.los}</p>
            <h2>{current.stem}</h2>
            <div className="answer-list" role="radiogroup" aria-label="Answer choices">
              {current.options.map((option, index) => {
                const isSelected = selected === index
                const isCorrect = feedback && index === current.answer
                const isWrong = feedback === 'incorrect' && isSelected
                return (
                  <button
                    key={option}
                    role="radio"
                    aria-checked={isSelected}
                    className={`answer-row ${isSelected ? 'is-selected' : ''} ${isCorrect ? 'is-correct' : ''} ${isWrong ? 'is-wrong' : ''}`}
                    onClick={() => !feedback && setSelected(index)}
                  >
                    <span className="answer-letter">{String.fromCharCode(65 + index)}</span><span>{option}</span><span className="answer-radio">{isCorrect ? <Check size={16} /> : isWrong ? <X size={16} /> : null}</span>
                  </button>
                )
              })}
            </div>
            {feedback ? <div className={`answer-feedback answer-feedback--${feedback}`}><strong>{feedback === 'correct' ? 'Correct.' : 'Not quite.'}</strong> {current.optionFeedback?.[selected ?? 0] ?? current.rationale}{feedback === 'incorrect' ? <> <strong>Correct answer:</strong> {current.rationale}</> : null}</div> : null}
          </article>

          <div className="question-controls">
            <div className="confidence-control"><span>Confidence</span><div>{(['low', 'medium', 'high'] as Confidence[]).map((value) => <button key={value} className={confidence === value ? 'is-active' : ''} onClick={() => setConfidence(value)}>{value[0].toUpperCase() + value.slice(1)}</button>)}</div></div>
            <button className={`flag-button ${flagged ? 'is-active' : ''}`} onClick={() => setFlagged((value) => !value)}><Flag size={17} /> Flag for review</button>
          </div>
          <div className="question-actions"><button className="secondary-button" disabled={answers.length === 0} onClick={goBack}><ArrowLeft size={17} /> Back</button><span className="shortcut-hint">Press 1–3 to choose · Enter to submit</span><button className="primary-button submit-answer" data-submit-answer onClick={submit} disabled={selected === null}>{feedback ? 'Next question' : 'Submit answer'}</button></div>
        </main>

        <aside className="question-context">
          <ContextItem icon={<Target />} title="Why this question"><p>{current.why}</p></ContextItem>
          <ContextItem icon={<TrendingUp />} title="Your recent pattern"><p>{current.prerequisite ? `This depends on ${current.prerequisite}. The engine is checking whether the gap begins there.` : 'No prerequisite failure is currently dominating this module.'}</p></ContextItem>
          <ContextItem icon={<CircleHelp />} title="What happens next"><p>Your answer, confidence and misconception signal select the next unseen question. The engine never exposes or relies on hidden reasoning.</p></ContextItem>
          <div className="preserved-note"><ShieldCheck size={22} /><span><strong>Progress preserved</strong><small>You can exit at any time and return to this session.</small></span></div>
        </aside>
      </div>
    </div>
  )
}

function ContextItem({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return <section className="context-item"><div>{icon}<h3>{title}</h3></div>{children}</section>
}

function DiagnosticResult({ subjectId, answers, onExit, onRetry, onAccept }: { subjectId: SubjectId; answers: DiagnosticAnswer[]; onExit: () => void; onRetry: () => void; onAccept: () => void }) {
  const result = scoreDiagnostic(answers)
  const subject = subjects.find((item) => item.id === subjectId) ?? subjects[0]
  return (
    <div className="result-page page-content">
      <header className="page-header"><div><h1>Diagnostic complete</h1><p>{subject.name} · Review the evidence before adding it to your roadmap.</p></div></header>
      <div className="result-hero"><span className="result-score">{result.percent}<small>%</small></span><div><h2>{result.percent >= 70 ? 'Verified, with one area to retain.' : 'Useful signal. Repair before moving on.'}</h2><p>{result.correct} of {result.total} correct · {result.highConfidenceMisses} high-confidence misses</p></div></div>
      <div className="result-columns">
        <section><h3>Root-cause diagnosis</h3><strong>{result.weakest}</strong><p>Your next block should repair this module before another full diagnostic. The plan has not changed until you accept the proposal.</p></section>
        <section><h3>Proposed plan change</h3><div className="plan-diff"><span>+ 30 min</span><strong>{result.weakest} repair</strong><small>Tomorrow · replaces optional review</small></div><div className="plan-diff"><span>+ 2 probes</span><strong>Unseen re-verification</strong><small>48 hours after repair</small></div></section>
      </div>
      <div className="result-actions"><button className="secondary-button" onClick={onExit}>Keep result without change</button><button className="secondary-button" onClick={onRetry}>Retake draft</button><button className="primary-button" onClick={onAccept}>Accept plan and save evidence</button></div>
    </div>
  )
}

function DiagnosticEmpty({ subject, onExit }: { subject: string; onExit: () => void }) {
  return <div className="empty-state page-content"><CheckCircle2 size={42} /><h1>No unseen {subject} questions remain in this draft.</h1><p>The production bank will generate or retrieve a reviewed unseen form. This prototype will not repeat an item and pretend it is fresh evidence.</p><button className="primary-button" onClick={onExit}>Return to tests</button></div>
}
