import { CUSTOM_MODEL_ID } from '#shared/utils/model-provider'

export function formatModelName(modelId: string): string {
  const acronyms = ['gpt'] // words that should be uppercase
  const modelName = modelId.split('/')[1] || modelId

  return modelName
    .split('-')
    .map((word) => {
      const lowerWord = word.toLowerCase()
      return acronyms.includes(lowerWord)
        ? word.toUpperCase()
        : word.charAt(0).toUpperCase() + word.slice(1)
    })
    .join(' ')
}

const BASE_MODELS = [
  'google/gemini-3-flash',
  'anthropic/claude-sonnet-4.6',
  'anthropic/claude-opus-4.6',
]

interface CustomModelPublicInfo {
  available: boolean
  label: string
}

export function useModels() {
  const model = useCookie<string>('model', { default: () => 'anthropic/claude-sonnet-4.6' })

  const customModel = useState<CustomModelPublicInfo | null>('custom-model-provider', () => null)

  const { data } = useLazyFetch<CustomModelPublicInfo>('/api/model-provider/public', {
    key: 'custom-model-provider-fetch',
  })
  watch(data, (v) => {
    if (v) customModel.value = v 
  }, { immediate: true })

  watch(customModel, (v) => {
    if (v && !v.available && model.value === CUSTOM_MODEL_ID) {
      model.value = 'anthropic/claude-sonnet-4.6'
    }
  })

  const models = computed(() => {
    return customModel.value?.available ? [...BASE_MODELS, CUSTOM_MODEL_ID] : BASE_MODELS
  })

  const customModelLabel = computed(() => customModel.value?.label || 'Custom')

  return {
    models,
    model,
    formatModelName,
    customModelLabel,
  }
}
