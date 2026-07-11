<script setup lang="ts">
definePageMeta({ auth: 'user' })

useSeoMeta({ title: 'New chat' })

const input = ref('')
const loading = ref(false)
const chatId = crypto.randomUUID()

const { model } = useModels()
const { mode } = useChatMode()

const {
  dropzoneRef,
  isDragging,
  files,
  isUploading,
  uploadedFiles,
  addFiles,
  removeFile,
  clearFiles
} = useFileUploadWithStatus(chatId)

async function createChat(prompt: string) {
  if (loading.value || isUploading.value || !prompt.trim()) return

  input.value = prompt
  loading.value = true

  const parts: Array<{ type: string, text?: string, mediaType?: string, url?: string }> = [{ type: 'text', text: prompt.trim() }]

  if (uploadedFiles.value.length > 0) {
    parts.push(...uploadedFiles.value)
  }

  try {
    const chat = await $fetch('/api/chats', {
      method: 'POST',
      body: {
        id: chatId,
        mode: mode.value,
        message: {
          role: 'user',
          parts
        }
      }
    })

    await refreshNuxtData('chats')
    await navigateTo(`/chat/${chat.id}`)
  } catch (error) {
    loading.value = false
    throw error
  }
}

async function onSubmit() {
  await createChat(input.value)
  clearFiles()
}

const adminQuickChats = [
  {
    label: 'Chart the daily token usage by model over the last 30 days',
    icon: 'i-custom-chart'
  },
  {
    label: 'Show app health: error rate, latency p95, and slowest endpoints',
    icon: 'i-lucide-activity'
  },
  {
    label: 'Are there any production errors in the last 24h? Show the trend',
    icon: 'i-lucide-alert-triangle'
  },
  {
    label: 'Chart active users and message volume over the last 14 days',
    icon: 'i-custom-users'
  },
  {
    label: 'What are the top 10 most-hit endpoints and their avg latency?',
    icon: 'i-lucide-zap'
  },
  {
    label: 'Show usage stats for the last 7 days with a cost breakdown chart',
    icon: 'i-lucide-coins'
  }
]

const quickChats = computed(() => mode.value === 'admin' ? adminQuickChats : [])
</script>

<template>
  <UDashboardPanel id="home" :ui="{ body: 'p-0 sm:p-0' }">
    <template #header>
      <DashboardNavbar />
    </template>

    <template #body>
      <DragDropOverlay :show="isDragging" />
      <UContainer ref="dropzoneRef" class="flex-1 flex flex-col justify-center gap-4 sm:gap-6 py-8">
        <h1 class="text-3xl sm:text-4xl text-highlighted font-semibold tracking-wide">
          Chào Mộc Trà!
        </h1>

        <UChatPrompt
          v-model="input"
          :disabled="isUploading || loading"
          class="[view-transition-name:chat-prompt]"
          variant="subtle"
          :ui="{ base: 'px-1.5' }"
          @submit="onSubmit"
        >
          <template v-if="files.length > 0" #header>
            <div class="flex flex-wrap gap-2">
              <FileAvatar
                v-for="fileWithStatus in files"
                :key="fileWithStatus.id"
                :name="fileWithStatus.file.name"
                :type="fileWithStatus.file.type"
                :preview-url="fileWithStatus.previewUrl"
                :status="fileWithStatus.status"
                :error="fileWithStatus.error"
                removable
                @remove="removeFile(fileWithStatus.id)"
              />
            </div>
          </template>

          <template #footer>
            <div class="flex items-center gap-1">
              <FileUploadButton @files-selected="addFiles($event)" />
              <ModelSelect v-model="model" />
            </div>

            <UChatPromptSubmit
              size="sm"
              :status="loading ? 'submitted' : 'ready'"
              :disabled="isUploading || loading"
            />
          </template>
        </UChatPrompt>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <UButton
            v-for="quickChat in quickChats"
            :key="quickChat.label"
            :icon="quickChat.icon"
            :label="quickChat.label"
            size="sm"
            color="neutral"
            variant="outline"
            @click="createChat(quickChat.label)"
          />
        </div>
      </UContainer>
    </template>
  </UDashboardPanel>
</template>
