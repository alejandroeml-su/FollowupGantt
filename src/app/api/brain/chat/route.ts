import { convertToModelMessages, streamText, stepCountIs, type UIMessage } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { brainTools } from '@/lib/brain/tools'
import { BRAIN_SYSTEM_PROMPT } from '@/lib/brain/system-prompt'

export const maxDuration = 30

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: 'ANTHROPIC_API_KEY no está configurada en el entorno.' },
      { status: 503 },
    )
  }

  const { messages }: { messages: UIMessage[] } = await req.json()

  const result = streamText({
    model: anthropic('claude-sonnet-4-6'),
    system: BRAIN_SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
    tools: brainTools,
    stopWhen: stepCountIs(6),
  })

  return result.toUIMessageStreamResponse()
}
