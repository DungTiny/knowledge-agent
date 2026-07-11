import { convertToModelMessages, createUIMessageStream, createUIMessageStreamResponse, pruneMessages, streamText, type UIMessage } from 'ai'
import { z } from 'zod'
import { db, schema } from '@nuxthub/db'
import { kv } from '@nuxthub/kv'
import { and, eq } from 'drizzle-orm'
import { createSavoir } from '@savoir/sdk'
import { useLogger } from 'evlog'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModelV3 } from '@ai-sdk/provider'
import { buildProviderOptions, createSourceAgent, createAdminAgent, resolveGatewayMetadata, setAIGatewayMetadata } from '@savoir/agent'
import { generateTitle } from '../../utils/chat/generate-title'
import { getAgentConfig } from '../../utils/agent-config'
import { getModelProviderConfig, isModelProviderConfigured } from '../../utils/model-provider'
import { KV_KEYS } from '../../utils/sandbox/types'
import { adminTools } from '../../utils/chat/admin-tools'
import { checkRateLimit, incrementRateLimit } from '../../utils/rate-limit'
import { CUSTOM_MODEL_ID } from '#shared/utils/model-provider'
import { presentOrderTool } from '#shared/utils/tools/present-order'
import { resolveOrderLineTool } from '#shared/utils/tools/resolve-order-line'

defineRouteMeta({
  openAPI: {
    description: 'Chat with AI about the available sources.',
    tags: ['ai'],
  },
})

async function getCustomChatModel(): Promise<LanguageModelV3 | undefined> {
  const config = await getModelProviderConfig()
  if (!isModelProviderConfigured(config)) return undefined
  const provider = createOpenAICompatible({ baseURL: config.baseUrl!, apiKey: config.apiKey!, name: 'custom' })
  return provider.chatModel(config.modelId!)
}

function resolveCustomLanguageModel(modelId: string): Promise<LanguageModelV3 | undefined> | undefined {
  if (modelId !== CUSTOM_MODEL_ID) return undefined
  return getCustomChatModel()
}

export default defineEventHandler(async (event) => {
  const requestLog = useLogger(event)
  const requestId = crypto.randomUUID().slice(0, 8)

  requestLog.set({
    requestId,
    path: '/api/chats/[id]',
    method: 'POST',
  })

  try {
    const { user } = await requireUserSession(event)
    requestLog.set({ userId: user.id })
    setAIGatewayMetadata({ userId: user.id, tags: ['web-chat'] })

    const { id } = await getValidatedRouterParams(event, z.object({
      id: z.string(),
    }).parse)
    requestLog.set({ chatId: id })

    const { model, messages } = await readValidatedBody(event, z.object({
      model: z.string(),
      messages: z.array(z.custom<UIMessage>()),
    }).parse)
    requestLog.set({ model, messageCount: messages.length })

    const chat = await db.query.chats.findFirst({
      where: () => and(
        eq(schema.chats.id, id as string),
        eq(schema.chats.userId, user.id),
      ),
      with: { messages: true },
    })
    if (!chat) {
      requestLog.error(new Error('Chat not found'))
      requestLog.set({ outcome: 'error' })
      throw createError({ statusCode: 404, statusMessage: 'Chat not found', data: { why: 'No chat exists with this ID for your user account', fix: 'Verify the chat ID is correct' } })
    }
    requestLog.set({ existingMessages: chat.messages.length, chatMode: chat.mode })

    const isAdminChat = chat.mode === 'admin'

    if (isAdminChat && user.role !== 'admin') {
      throw createError({ statusCode: 403, statusMessage: 'Admin access required', data: { why: 'This chat is in admin mode and requires the admin role', fix: 'Contact an administrator to be granted access' } })
    }

    let rateLimitInfo: { allowed: boolean, remaining: number, limit: number } | undefined
    if (user.role !== 'admin') {
      rateLimitInfo = await checkRateLimit(user.id)
      if (!rateLimitInfo.allowed) {
        throw createError({ statusCode: 429, statusMessage: 'Rate limit exceeded', data: { why: `You have reached the daily limit of ${rateLimitInfo.limit} messages`, fix: 'Wait until tomorrow or contact an administrator' } })
      }
    }

    const lastMessage = messages[messages.length - 1]
    if (lastMessage?.role === 'user' && messages.length > 1) {
      await db.insert(schema.messages).values({
        id: lastMessage.id,
        chatId: id as string,
        role: 'user',
        parts: lastMessage.parts,
      })
    }

    let effectiveModel = model

    const existingSessionId = await kv.get<string>(KV_KEYS.ACTIVE_SANDBOX_SESSION)
    if (existingSessionId) {
      requestLog.set({ sandboxSessionId: existingSessionId })
    }

    const cookie = getHeader(event, 'cookie')
    const savoir = createSavoir({
      apiUrl: getRequestURL(event).origin,
      headers: cookie ? { cookie } : undefined,
      sessionId: existingSessionId || undefined,
    })

    const agent = isAdminChat
      ? createAdminAgent({
        tools: adminTools,
        getLanguageModel: resolveCustomLanguageModel,
      })
      : createSourceAgent({
        tools: { ...savoir.tools, present_order: presentOrderTool, resolve_order_line: resolveOrderLineTool },
        getAgentConfig,
        messages,
        defaultModel: model,
        requestId,
        getLanguageModel: resolveCustomLanguageModel,
        getRouterModel: getCustomChatModel,
        onRouted: ({ routerConfig, agentConfig, effectiveModel: routedModel, effectiveMaxSteps }) => {
          effectiveModel = routedModel
          requestLog.set({
            routerComplexity: routerConfig.complexity,
            routerMaxSteps: routerConfig.maxSteps,
            effectiveMaxSteps,
            stepsMultiplier: agentConfig.maxStepsMultiplier,
            routerReasoning: routerConfig.reasoning,
          })
        },
      })

    const requestStartTime = Date.now()

    const abortController = new AbortController()
    event.node.res.once('close', () => {
      if (!event.node.res.writableFinished) {
        abortController.abort()
      }
    })

    const titleTask = (!chat.title && messages[0])
      ? generateTitle({
        firstMessage: messages[0],
        chatId: id as string,
        requestId,
      })
      : null

    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        const modelMessages = await convertToModelMessages(messages)
        const result = await agent.stream({
          messages: modelMessages,
          options: {},
          abortSignal: abortController.signal,
        })

        // Forward the agent stream ourselves so fallback output is guaranteed to
        // come after every tool chunk. The finish chunk is emitted only after we
        // know whether the agent produced user-visible output.
        for await (const part of result.toUIMessageStream({ sendFinish: false })) {
          writer.write(part)
        }

        const [resultText, steps, agentFinishReason] = await Promise.all([
          result.text,
          result.steps,
          result.finishReason,
        ])
        const hasPresentedOrder = steps.some(step =>
          step.toolCalls.some(call => call.toolName === 'present_order'),
        )

        let finalFinishReason = agentFinishReason

        // Some OpenAI-compatible models can ignore toolChoice:none and exhaust
        // the loop with finishReason=tool-calls. Never persist a blank assistant
        // message: make one final call with no tools and, if that also returns no
        // text, emit a deterministic user-facing failure message.
        if (!resultText.trim() && !hasPresentedOrder && !abortController.signal.aborted) {
          requestLog.set({ emptyAgentResponse: true, fallbackAttempted: true })

          const customFallbackModel = await resolveCustomLanguageModel(effectiveModel)
          const generatedMessages = steps.flatMap(step => step.response.messages)
          const fallbackMessages = pruneMessages({
            messages: [
              ...modelMessages,
              ...generatedMessages,
              {
                role: 'user',
                content: 'You have no tools available now. Give the user a concise final answer using only the search results above. Do not request or call tools. If an order cannot be completed from the available data, clearly state which items still need confirmation. Never return an empty response.',
              },
            ],
            reasoning: 'all',
            toolCalls: 'before-last-8-messages',
            emptyMessages: 'remove',
          })

          const fallback = streamText({
            model: customFallbackModel ?? effectiveModel,
            messages: fallbackMessages,
            abortSignal: abortController.signal,
            providerOptions: customFallbackModel
              ? undefined
              : buildProviderOptions(effectiveModel, resolveGatewayMetadata()),
          })

          for await (const part of fallback.toUIMessageStream({ sendStart: false, sendFinish: false })) {
            writer.write(part)
          }

          const fallbackText = await fallback.text
          finalFinishReason = await fallback.finishReason

          if (!fallbackText.trim()) {
            const textId = `fallback-${crypto.randomUUID()}`
            const fallbackMessage = 'Mình chưa thể hoàn tất đơn từ dữ liệu vừa tìm được. Vui lòng thử lại; nếu lỗi tiếp tục xảy ra, hãy kiểm tra cấu hình model hoặc dữ liệu bảng giá.'
            writer.write({ type: 'text-start', id: textId })
            writer.write({ type: 'text-delta', id: textId, delta: fallbackMessage })
            writer.write({ type: 'text-end', id: textId })
            finalFinishReason = 'stop'
          }
        }

        writer.write({ type: 'finish', finishReason: finalFinishReason })

        const title = await titleTask
        if (title) {
          writer.write({ type: 'data-chat-title', data: { title }, transient: true })
        }
      },
      onFinish: async ({ messages: responseMessages }) => {
        const dbStartTime = Date.now()
        const totalDurationMs = Date.now() - requestStartTime

        await db.insert(schema.messages).values(responseMessages.map((message: UIMessage) => ({
          id: message.id,
          chatId: chat.id,
          role: message.role as 'user' | 'assistant',
          parts: message.parts,
          ...(message.role === 'assistant' && {
            model: effectiveModel,
            durationMs: totalDurationMs,
          }),
        })))
        const dbDurationMs = Date.now() - dbStartTime

        if (!isAdminChat) {
          const currentSessionId = savoir.getSessionId()
          if (currentSessionId) {
            await kv.set(KV_KEYS.ACTIVE_SANDBOX_SESSION, currentSessionId)
          }
        }

        if (user.role !== 'admin') {
          await incrementRateLimit(user.id)
        }

        requestLog.set({
          outcome: 'success',
          responseMessageCount: responseMessages.length,
          dbInsertMs: dbDurationMs,
          totalDurationMs,
        })
      },
    })

    if (rateLimitInfo) {
      setHeader(event, 'X-RateLimit-Limit', String(rateLimitInfo.limit))
      setHeader(event, 'X-RateLimit-Remaining', String(rateLimitInfo.remaining - 1))
    }

    return createUIMessageStreamResponse({ stream })
  } catch (error) {
    requestLog.error(error instanceof Error ? error : new Error(String(error)))
    requestLog.set({ outcome: 'error' })
    throw error
  }
})
