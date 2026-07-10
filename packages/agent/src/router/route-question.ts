import { generateText, streamText, Output } from 'ai'
import type { UIMessage } from 'ai'
import type { LanguageModelV3 } from '@ai-sdk/provider'
import { log } from 'evlog'
import { ROUTER_SYSTEM_PROMPT } from '../prompts/router'
import { resolveModelWrapper, resolveGatewayMetadata } from '../core/observe'
import { type AgentConfig, agentConfigSchema, getDefaultConfig, buildProviderOptions, ROUTER_MODEL } from './schema'

const JSON_OUTPUT_INSTRUCTION = `

## Output Format
Respond with ONLY a JSON object (no markdown fences, no prose) with exactly these fields:
{"complexity": "trivial" | "simple" | "moderate" | "complex", "maxSteps": <number 1-30>, "model": "google/gemini-3-flash" | "anthropic/claude-sonnet-4.6" | "anthropic/claude-opus-4.6", "reasoning": "<brief explanation, max 200 chars>"}`

function extractJsonObject(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/g, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end <= start) throw new Error('No JSON object in router response')
  return JSON.parse(cleaned.slice(start, end + 1))
}

function extractQuestionFromMessages(messages: UIMessage[]): string {
  const lastUserMessage = [...messages].reverse().find(m => m.role === 'user')
  if (!lastUserMessage) return ''

  const textParts = lastUserMessage.parts
    ?.filter((p): p is { type: 'text', text: string } => p.type === 'text')
    .map(p => p.text)
    .join('\n')

  return textParts || ''
}

export async function routeQuestion(
  messages: UIMessage[],
  requestId: string,
  apiKey?: string,
  customModel?: LanguageModelV3,
): Promise<AgentConfig> {
  const wrap = resolveModelWrapper()
  const model = wrap(customModel ?? ROUTER_MODEL)

  const question = extractQuestionFromMessages(messages)
  if (!question) {
    log.info({ event: 'router.no_question', requestId })
    return getDefaultConfig()
  }

  try {
    let output: AgentConfig | undefined

    if (customModel) {
      // Custom OpenAI-compatible endpoints may not support non-streaming responses
      // or JSON-schema response formats, so stream plain text and parse manually.
      const result = streamText({
        model,
        messages: [
          { role: 'system', content: ROUTER_SYSTEM_PROMPT + JSON_OUTPUT_INSTRUCTION },
          { role: 'user', content: `Question: ${question}` },
        ],
      })
      const text = await result.text
      output = agentConfigSchema.parse(extractJsonObject(text))
    } else {
      const { output: gatewayOutput } = await generateText({
        model,
        output: Output.object({ schema: agentConfigSchema }),
        messages: [
          { role: 'system', content: ROUTER_SYSTEM_PROMPT },
          { role: 'user', content: `Question: ${question}` },
        ],
        providerOptions: buildProviderOptions(ROUTER_MODEL, resolveGatewayMetadata()),
      })
      output = gatewayOutput
    }

    if (!output) {
      log.warn({ event: 'router.no_output', requestId })
      return getDefaultConfig()
    }

    log.info({ event: 'router.decision', requestId, complexity: output.complexity, model: output.model, maxSteps: output.maxSteps, reasoning: output.reasoning })
    return output
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    log.error({ event: 'router.failed', requestId, error: errorMessage })
    return getDefaultConfig()
  }
}
