import { hasToolCall, stepCountIs, ToolLoopAgent, type StepResult, type ToolSet, type UIMessage } from 'ai'
import { log } from 'evlog'
import type { LanguageModelV3 } from '@ai-sdk/provider'
import { DEFAULT_MODEL, buildProviderOptions } from '../router/schema'
import { ORDER_WORKFLOW_REASON_PREFIX, routeQuestion } from '../router/route-question'
import { buildChatSystemPrompt } from '../prompts/chat'
import { applyComplexity } from '../prompts/shared'
import { compactContext } from '../core/context'
import { callOptionsSchema } from '../core/schemas'
import { sanitizeToolCallInputs } from '../core/sanitize'
import { countConsecutiveToolSteps, shouldForceTextOnlyStep } from '../core/policy'
import { webSearchTool } from '../tools/web-search'
import { resolveModelWrapper, resolveGatewayMetadata } from '../core/observe'
import type { AgentConfigData, AgentCallOptions, AgentExecutionContext, RoutingResult } from '../types'

export interface SourceAgentOptions {
  tools: ToolSet
  getAgentConfig: () => Promise<AgentConfigData>
  messages: UIMessage[]
  /** AI Gateway API key. Optional — falls back to OIDC on Vercel or AI_GATEWAY_API_KEY env var. */
  apiKey?: string
  requestId?: string
  /** Falls back to agentConfig.defaultModel then DEFAULT_MODEL */
  defaultModel?: string
  /**
   * Given a resolved model-id string, optionally return an already-built
   * LanguageModelV3 to use instead of resolving the id via the AI Gateway.
   */
  getLanguageModel?: (modelId: string) => Promise<LanguageModelV3 | undefined> | LanguageModelV3 | undefined
  /** Optionally supply a pre-built model to use for the router classification call, bypassing the AI Gateway ROUTER_MODEL. */
  getRouterModel?: () => Promise<LanguageModelV3 | undefined> | LanguageModelV3 | undefined
  onRouted?: (result: RoutingResult) => void
   
  onStepFinish?: (stepResult: any) => void
   
  onFinish?: (result: any) => void
}

function selectOrderTools(tools: ToolSet): ToolSet {
  const selected: ToolSet = {}
  for (const name of ['resolve_bill_order', 'present_order']) {
    const selectedTool = tools[name]
    if (selectedTool) selected[name] = selectedTool
  }
  return selected
}

export function createSourceAgent({
  tools,
  getAgentConfig,
  messages,
  apiKey,
  requestId,
  defaultModel = DEFAULT_MODEL,
  getLanguageModel,
  getRouterModel,
  onRouted,
  onStepFinish,
  onFinish,
}: SourceAgentOptions) {
  const id = requestId ?? crypto.randomUUID().slice(0, 8)
  let maxSteps = 15
  let isOrderWorkflow = false
  const wrap = resolveModelWrapper()
  const hasExistingOrder = messages.some(message => message.parts.some((part) => {
    const { type } = part as { type?: string }
    return type === 'tool-present_order' || type === 'tool-resolve_bill_order'
  }))

  return new ToolLoopAgent<AgentCallOptions, ToolSet>({
    model: wrap(DEFAULT_MODEL),
    callOptionsSchema,
    prepareCall: async ({ options, ...settings }) => {
      const modelOverride = (options as AgentCallOptions | undefined)?.model
      const customContext = (options as AgentCallOptions | undefined)?.context

      const [routerConfig, agentConfig] = await Promise.all([
        Promise.resolve(getRouterModel?.()).then(routerModel => routeQuestion(messages, id, apiKey, routerModel)),
        getAgentConfig(),
      ])

      const effectiveMaxSteps = Math.round(routerConfig.maxSteps * agentConfig.maxStepsMultiplier)
      const effectiveModel = modelOverride ?? agentConfig.defaultModel ?? defaultModel
      const customModel = await getLanguageModel?.(effectiveModel)
      isOrderWorkflow = routerConfig.reasoning.startsWith(ORDER_WORKFLOW_REASON_PREFIX) || hasExistingOrder
      const effectiveTools = isOrderWorkflow
        ? selectOrderTools(tools)
        : { ...tools, web_search: webSearchTool }

      maxSteps = effectiveMaxSteps
      onRouted?.({ routerConfig, agentConfig, effectiveModel, effectiveMaxSteps })

      const executionContext: AgentExecutionContext = {
        mode: 'chat',
        effectiveModel,
        maxSteps: effectiveMaxSteps,
        routerConfig,
        agentConfig,
        customContext,
      }

      return {
        ...settings,
        model: wrap(customModel ?? effectiveModel),
        instructions: applyComplexity(buildChatSystemPrompt(agentConfig), routerConfig),
        // Customer identities and negotiated prices are private sandbox data.
        // Web search cannot answer order workflows and caused fresh chats to
        // abandon BILL.md after one weak grep, so it is deliberately unavailable.
        tools: effectiveTools,
        // present_order renders an interactive card awaiting a real user click (Đồng ý lên
        // bill / Cần thay đổi). Its execute() resolves synchronously, so without this the
        // loop has no signal that it's a turn-ending, human-confirmation action — the model
        // can (and did) call it again in a later step, re-presenting an unchanged order with
        // new phrasing each time. Stop unconditionally the step after it's called.
        stopWhen: [stepCountIs(effectiveMaxSteps), hasToolCall('present_order')],
        providerOptions: customModel ? undefined : buildProviderOptions(effectiveModel, resolveGatewayMetadata()),
        experimental_context: executionContext,
      }
    },
    prepareStep: ({ stepNumber, messages: stepMessages, steps }) => {
      sanitizeToolCallInputs(stepMessages)
      const normalizedSteps = (steps as StepResult<ToolSet>[] | undefined) ?? []
      const compactedMessages = compactContext({ messages: stepMessages, steps: normalizedSteps })

      if (isOrderWorkflow) {
        const resolverCalls = normalizedSteps.reduce(
          (count, step) => count + step.toolCalls.filter(call => call.toolName === 'resolve_bill_order').length,
          0,
        )
        if (resolverCalls === 0 && 'resolve_bill_order' in tools) {
          return {
            activeTools: ['resolve_bill_order'],
            toolChoice: { type: 'tool' as const, toolName: 'resolve_bill_order' },
            ...(compactedMessages !== stepMessages ? { messages: compactedMessages } : {}),
          }
        }
        return {
          activeTools: ['present_order'].filter(name => name in tools),
          toolChoice: 'auto' as const,
          ...(compactedMessages !== stepMessages ? { messages: compactedMessages } : {}),
        }
      }

      if (shouldForceTextOnlyStep({ stepNumber, maxSteps, steps: normalizedSteps })) {
        log.info({ event: 'agent.force_text_step', step: stepNumber + 1, maxSteps, toolStreak: countConsecutiveToolSteps(normalizedSteps) })
        return {
          tools: {},
          toolChoice: 'none' as const,
          activeTools: [],
          ...(compactedMessages !== stepMessages ? { messages: compactedMessages } : {}),
        }
      }

      if (compactedMessages !== stepMessages) {
        return { messages: compactedMessages }
      }
    },
    onStepFinish,
    onFinish,
  })
}
