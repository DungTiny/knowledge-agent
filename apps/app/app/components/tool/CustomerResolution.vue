<script setup lang="ts">
import type { ResolveBillOrderUIToolInvocation } from '#shared/types/order-resolution'

const props = defineProps<{
  invocation: ResolveBillOrderUIToolInvocation
  busy?: boolean
}>()

const emit = defineEmits<{
  selected: [message: string]
}>()

const candidates = computed(() => props.invocation.output?.customer?.candidates ?? [])

function selectCandidate(candidate: { candidateId: string, code: string, name: string }) {
  emit('selected', `Tôi xác nhận khách hàng ${candidate.code} - ${candidate.name} (candidateId: ${candidate.candidateId}).`)
}
</script>

<template>
  <div
    v-if="invocation.state === 'output-available' && candidates.length > 0"
    class="w-full max-w-2xl my-4 rounded-xl border border-default p-4"
  >
    <div class="flex items-center gap-2 mb-3">
      <UIcon name="i-lucide-building-2" class="size-5 text-highlighted" />
      <div>
        <p class="text-sm font-semibold text-highlighted">
          Kế toán xác nhận đúng khách hàng
        </p>
        <p class="text-xs text-muted">
          Các mã dưới đây có cùng tên. Hệ thống sẽ không trộn lịch sử giữa các mã.
        </p>
      </div>
    </div>
    <div class="flex flex-wrap gap-2">
      <UButton
        v-for="candidate in candidates"
        :key="candidate.candidateId"
        :label="`${candidate.code} — ${candidate.name}`"
        color="neutral"
        variant="soft"
        :disabled="busy"
        @click="selectCandidate(candidate)"
      />
    </div>
  </div>
</template>
