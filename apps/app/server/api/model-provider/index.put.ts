import { db, schema } from '@nuxthub/db'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { invalidateModelProviderConfigCache } from '../../utils/model-provider'

const bodySchema = z.object({
  label: z.string().min(1).max(60).optional(),
  baseUrl: z.string().url().nullable().optional(),
  apiKey: z.string().nullable().optional(), // blank/omitted => keep existing key
  modelId: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
})

/**
 * PUT /api/model-provider
 * Update the custom model provider configuration (admin only).
 */
export default defineEventHandler(async (event) => {
  const requestLog = useLogger(event)
  await requireAdmin(event)
  const body = await readValidatedBody(event, bodySchema.parse)

  requestLog.set({ fieldsChanged: Object.keys(body).filter(k => k !== 'apiKey') })

  const existing = await db.query.modelProviderConfig.findFirst({
    where: () => eq(schema.modelProviderConfig.isActive, true),
  })

  const apiKeyToStore = body.apiKey?.trim()
    ? body.apiKey.trim()
    : existing?.apiKey ?? null

  let config

  if (existing) {
    const [updated] = await db.update(schema.modelProviderConfig)
      .set({
        label: body.label ?? existing.label,
        baseUrl: body.baseUrl === undefined ? existing.baseUrl : body.baseUrl,
        apiKey: apiKeyToStore,
        modelId: body.modelId === undefined ? existing.modelId : body.modelId,
        enabled: body.enabled ?? existing.enabled,
        updatedAt: new Date(),
      })
      .where(eq(schema.modelProviderConfig.id, existing.id))
      .returning()
    config = updated
  } else {
    const [created] = await db.insert(schema.modelProviderConfig)
      .values({
        id: crypto.randomUUID(),
        label: body.label ?? 'Custom Provider',
        baseUrl: body.baseUrl ?? null,
        apiKey: apiKeyToStore,
        modelId: body.modelId ?? null,
        enabled: body.enabled ?? false,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning()
    config = created
  }

  await invalidateModelProviderConfigCache()

  requestLog.set({ modelProviderConfigId: config?.id, enabled: config?.enabled })

  const { apiKey, ...rest } = config!
  return { ...rest, hasApiKey: !!apiKey }
})
