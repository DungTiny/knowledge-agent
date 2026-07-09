import { getModelProviderConfig } from '../../utils/model-provider'

/**
 * GET /api/model-provider
 * Read the custom model provider configuration (admin only). Never returns
 * the raw API key — only whether one is currently saved.
 */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const { apiKey, ...rest } = await getModelProviderConfig()
  return { ...rest, hasApiKey: !!apiKey }
})
