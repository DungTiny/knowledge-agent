import type { UIMessage } from 'ai'
import type { SavoirClient } from '@savoir/sdk'

const BILL_PATH = 'files/bill/BILL.md'
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
  if (!ORDER_INTENT_PATTERN.test(text)) return null

  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  const products = lines
    .filter(line => ITEM_SUFFIX_PATTERN.test(line))
    .map(line => line.replace(ITEM_SUFFIX_PATTERN, '').trim())
    .filter(Boolean)

  const customer = lines.findLast(line =>
    !ORDER_INTENT_PATTERN.test(line)
    && !ITEM_SUFFIX_PATTERN.test(line)
    && !/^done[.!]?$/i.test(line),
  )

  if (!customer || products.length === 0) return null
  return { customer, products: [...new Set(products)].slice(0, 10) }
}

function quoteShell(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`
}

export function buildOrderLookupCommands(request: OrderLookupRequest): string[] {
  const customerWords = request.customer.split(/\s+/).filter(Boolean)

  return request.products.map((product) => {
    const [firstCustomerWord, ...remainingCustomerWords] = customerWords
    const firstSearch = `grep -n -i -F ${quoteShell(firstCustomerWord ?? request.customer)} ${BILL_PATH}`
    const filters = [
      ...remainingCustomerWords,
      ...product.split(/\s+/).filter(Boolean),
    ].map(word => `grep -i -F ${quoteShell(word)}`)

    return [firstSearch, ...filters, 'head -20'].join(' | ')
  })
}

export async function preloadOrderContext(
  client: Pick<SavoirClient, 'bashBatch'>,
  request: OrderLookupRequest,
): Promise<string> {
  const commands = buildOrderLookupCommands(request)
  const response = await client.bashBatch(commands)
  const sections = response.results.map((result, index) => {
    const product = request.products[index] ?? `item ${index + 1}`
    const output = result.stdout.trim()
      || `[No matching row. ${result.stderr.trim() || `Command exited with ${result.exitCode}`}]`
    return `### ${product}\n${output}`
  })

  return `## Preloaded internal order context
Customer requested: ${request.customer}
Source: ${BILL_PATH}

The server already searched every requested product for this customer. Do not repeat file discovery or customer lookup. Use the rows below to resolve prices; any item without a matching row must be presented as PENDING.

${sections.join('\n\n')}`
}
