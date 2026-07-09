import { getModelProviderConfig, isModelProviderConfigured } from '../../utils/model-provider'

/**
 * GET /api/model-provider/public
 * Minimal, non-secret info for the chat model dropdown. Any logged-in user.
 */
export default defineEventHandler(async (event) => {
  await requireUserSession(event)
  const config = await getModelProviderConfig()
  return { available: isModelProviderConfigured(config), label: config.label }
})
