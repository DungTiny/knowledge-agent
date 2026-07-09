<script setup lang="ts">
interface FileCardProps {
  name: string
  type: string
  url: string
}

const props = defineProps<FileCardProps>()

const extension = computed(() => {
  const idx = props.name.lastIndexOf('.')
  return idx > -1 ? props.name.slice(idx + 1).toUpperCase() : ''
})
</script>

<template>
  <div class="w-full max-w-2xl my-4 flex items-center gap-3 rounded-xl border border-default px-4 py-3">
    <a
      :href="url"
      target="_blank"
      rel="noopener noreferrer"
      class="group flex items-center gap-3 min-w-0 flex-1"
    >
      <span class="inline-flex items-center justify-center shrink-0 size-10 rounded-lg bg-elevated border border-default">
        <UIcon :name="getFileIcon(type, name)" class="size-5 text-muted" />
      </span>
      <div class="min-w-0 flex-1">
        <p class="text-sm font-medium text-highlighted truncate group-hover:underline">
          {{ name }}
        </p>
        <p v-if="extension" class="text-xs text-muted uppercase">
          {{ extension }}
        </p>
      </div>
    </a>
    <a
      :href="url"
      :download="name"
      :aria-label="`Tải về ${name}`"
      class="shrink-0 inline-flex items-center justify-center size-8 rounded-md text-muted hover:bg-elevated hover:text-highlighted transition-colors"
    >
      <UIcon name="i-lucide-download" class="size-4" />
    </a>
  </div>
</template>
