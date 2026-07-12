import type { UIMessage } from 'ai'

const ORDER_INTENT_PATTERN = /\b(?:lên|len|tạo|tao|chốt|chot|đặt|dat)\s+(?:đơn|don|bill)\b|\bđơn\s+hàng\b|\border\b/i
const ITEM_SUFFIX_PATTERN = /\s+\d+(?:[.,]\d+)?\s*(?:hộp|hop|lon|hũ|hu|gói|goi|túi|tui|chai|lọ|lo|thùng|thung|lốc|loc|kg|gr|g|ml|lít|lit|cuộn|cuon|xâu|xau)\s*$/i

export interface OrderLookupRequest {
  customer: string
  products: string[]
}

function getLastUserText(messages: UIMessage[]): string {
  const message = [...messages].reverse().find(item => item.role === 'user')
  return message?.parts
    .filter((part): part is { type: 'text', text: string } => part.type === 'text')
    .map(part => part.text)
    .join('\n') ?? ''
}

export function parseOrderLookupRequest(messages: UIMessage[]): OrderLookupRequest | null {
  const text = getLastUserText(messages)
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  const products = lines
    .filter(line => ITEM_SUFFIX_PATTERN.test(line))
    .map(line => line.replace(ITEM_SUFFIX_PATTERN, '').trim())
    .filter(Boolean)

  // Itemized orders are structurally unambiguous and often pasted without a
  // leading "hãy lên đơn" sentence. Do not make deterministic order handling
  // depend on that optional phrase.
  if (!ORDER_INTENT_PATTERN.test(text) && products.length === 0) return null

  const customer = lines.findLast(line =>
    !ORDER_INTENT_PATTERN.test(line)
    && !ITEM_SUFFIX_PATTERN.test(line)
    && !/^done[.!]?$/i.test(line),
  )

  if (!customer || products.length === 0) return null
  return { customer, products: [...new Set(products)].slice(0, 10) }
}
