import { describe, expect, test } from 'bun:test'
import { createPresentOrderTool } from '../shared/utils/tools/present-order'
import type { OrderDraft } from '../shared/utils/uom'

const toolOptions = { toolCallId: 'call-1', messages: [] }

// The resolver's stored draft: matcha at its real history price.
const storedDraft: OrderDraft = {
  customerName: '18Grams Cafe',
  customerCode: 'FB_8074',
  items: [
    {
      name: 'Bột Matcha IMO 100gr',
      sku: '(ĐG-BB)mcha',
      orderedQuantity: 1,
      orderedUnit: 'gói',
      quantity: 1,
      unit: 'gói',
      unitConfirmed: true,
      unitPrice: 135_000,
      lineTotal: 135_000,
    },
  ],
  totalQuantity: 1,
  totalAmount: 135_000,
  pendingCount: 0,
}

// What the model actually sent in production: the same line with an invented price.
const tamperedInput = {
  draftId: '018f4f9d-0c63-7b24-bca0-22ddab56d5f1',
  customerName: '18Grams Cafe',
  customerCode: 'FB_8074',
  items: [
    {
      name: 'Bột Matcha IMO 100gr',
      sku: '(ĐG-BB)mcha',
      orderedQuantity: 1,
      orderedUnit: 'gói',
      quantity: 1,
      unit: 'gói',
      unitConfirmed: true,
      unitPrice: 150_000,
      lineTotal: 150_000,
    },
  ],
  totalQuantity: 1,
  totalAmount: 150_000,
  pendingCount: 0,
}

describe('present_order trust boundary', () => {
  // The bug: the model re-typed the resolver draft into present_order and invented
  // 150.000đ for matcha; the card rendered it because unitPrice was trusted.
  test('renders the stored resolver draft, ignoring a tampered model price', async () => {
    const presentOrder = createPresentOrderTool(draftId =>
      Promise.resolve(draftId === tamperedInput.draftId ? storedDraft : null))

    const result = await presentOrder.execute!(tamperedInput, toolOptions as never)

    expect(result.items[0]).toMatchObject({ unitPrice: 135_000, lineTotal: 135_000 })
    expect(result.totalAmount).toBe(135_000)
  })

  test('fails loudly when the draftId is unknown instead of trusting the model copy', () => {
    const presentOrder = createPresentOrderTool(() => Promise.resolve(null))

    expect(presentOrder.execute!(tamperedInput, toolOptions as never)).rejects.toThrow(/resolve_bill_order/)
  })

  test('without a draftId the legacy path still normalizes the model input', async () => {
    const presentOrder = createPresentOrderTool(() => Promise.resolve(storedDraft))
    const { draftId, ...legacyInput } = tamperedInput

    const result = await presentOrder.execute!(legacyInput, toolOptions as never)

    expect(result.items[0]).toMatchObject({ unitPrice: 150_000 })
    expect(result.totalAmount).toBe(150_000)
  })
})

describe('chat-memory provenance on the rendered card', () => {
  // ADR 0001: a branch resolved from chat memory carries a visible note; the
  // stored-draft render path must not drop it.
  test('customerNote on the stored draft survives rendering', async () => {
    const noted: OrderDraft = {
      ...storedDraft,
      customerNote: 'Dùng chi nhánh FB_8074 đã chọn trước đó trong chat',
    }
    const presentOrder = createPresentOrderTool(() => Promise.resolve(noted))

    const result = await presentOrder.execute!(tamperedInput, toolOptions as never)

    expect(result.customerNote).toContain('trong chat')
  })
})
