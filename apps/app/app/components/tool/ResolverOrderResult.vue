<script setup lang="ts">
import type { PresentOrderUIToolInvocation } from '#shared/utils/tools/present-order'
import type { ResolveBillOrderUIToolInvocation } from '#shared/types/order-resolution'

const props = defineProps<{
  invocation: ResolveBillOrderUIToolInvocation
  messageId: string
  busy?: boolean
  hideOrder?: boolean
}>()

const emit = defineEmits<{
  confirmed: [message: unknown]
  changeRequested: []
  resolutionRequested: [message: string]
}>()

const orderInvocation = computed<PresentOrderUIToolInvocation | null>(() => {
  const draft = props.invocation.output?.orderDraft
  if (props.invocation.state !== 'output-available' || !draft) return null
  return {
    toolCallId: props.invocation.toolCallId,
    state: 'output-available',
    output: draft,
  } as PresentOrderUIToolInvocation
})
</script>

<template>
  <ToolOrderConfirmation
    v-if="orderInvocation && !hideOrder"
    :invocation="orderInvocation"
    :message-id
    :busy
    @confirmed="emit('confirmed', $event)"
    @change-requested="emit('changeRequested')"
    @resolution-requested="emit('resolutionRequested', $event)"
  />
  <ToolCustomerResolution
    v-else-if="!orderInvocation"
    :invocation
    :busy
    @selected="emit('resolutionRequested', $event)"
  />
</template>
