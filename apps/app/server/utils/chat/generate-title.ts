import type { UIMessage } from 'ai'
import { streamText } from 'ai'
import { db, schema } from '@nuxthub/db'
import { eq } from 'drizzle-orm'
import { log } from 'evlog'
import { ROUTER_MODEL, buildProviderOptions, resolveGatewayMetadata } from '@savoir/agent'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModelV3 } from '@ai-sdk/provider'
import { getModelProviderConfig, isModelProviderConfigured } from '../model-provider'

interface GenerateTitleOptions {
  firstMessage: UIMessage
  chatId: string
  requestId: string
}

async function resolveTitleModel(): Promise<{ model: LanguageModelV3, isCustom: boolean }> {
  const config = await getModelProviderConfig()
  if (isModelProviderConfigured(config)) {
    const provider = createOpenAICompatible({ baseURL: config.baseUrl!, apiKey: config.apiKey!, name: 'custom' })
    return { model: useAI().wrap(provider.chatModel(config.modelId!)), isCustom: true }
  }
  return { model: useAI().wrap(ROUTER_MODEL), isCustom: false }
}

export async function generateTitle({ firstMessage, chatId, requestId }: GenerateTitleOptions): Promise<string | null> {
  try {
    const { model, isCustom } = await resolveTitleModel()
    // streamText instead of generateText: custom OpenAI-compatible relays may only
    // support streaming responses (non-streaming returns non-standard JSON).
    const result = streamText({
      model,
      system: `Generate a short chat title (max 30 chars) from the user's message.
Rules: no quotes, no colons, no punctuation, plain text only.
If the message is a simple greeting (hi, hey, hello, etc.), respond with a generic title like "New conversation" or "Quick chat".`,
      prompt: JSON.stringify(firstMessage),
      providerOptions: isCustom ? undefined : buildProviderOptions(ROUTER_MODEL, resolveGatewayMetadata()),
    })
    const title = (await result.text).trim()

    await db.update(schema.chats).set({ title }).where(eq(schema.chats.id, chatId))
    log.info('chat', `${requestId} Title: ${title}`)
    return title
  } catch (error) {
    log.error('chat', `${requestId} Title generation failed: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}
