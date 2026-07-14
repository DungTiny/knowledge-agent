import type { UIMessage } from 'ai'

const ORDER_INTENT_PATTERN = /\b(?:lên|len|tạo|tao|chốt|chot|đặt|dat)\s+(?:đơn|don|bill)\b|\bđơn\s+hàng\b|\border\b/i
const UNIT_PATTERN = '(?:hộp|hop|lon|hũ|hu|gói|goi|túi|tui|bì|bi|bịch|bich|chai|lọ|lo|thùng|thung|lốc|loc|kg|gr|g|ml|lít|lit|cuộn|cuon|xâu|xau|cái|cai)'
const ITEM_SUFFIX_PATTERN = new RegExp(`\\s+\\d+(?:[.,]\\d+)?\\s*${UNIT_PATTERN}\\s*$`, 'i')
const ITEM_PREFIX_WITH_UNIT_PATTERN = new RegExp(`^\\d+(?:[.,]\\d+)?\\s*${UNIT_PATTERN}\\s+(.+)$`, 'i')
const ITEM_PREFIX_WITHOUT_UNIT_PATTERN = /^\d+(?:[.,]\d+)?\s*(.+)$/i
const INLINE_CUSTOMER_PATTERN = /\b(?:lên|len|tạo|tao|chốt|chot|đặt|dat)\s+(?:đơn|don|bill)\s+cho\s+(.+)$/i
const TERMINATOR_PATTERN = /^(?:done|kết\s+quả|ket\s+qua)[.!]?$/i

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
  const inlineCustomer = lines.map(line => line.match(INLINE_CUSTOMER_PATTERN)?.[1]?.trim()).find(Boolean)
  const itemSegments = lines.flatMap(line => line.split(/\s*\+\s*(?=\d)/).map(segment => segment.trim()))
  const explicitProduct = (line: string): string | null => {
    if (ITEM_SUFFIX_PATTERN.test(line)) return line.replace(ITEM_SUFFIX_PATTERN, '').trim() || null
    return line.match(ITEM_PREFIX_WITH_UNIT_PATTERN)?.[1]?.trim() || null
  }
  const looseProduct = (line: string): string | null =>
    line.match(ITEM_PREFIX_WITHOUT_UNIT_PATTERN)?.[1]?.trim() || null

  // A numeric customer/address such as "04 Trương Định" looks like a loose
  // quantity-first line. Only accept unitless quantity-first products when a
  // separate, clearly non-item customer line exists (as in "Anh Công Đức FB").
  const hasClearCustomer = Boolean(inlineCustomer) || lines.some(line =>
    !ORDER_INTENT_PATTERN.test(line)
    && !TERMINATOR_PATTERN.test(line)
    && !explicitProduct(line)
    && !looseProduct(line),
  )
  const productFromLine = (line: string): string | null =>
    explicitProduct(line) ?? (hasClearCustomer ? looseProduct(line) : null)
  const products = itemSegments.map(productFromLine).filter((product): product is string => Boolean(product))

  // Itemized orders are structurally unambiguous and often pasted without a
  // leading "hãy lên đơn" sentence. Do not make deterministic order handling
  // depend on that optional phrase.
  if (!ORDER_INTENT_PATTERN.test(text) && products.length === 0) return null

  const customer = inlineCustomer ?? lines.findLast(line =>
    !ORDER_INTENT_PATTERN.test(line)
    && !line.split(/\s*\+\s*(?=\d)/).some(segment => productFromLine(segment.trim()))
    && !TERMINATOR_PATTERN.test(line),
  )

  if (!customer || products.length === 0) return null
  return { customer, products: [...new Set(products)].slice(0, 50) }
}
