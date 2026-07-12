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

const ORDER_INTENT_PATTERN = /\b(?:lên|len|tạo|tao|chốt|chot|đặt|dat)\s+(?:đơn|don|bill)\b|\bđơn\s+hàng\b|\border\b/i
const ORDER_LINE_PATTERN = /\b\d+(?:[.,]\d+)?\s*(?:hộp|hop|lon|hũ|hu|gói|goi|túi|tui|chai|lọ|lo|thùng|thung|lốc|loc|kg|gr|g|ml|lít|lit|cuộn|cuon|xâu|xau)\b/i
export const ORDER_WORKFLOW_REASON_PREFIX = 'Order workflow'

function inspectOrderShape(question: string): { isOrder: boolean, lineItemCount: number } {
  const lines = question.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  const lineItemCount = lines.filter(line => ORDER_LINE_PATTERN.test(line)).length
  const hasCustomerLine = lines.some(line =>
    !ORDER_LINE_PATTERN.test(line)
    && !ORDER_INTENT_PATTERN.test(line)
    && !/^done[.!]?$/i.test(line),
  )
  return {
    isOrder: ORDER_INTENT_PATTERN.test(question) || (lineItemCount > 0 && hasCustomerLine),
    lineItemCount,
  }
}

/**
 * Business workflows must not depend solely on the LLM classifier. Creating an
 * order requires customer/catalog lookup, one deterministic price calculation
 * per line, and a final present_order call, so an eight-step "simple" budget is
 * structurally insufficient for multi-line orders.
 */
export function applyRoutingGuardrails(question: string, config: AgentConfig): AgentConfig {
  const { isOrder, lineItemCount } = inspectOrderShape(question)
  if (!isOrder) return config

  const isLargeOrder = lineItemCount >= 5
  const minimumSteps = isLargeOrder ? 25 : 15

  return {
    ...config,
    complexity: config.maxSteps >= minimumSteps
      ? config.complexity
      : isLargeOrder ? 'complex' : 'moderate',
    maxSteps: Math.max(config.maxSteps, minimumSteps),
    reasoning: `${ORDER_WORKFLOW_REASON_PREFIX} with ${lineItemCount || 'unknown'} line items requires lookup, pricing, and confirmation`,
  }
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
      return applyRoutingGuardrails(question, getDefaultConfig())
    }

    output = applyRoutingGuardrails(question, output)
    log.info({ event: 'router.decision', requestId, complexity: output.complexity, model: output.model, maxSteps: output.maxSteps, reasoning: output.reasoning })
    return output
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    log.error({ event: 'router.failed', requestId, error: errorMessage })
    return applyRoutingGuardrails(question, getDefaultConfig())
  }
}
