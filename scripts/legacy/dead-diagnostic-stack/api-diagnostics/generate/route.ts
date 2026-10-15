import { NextResponse } from 'next/server'
import OpenAI from 'openai'
import { z } from 'zod'
import { createClient } from '../../../../lib/supabase/server'
import { diagnosticBlueprint, diagnosticGenerationContract } from '../../../../lib/diagnostics/blueprint'

const requestSchema = z.object({
  subjectId: z.enum(['fixed-income', 'quant', 'fsa', 'equity', 'ethics']),
  subjectName: z.string().min(2).max(100), modules: z.array(z.string().min(2).max(120)).min(1).max(12),
  moduleSize: z.enum(['small', 'medium', 'large']).default('medium'), demo: z.boolean().optional(),
})
const itemSchema = z.object({
  module: z.string().min(2).max(120), prerequisite: z.string().max(120).optional(), los: z.string().min(4).max(180),
  cognitive: z.enum(['recall', 'interpretation', 'calculation', 'judgment', 'transfer']), difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  stem: z.string().min(20).max(900), options: z.tuple([z.string().min(1), z.string().min(1), z.string().min(1)]), answer: z.number().int().min(0).max(2),
  rationale: z.string().min(12).max(900), optionFeedback: z.tuple([z.string().min(5), z.string().min(5), z.string().min(5)]),
  why: z.string().min(8).max(400), misconception: z.string().min(8).max(400),
})

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid diagnostic request.' }, { status: 400 })
  const input = parsed.data
  if (!(process.env.NODE_ENV !== 'production' && input.demo)) {
    const supabase = await createClient(); const { data } = await supabase.auth.getUser()
    if (!data.user) return NextResponse.json({ error: 'Sign in to generate a diagnostic.' }, { status: 401 })
  }
  if (!process.env.NVIDIA_API_KEY) return NextResponse.json({ error: 'Diagnostic generation is not configured.' }, { status: 503 })
  const count = diagnosticBlueprint.questionCount[input.moduleSize]
  const client = new OpenAI({ apiKey: process.env.NVIDIA_API_KEY, baseURL: process.env.NVIDIA_BASE_URL ?? 'https://integrate.api.nvidia.com/v1' })
  try {
    const completion = await client.chat.completions.create({
      model: process.env.NVIDIA_MODEL ?? 'nvidia/nemotron-3-super-120b-a12b', temperature: 0.25, max_tokens: 6000,
      messages: [
        { role: 'system', content: `${diagnosticGenerationContract}\nYou are creating an original diagnostic, not reproducing any provider or exam question. Accuracy is mandatory. Return JSON only: {"questions":[...]}. Each question needs module, optional prerequisite, los, cognitive, difficulty (1-3), stem, exactly 3 options, zero-based answer, rationale, exactly 3 optionFeedback strings, why, misconception. Across the form use approximately 20% foundation, 50% exam-standard and 30% difficult items; include missed-detail, misconception and indirect-application probes. Never mention CFA endorsement.` },
        { role: 'user', content: `Create ${count} questions for ${input.subjectName}. Approved modules: ${JSON.stringify(input.modules)}. Keep every module value exactly within that approved list. Use concise professional wording and realistic calculations or scenarios where appropriate.` },
      ],
    })
    const raw = completion.choices[0]?.message?.content ?? ''
    const match = raw.match(/\{[\s\S]*\}/)
    if (!match) throw new Error('No structured form returned')
    const decoded = JSON.parse(match[0])
    const validated = z.array(itemSchema).length(count).parse(decoded.questions)
    if (validated.some((item) => !input.modules.includes(item.module))) throw new Error('A generated item used an unapproved module')
    const questions = validated.map((item, index) => ({ ...item, id: `${input.subjectId}-live-${Date.now()}-${index}`, subject: input.subjectId }))
    return NextResponse.json({ questions, blueprint: { count, ...diagnosticBlueprint.format } })
  } catch (error) {
    console.error('Diagnostic generation failed', error)
    return NextResponse.json({ error: 'A quality-checked diagnostic form could not be generated. Please retry.' }, { status: 502 })
  }
}
