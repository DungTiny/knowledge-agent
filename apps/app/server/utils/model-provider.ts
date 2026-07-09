import { kv } from '@nuxthub/kv'
import { db, schema } from '@nuxthub/db'
import { eq } from 'drizzle-orm'
import { KV_KEYS } from './sandbox/types'

export interface ModelProviderConfig {
  id: string
  label: string
  baseUrl: string | null
  apiKey: string | null
  modelId: string | null
  enabled: boolean
}

const DEFAULT_CONFIG: ModelProviderConfig = {
  id: 'default',
  label: 'Custom Provider',
  baseUrl: null,
  apiKey: null,
  modelId: null,
  enabled: false,
}

const CACHE_TTL_SECONDS = 60

export async function invalidateModelProviderConfigCache(): Promise<void> {
  await kv.del(KV_KEYS.MODEL_PROVIDER_CONFIG_CACHE)
}

export async function getModelProviderConfig(): Promise<ModelProviderConfig> {
  const cached = await kv.get<ModelProviderConfig>(KV_KEYS.MODEL_PROVIDER_CONFIG_CACHE)
  if (cached) {
    return cached
  }

  const config = await db.query.modelProviderConfig.findFirst({
    where: () => eq(schema.modelProviderConfig.isActive, true),
  })

  const result: ModelProviderConfig = config
    ? {
      id: config.id,
      label: config.label || 'Custom Provider',
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      modelId: config.modelId,
      enabled: config.enabled,
    }
    : DEFAULT_CONFIG

  await kv.set(KV_KEYS.MODEL_PROVIDER_CONFIG_CACHE, result, { ttl: CACHE_TTL_SECONDS })

  return result
}

export function isModelProviderConfigured(config: ModelProviderConfig): boolean {
  return config.enabled && !!config.baseUrl && !!config.apiKey && !!config.modelId
}
