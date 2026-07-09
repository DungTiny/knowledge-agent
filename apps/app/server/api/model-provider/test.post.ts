import { generateText } from 'ai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { z } from 'zod'
import { getModelProviderConfig } from '../../utils/model-provider'

const bodySchema = z.object({
  baseUrl: z.string().url(),
  apiKey: z.string().optional(), // blank => use the currently saved key
  modelId: z.string().min(1),
})

/**
 * POST /api/model-provider/test
 * Try a real, minimal completion against the given (or currently saved)
 * provider config, without persisting anything. Admin only.
 */
export default defineEventHandler(async (event) => {
  const requestLog = useLogger(event)
  await requireAdmin(event)
  const body = await readValidatedBody(event, bodySchema.parse)

  let apiKey = body.apiKey?.trim()
  if (!apiKey) {
    apiKey = (await getModelProviderConfig()).apiKey ?? undefined
  }
  if (!apiKey) {
    throw createError({ statusCode: 400, statusMessage: 'API key required', data: { why: 'No API key was provided and none is saved yet', fix: 'Enter an API key to test' } })
  }

  const provider = createOpenAICompatible({ baseURL: body.baseUrl, apiKey, name: 'custom-test' })
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)

  try {
    const result = await generateText({
      model: provider.chatModel(body.modelId),
      prompt: 'Reply with exactly: ok',
      maxOutputTokens: 16,
      abortSignal: controller.signal,
    })
    return { ok: true, sample: result.text.trim().slice(0, 100) }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    requestLog.set({ testConnectionError: message })
    throw createError({ statusCode: 502, statusMessage: 'Connection test failed', data: { why: message, fix: 'Check the base URL, API key, and model ID' } })
  } finally {
    clearTimeout(timeout)
  }
})
