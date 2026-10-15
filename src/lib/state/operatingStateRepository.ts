import { SupabaseClient } from '@supabase/supabase-js'

export class OperatingStateRepository {
  constructor(private readonly supabase: SupabaseClient, private readonly userId: string) {}

  async getProfileAndExam() {
    const { data, error } = await this.supabase
      .from('profiles')
      .select('id, exam_date, exam_window_id, timezone, onboarding_status, class_pattern, week_availability_mode')
      .eq('id', this.userId)
      .maybeSingle()
    if (error) throw error
    return data
  }

  /**
   * The chosen sitting's own window, for an unregistered candidate: they have no exact date, but Home can
   * still show an honest indicative countdown against the sitting they picked rather than showing nothing.
   */
  async getExamWindow(examWindowId: string | null) {
    if (!examWindowId) return null
    const { data, error } = await this.supabase
      .from('exam_windows').select('window_opens, sitting, year').eq('id', examWindowId).maybeSingle()
    if (error) throw error
    return data
  }

  /** Whether a one-off "next known class" has been added yet — only meaningful for a variable class pattern. */
  async hasUpcomingOneOffClass() {
    const { data, error } = await this.supabase
      .from('calendar_commitments')
      .select('id')
      .eq('user_id', this.userId).eq('kind', 'class').eq('recurrence', 'none').eq('status', 'active')
      .gt('ends_at', new Date().toISOString())
      .limit(1)
    if (error) throw error
    return (data ?? []).length > 0
  }

  async getActiveRoadmap() {
    const { data, error } = await this.supabase
      .from('study_roadmaps')
      .select('id, status, target_date, route, phases')
      .eq('user_id', this.userId)
      .eq('status', 'active')
      .maybeSingle()
    if (error) throw error
    return data
  }

  async getActiveCycle() {
    const { data, error } = await this.supabase
      .from('planning_cycles')
      .select('id, starts_at_local, ends_at_local, status')
      .eq('user_id', this.userId)
      .eq('status', 'active')
      .maybeSingle()
    if (error) throw error
    return data
  }

  async getTodayBlocks(dateLocal: string) {
    const { data, error } = await this.supabase
      .from('plan_blocks')
      .select('id, title, detail, task_type, origin, duration_minutes, placement, starts_at, execution, revision')
      .eq('user_id', this.userId)
      .eq('local_date', dateLocal)
    if (error) throw error
    return data
  }

  /**
   * Commitments that actually occupy `dateLocal`. calendar_commitments has no
   * duration column: weekly series carry weekdays + start_time/end_time, and
   * one-offs carry starts_at/ends_at.
   */
  async getProtectedCommitments(dateLocal: string) {
    const { data, error } = await this.supabase
      .from('calendar_commitments')
      .select('id, label, kind, starts_at, ends_at, weekdays, start_time, end_time, recurrence, starts_on, ends_on')
      .eq('user_id', this.userId)
      .eq('status', 'active')
    if (error) throw error
    const weekday = new Date(`${dateLocal}T12:00:00Z`).getUTCDay()
    const minutes = (a?: string | null, b?: string | null) => {
      if (!a || !b) return 0
      const [ah, am] = a.slice(0, 5).split(':').map(Number); const [bh, bm] = b.slice(0, 5).split(':').map(Number)
      return Math.max(0, (bh * 60 + bm) - (ah * 60 + am))
    }
    return (data ?? []).flatMap((c: any) => {
      if (c.recurrence === 'weekly' || (c.weekdays?.length ?? 0) > 0) {
        if (!(c.weekdays ?? []).includes(weekday)) return []
        if (c.starts_on && dateLocal < c.starts_on) return []
        if (c.ends_on && dateLocal > c.ends_on) return []
        return [{ ...c, duration_minutes: minutes(c.start_time, c.end_time) }]
      }
      if (!c.starts_at || String(c.starts_at).slice(0, 10) !== dateLocal) return []
      const d = c.ends_at ? Math.round((new Date(c.ends_at).getTime() - new Date(c.starts_at).getTime()) / 60000) : 0
      return [{ ...c, duration_minutes: Math.max(0, d) }]
    })
  }

  async getCycleBlocks(cycleId: string) {
    const { data, error } = await this.supabase
      .from('plan_blocks')
      .select('id, title, detail, task_type, origin, duration_minutes, placement, starts_at, execution, revision, local_date')
      .eq('user_id', this.userId)
      .eq('cycle_id', cycleId)
    if (error) throw error
    return data
  }

  async getTaskEvents(blockIds: string[]) {
    if (blockIds.length === 0) return []
    const { data, error } = await this.supabase
      .from('task_events')
      .select('*')
      .eq('user_id', this.userId)
      .in('task_id', blockIds)
    if (error) throw error
    return data
  }

  /**
   * Recent valid, evidence-mode observations. evidence_events has no
   * sample_size or confidence_mismatch column — both are derived here from the
   * rows themselves (a concept's sample is its valid observations in this
   * window; a mismatch is a confident wrong answer or an unsure right one).
   */
  async getRecentEvidence() {
    const { data, error } = await this.supabase
      .from('evidence_events')
      .select('concept_id, evidence_state, is_correct, self_reported_confidence, created_at, concept:curriculum_concepts(name)')
      .eq('user_id', this.userId)
      .eq('validity', 'valid')
      .eq('evidence_mode', 'evidence')
      .order('created_at', { ascending: false })
      .limit(200)
    if (error) throw error
    const rows = (data ?? []) as any[]
    const byConcept = new Map<string, any[]>()
    for (const r of rows) {
      if (!r.concept_id) continue
      byConcept.set(r.concept_id, [...(byConcept.get(r.concept_id) ?? []), r])
    }
    return [...byConcept.values()].map(list => {
      const latest = list[0]
      return {
        concept_id: latest.concept_id as string,
        concept_name: (latest.concept?.name ?? undefined) as string | undefined,
        evidence_state: (latest.evidence_state === 'insufficient' ? 'stale' : latest.evidence_state) as 'supported' | 'unstable' | 'needs_repair' | 'stale',
        sample_size: list.length,
        confidence_mismatch: list.some(e =>
          (e.is_correct === false && e.self_reported_confidence != null && e.self_reported_confidence >= 4) ||
          (e.is_correct === true && e.self_reported_confidence != null && e.self_reported_confidence <= 2)),
        created_at: latest.created_at as string,
      }
    })
  }

  async getOpenRepairs() {
    const { data, error } = await this.supabase
      .from('repair_threads')
      .select('id, concept_id, created_at')
      .eq('user_id', this.userId)
      .in('status', ['open', 'proposed'])
    if (error) throw error
    return data
  }

  async getCoachProposals() {
    const { data, error } = await this.supabase
      .from('coach_proposals')
      .select('id, intent, reasoning')
      .eq('user_id', this.userId)
      .eq('status', 'pending')
    if (error) throw error
    // The table stores intent + reasoning; there is no title/summary column.
    return (data ?? []).map((p: any) => ({
      id: p.id as string,
      title: String(p.intent ?? 'proposal').replace(/_/g, ' ').replace(/^./, (c: string) => c.toUpperCase()),
      summary: (p.reasoning ?? '') as string,
    }))
  }

  async getLatestPlanDraft() {
    const { data, error } = await this.supabase
      .from('plan_drafts')
      .select('id, status, revision')
      .eq('user_id', this.userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw error
    return data
  }

  // Add more specific queries as needed
}
