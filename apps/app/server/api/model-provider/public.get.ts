import { getModelProviderConfig, isModelProviderConfigured } from '../../utils/model-provider'

/**
 * GET /api/model-provider/public
 * Minimal, non-secret info for the chat model dropdown. Any logged-in user.
 */
export default defineEventHandler(async (event) => {
  await requireUserSession(event)
  const config = await getModelProviderConfig()
  // Chat always shows the custom provider as "AI" regardless of the admin label.
  return { available: isModelProviderConfigured(config), label: 'AI' }
})
