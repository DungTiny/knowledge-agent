<script setup lang="ts">
import type { PresentOrderUIToolInvocation } from '#shared/utils/tools/present-order'
import type { OrderLineItem } from '#shared/utils/uom'

const props = defineProps<{
  invocation: PresentOrderUIToolInvocation
  messageId: string
  readonly?: boolean
  busy?: boolean
}>()

const emit = defineEmits<{
  confirmed: [message: unknown]
  changeRequested: []
  resolutionRequested: [message: string]
}>()

const toast = useToast()
const route = useRoute()
const isConfirming = ref(false)
const isConfirmed = ref(false)

function formatVnd(value: number | null): string {
  if (value === null) return '—'
  return `${value.toLocaleString('vi-VN')} đ`
}

async function onConfirm() {
  if (isConfirming.value || isConfirmed.value) return
  isConfirming.value = true
  try {
    const message = await $fetch(`/api/chats/${route.params.id}/order-pdf`, {
      method: 'POST',
      body: {
        messageId: props.messageId,
        toolCallId: props.invocation.toolCallId,
      },
    })
    isConfirmed.value = true
    emit('confirmed', message)
  } catch (error) {
    const description = error && typeof error === 'object' && 'statusMessage' in error
      ? String((error as { statusMessage: string }).statusMessage)
      : 'Không tạo được bill, vui lòng thử lại'
    toast.add({ description, icon: 'i-lucide-alert-circle', color: 'error' })
  } finally {
    isConfirming.value = false
  }
}

function onChangeRequested() {
  emit('changeRequested')
}

function selectCandidate(item: OrderLineItem, candidate: NonNullable<OrderLineItem['candidates']>[number]) {
  emit('resolutionRequested', `Tôi xác nhận dòng ${item.lineId}: chọn ${candidate.productName} (${candidate.sku}), candidateId: ${candidate.candidateId}.`)
}

function confirmResolution(item: OrderLineItem, confirmation: NonNullable<OrderLineItem['confirmations']>[number]) {
  emit('resolutionRequested', `Tôi xác nhận dòng ${item.lineId}: ${confirmation.label}, confirmationId: ${confirmation.confirmationId}.`)
}
</script>

<template>
  <div v-if="invocation.state === 'output-available'" class="w-full max-w-2xl my-4 rounded-xl border border-default overflow-hidden">
    <div class="px-4 py-3 border-b border-default bg-muted/30">
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-receipt" class="size-5 text-highlighted shrink-0" />
        <h3 class="text-sm font-semibold text-highlighted truncate">
          Khách hàng: {{ invocation.output.customerName }}
          <span v-if="invocation.output.customerCode" class="text-muted font-normal">({{ invocation.output.customerCode }})</span>
        </h3>
      </div>
      <p v-if="invocation.output.customerNote" class="mt-1 text-xs text-muted">
        {{ invocation.output.customerNote }}
      </p>
    </div>

    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="text-left text-xs text-muted uppercase border-b border-default">
            <th class="px-3 py-2 font-medium">
              #
            </th>
            <th class="px-3 py-2 font-medium">
              Tên hàng
            </th>
            <th class="px-3 py-2 font-medium text-right">
              Đơn giá
            </th>
            <th class="px-3 py-2 font-medium text-right">
              Thành tiền
            </th>
          </tr>
        </thead>
        <tbody>
          <template v-for="(item, index) in invocation.output.items" :key="index">
            <tr class="border-b border-default last:border-b-0">
              <td class="px-3 py-2 text-muted">
                {{ index + 1 }}
              </td>
              <td class="px-3 py-2">
                {{ item.name }}
                <span v-if="item.quantity > 0" class="text-muted">x{{ item.quantity }} {{ item.unit }}</span>
                <span v-else-if="item.orderedQuantity != null && item.orderedUnit" class="text-muted">x{{ item.orderedQuantity }} {{ item.orderedUnit }}</span>
                <span v-if="item.quantity > 0 && item.orderedQuantity != null && item.orderedUnit" class="block text-xs text-muted">
                  Khách đặt: {{ item.orderedQuantity }} {{ item.orderedUnit }}
                </span>
              </td>
              <td class="px-3 py-2 text-right" :class="{ 'text-error': item.unitPrice === null }">
                {{ formatVnd(item.unitPrice) }}
              </td>
              <td class="px-3 py-2 text-right font-medium" :class="{ 'text-error': item.lineTotal === null }">
                {{ formatVnd(item.lineTotal) }}
              </td>
            </tr>
            <tr v-if="item.note" class="border-b border-default last:border-b-0">
              <td />
              <td colspan="3" class="px-3 pb-2 -mt-1 text-xs text-error">
                {{ item.note }}
              </td>
            </tr>
            <tr v-if="item.candidates?.length || item.confirmations?.length" class="border-b border-default last:border-b-0">
              <td />
              <td colspan="3" class="px-3 pb-3">
                <div v-if="item.candidates?.length" class="space-y-2">
                  <p class="text-xs font-medium text-highlighted">
                    Kế toán chọn sản phẩm phù hợp:
                  </p>
                  <UButton
                    v-for="candidate in item.candidates"
                    :key="candidate.candidateId"
                    color="neutral"
                    variant="soft"
                    size="xs"
                    class="w-full justify-start h-auto py-2"
                    :disabled="busy"
                    @click="selectCandidate(item, candidate)"
                  >
                    <span class="text-left whitespace-normal">
                      <span class="block font-medium">{{ candidate.productName }} ({{ candidate.sku }})</span>
                      <span class="block text-muted">
                        ĐVT {{ candidate.unit || 'chưa rõ' }} ·
                        {{ candidate.unitPrice != null ? formatVnd(candidate.unitPrice) : 'giá chưa rõ' }} ·
                        {{ candidate.rowDate || 'chưa rõ ngày' }}
                      </span>
                      <span class="block text-muted">
                        {{ candidate.reason }}
                      </span>
                    </span>
                  </UButton>
                </div>
                <div v-if="item.confirmations?.length" class="mt-2 space-y-2">
                  <p class="text-xs font-medium text-highlighted">
                    Kế toán xác nhận ĐVT/giá:
                  </p>
                  <UButton
                    v-for="confirmation in item.confirmations"
                    :key="confirmation.confirmationId"
                    :label="confirmation.label"
                    color="warning"
                    variant="soft"
                    size="xs"
                    class="w-full justify-start"
                    :disabled="busy"
                    @click="confirmResolution(item, confirmation)"
                  />
                  <p v-for="confirmation in item.confirmations" :key="`${confirmation.confirmationId}-reason`" class="text-xs text-muted">
                    {{ confirmation.reason }}
                  </p>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <div class="px-4 py-3 border-t border-default flex items-center justify-between text-sm">
      <span class="text-muted">Tổng số lượng: {{ invocation.output.totalQuantity }}</span>
      <span class="font-semibold text-highlighted">
        Tổng tiền hàng: {{ formatVnd(invocation.output.totalAmount) }}
        <span v-if="invocation.output.pendingCount > 0" class="text-error font-normal">
          (chưa gồm {{ invocation.output.pendingCount }} dòng chưa xác nhận)
        </span>
      </span>
    </div>

    <div v-if="!readonly" class="px-4 py-3 border-t border-default flex items-center gap-2">
      <template v-if="isConfirmed">
        <UIcon name="i-lucide-check-circle-2" class="size-4 text-success" />
        <span class="text-sm text-success">Đã lên bill, xem PDF bên dưới</span>
      </template>
      <template v-else>
        <UButton
          label="Đồng ý lên bill"
          icon="i-lucide-check"
          color="primary"
          :loading="isConfirming"
          :disabled="invocation.output.pendingCount > 0 || busy"
          @click="onConfirm"
        />
        <UButton
          label="Cần thay đổi"
          icon="i-lucide-pencil"
          color="neutral"
          variant="soft"
          :disabled="isConfirming || busy"
          @click="onChangeRequested"
        />
        <span v-if="invocation.output.pendingCount > 0" class="text-xs text-muted">
          Cần xác nhận hết các dòng còn thiếu trước khi lên bill
        </span>
        <span v-else-if="busy" class="text-xs text-muted">
          Đợi AI trả lời xong đã
        </span>
      </template>
    </div>
  </div>

  <div v-else-if="invocation.state === 'output-error'" class="my-4 rounded-xl border border-default p-4 text-sm text-muted">
    Không hiển thị được đơn hàng, vui lòng thử lại
  </div>

  <div v-else class="w-full max-w-2xl my-4 rounded-xl border border-default p-4 flex flex-col gap-2">
    <USkeleton class="w-1/3 h-4" />
    <USkeleton class="w-full h-24" />
    <USkeleton class="w-1/2 h-4" />
  </div>
</template>
