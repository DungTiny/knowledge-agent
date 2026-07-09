import { stepCountIs, ToolLoopAgent, type StepResult, type ToolSet } from 'ai'
import type { LanguageModelV3 } from '@ai-sdk/provider'
import { DEFAULT_MODEL, buildProviderOptions } from '../router/schema'
import { ADMIN_SYSTEM_PROMPT } from '../prompts/chat'
import { compactContext } from '../core/context'
import { callOptionsSchema } from '../core/schemas'
import { sanitizeToolCallInputs } from '../core/sanitize'
import { resolveModelWrapper, resolveGatewayMetadata } from '../core/observe'
import type { AgentCallOptions, AgentExecutionContext } from '../types'

export interface AdminAgentOptions {
  tools: Record<string, unknown>
  /** Defaults to the built-in ADMIN_SYSTEM_PROMPT */
  systemPrompt?: string
  maxSteps?: number
  /**
   * Given a resolved model-id string, optionally return an already-built
   * LanguageModelV3 to use instead of resolving the id via the AI Gateway.
   */
  getLanguageModel?: (modelId: string) => Promise<LanguageModelV3 | undefined> | LanguageModelV3 | undefined

  onStepFinish?: (stepResult: any) => void

  onFinish?: (result: any) => void
}

export function createAdminAgent({
  tools,
  systemPrompt = ADMIN_SYSTEM_PROMPT,
  maxSteps = 15,
  getLanguageModel,
  onStepFinish,
  onFinish,
}: AdminAgentOptions) {
  const wrap = resolveModelWrapper()

  return new ToolLoopAgent({
    model: wrap(DEFAULT_MODEL),
    callOptionsSchema,
    prepareCall: async ({ options, ...settings }) => {
      const modelOverride = (options as AgentCallOptions | undefined)?.model
      const customContext = (options as AgentCallOptions | undefined)?.context
      const effectiveModel = modelOverride ?? DEFAULT_MODEL
      const customModel = await getLanguageModel?.(effectiveModel)

      const executionContext: AgentExecutionContext = {
        mode: 'admin',
        effectiveModel,
        maxSteps,
        customContext,
      }

      return {
        ...settings,
        model: wrap(customModel ?? effectiveModel),
        instructions: systemPrompt,
        tools,
        stopWhen: stepCountIs(maxSteps),
        providerOptions: customModel ? undefined : buildProviderOptions(effectiveModel, resolveGatewayMetadata()),
        experimental_context: executionContext,
      }
    },
    prepareStep: ({ messages, steps }) => {
      sanitizeToolCallInputs(messages)
      const normalizedSteps = (steps as StepResult<ToolSet>[] | undefined) ?? []
      const compactedMessages = compactContext({ messages, steps: normalizedSteps })
      if (compactedMessages !== messages) {
        return { messages: compactedMessages }
      }
    },
    onStepFinish,
    onFinish,
  })
}
