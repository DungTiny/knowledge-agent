import { parsePackSpec, parseSizedUnit, resolveOrderLine, unitFromProductName, unitsEquivalent } from '../../../shared/utils/uom'

export const BILL_STATIC_DATE = '31/12/2026'

const BILL_HEADERS = [
  'Mã khách hàng',
  'Tên khách hàng',
  'Bảng giá',
  'Mã hàng',
  'Tên hàng',
  'ĐVT',
  'Thời gian',
  'Số lượng',
  'Đơn giá',
  'Giảm giá',
  'Giá bán',
  'Ghi chú hàng hóa',
] as const

type BillHeader = typeof BILL_HEADERS[number]

export interface BillRow extends Record<BillHeader, string> {
  rowNumber: number
}

export interface BillIndex {
  rows: BillRow[]
  customers: Array<{ code: string, name: string }>
}

export interface RequestedOrderItem {
  lineId: string
  rawName: string
  requestedQuantity: number
  requestedUnit: string
}

const LEADING_ORDER_UNIT_PATTERN = /^(?:hộp|hop|hũ|hu|gói|goi|túi|tui|bịch|bich|bì|bi|chai|lọ|lo|thùng|thung|lốc|loc|lạng|lang|kg|gr|g|ml|lít|lit|cuộn|cuon|xâu|xau|cái|cai|lon)(?=\s|$)/iu
const ATTACHED_PRODUCT_SHORTHAND_PATTERN = /^(?:siro|srio|sto|ong|puding|richs?|base)(?=\s|$)/iu

/**
 * Models occasionally copy the complete quantity clause into rawName even
 * though quantity and unit have their own fields (for example
 * `1bi bột matcha`). Normalize that transport error at the server boundary so
 * product lookup remains deterministic. A compact product name such as `3Q
 * Trân Châu` is preserved because `Q` is neither a unit nor a known shorthand.
 */
export function normalizeRequestedOrderItem(item: RequestedOrderItem): RequestedOrderItem {
  const rawName = item.rawName.trim()
  const quantityPrefix = rawName.match(/^(\d+(?:[.,]\d+)?)(\s*)/u)
  if (!quantityPrefix) return { ...item, rawName }

  const parsedQuantity = Number(quantityPrefix[1]!.replace(',', '.'))
  if (!Number.isFinite(parsedQuantity) || Math.abs(parsedQuantity - item.requestedQuantity) > 1e-9) {
    return { ...item, rawName }
  }

  let productName = rawName.slice(quantityPrefix[0].length).trimStart()
  const quantityWasSeparated = quantityPrefix[2]!.length > 0
  const startsWithUnit = LEADING_ORDER_UNIT_PATTERN.test(productName)
  const startsWithKnownShorthand = ATTACHED_PRODUCT_SHORTHAND_PATTERN.test(productName)
  if (!quantityWasSeparated && !startsWithUnit && !startsWithKnownShorthand) {
    return { ...item, rawName }
  }

  const unitPrefix = productName.match(LEADING_ORDER_UNIT_PATTERN)
  if (unitPrefix) productName = productName.slice(unitPrefix[0].length).trimStart()

  const requestedUnit = item.requestedUnit.trim() || unitPrefix?.[0] || ''
  return productName ? { ...item, rawName: productName, requestedUnit } : { ...item, rawName }
}

export interface BillOrderSelection {
  lineId: string
  candidateId: string
}

export interface BillOrderConfirmation {
  lineId: string
  confirmationId: string
}

/**
 * Chat-scoped confirmation memory (ADR 0001): staff confirmations from earlier
 * drafts in the same chat, reusable by later drafts of that chat only. BILL.md
 * evidence always beats this memory — it only fills gaps the data leaves open.
 */
export interface ChatOrderMemory {
  /** canonical customer query → branch the staff picked. */
  customerSelections: Array<{ queryKey: string, customerCode: string }>
  /** Staff shorthand → product, valid for one customer only. */
  productAliases: Array<{ customerCode: string, aliasKey: string, productKey: string }>
  /**
   * `requested-1to1`: catalog had no ĐVT, staff's requested unit is the unit.
   * `requested-equals-catalog`: 1 requested unit = 1 catalog unit, valid only
   * while the catalog unit still equals `catalogUnitKey`.
   */
  unitMappings: Array<{
    productKey: string
    requestedUnitKey: string
    kind: 'requested-1to1' | 'requested-equals-catalog'
    catalogUnitKey?: string
  }>
  /** Approved price values; a different computed price invalidates the entry. */
  priceConfirmations: Array<{ customerCode: string, productKey: string, price: number }>
}

export function emptyChatOrderMemory(): ChatOrderMemory {
  return { customerSelections: [], productAliases: [], unitMappings: [], priceConfirmations: [] }
}

export interface ResolveBillOrderRequest {
  draftId: string
  customerQuery: string
  items: RequestedOrderItem[]
  selections?: BillOrderSelection[]
  confirmations?: BillOrderConfirmation[]
  chatMemory?: ChatOrderMemory
}

export type BillLineStatus =
  | 'resolved'
  | 'needs_product_confirmation'
  | 'needs_unit_confirmation'
  | 'needs_price_confirmation'
  | 'not_found'

export interface ResolvedBillLine {
  lineId: string
  status: BillLineStatus
  request: RequestedOrderItem
  matched?: { sku: string, canonicalSku: string, productName: string }
  evidence: {
    selectionSource?: 'positive_history' | 'static_price' | 'staff_confirmation' | 'chat_memory'
    priceSource?: 'latest_positive_history' | 'static_price' | 'global_reference'
    unitSource?: 'history' | 'history_quantity_pattern' | 'static_price' | 'global_reference' | 'business_override' | 'product_name' | 'positive_history' | 'implicit_each' | 'staff_confirmation' | 'chat_memory'
    rowDates: string[]
  }
  candidates: Array<{ candidateId: string, sku: string, productName: string, reason: string }>
  confirmations: Array<{ confirmationId: string, kind: 'unit' | 'price', label: string, reason: string }>
  resolved?: { quantity: number, unit: string, catalogPrice: number, unitPrice: number, lineTotal: number, unitConfirmed?: boolean }
  warning?: string
}

export interface ResolvedOrderDraft {
  customerName: string
  customerCode?: string
  /** Provenance shown to staff when the branch came from chat memory. */
  customerNote?: string
  items: Array<{
    name: string
    sku?: string
    orderedQuantity: number
    orderedUnit: string
    quantity: number
    unit: string
    unitConfirmed?: boolean
    unitPrice: number | null
    lineTotal: number | null
    note?: string
  }>
  totalQuantity: number
  totalAmount: number
  pendingCount: number
}

export interface ResolveBillOrderOutput {
  resolutionStatus: 'resolved' | 'needs_confirmation'
  draftId: string
  source: { path: 'files/bill/BILL.md', rowCount: number, snapshotId?: string }
  customer: {
    status: 'resolved' | 'ambiguous' | 'not_found'
    code?: string
    name?: string
    candidates: Array<{ candidateId: string, code: string, name: string }>
  }
  lines: ResolvedBillLine[]
  orderDraft: ResolvedOrderDraft | null
}

const BUSINESS_UNIT_OVERRIDES = [
  { productTokens: ['thach', 'agar', 'chuandai'], unit: 'Túi 3.05Kg' },
  // BILL has no ĐVT for this utensil, while "cái" is its unambiguous count unit.
  { productTokens: ['vot', 'muc', 'tran', 'chau'], unit: 'Cái' },
]

const PLAIN_UNITS = new Set([
  'hop',
  'lon',
  'hu',
  'goi',
  'tui',
  'chai',
  'lo',
  'thung',
  'loc',
  'lang',
  'kg',
  'g',
  'gr',
  'ml',
  'l',
  'lit',
  'bi',
  'bich',
  'banh',
  'phong',
  'cuon',
  'xau',
])

export function normalizeBillText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function tokens(value: string): string[] {
  return normalizeBillText(value).split(/\s+/).filter(Boolean)
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}

function parseNumber(value: string): number | null {
  if (!/^-?\d+(?:[.,]\d+)?$/.test(value.trim())) return null
  const parsed = Number(value.replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

function parseDate(value: string): number {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!match) return 0
  return Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1]))
}

function rowKey(row: BillRow): string {
  return BILL_HEADERS.map(header => row[header]).join('\u001f')
}

function dedupeRows(rows: BillRow[]): BillRow[] {
  const seen = new Set<string>()
  return rows.filter((row) => {
    const key = rowKey(row)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function parseBillMarkdown(markdown: string): BillIndex {
  const tableLines = markdown
    .split(/\r?\n/)
    .map((line, index) => ({ line, rowNumber: index + 1 }))
    .filter(({ line }) => line.startsWith('|') && !line.startsWith('|:'))

  if (tableLines.length === 0) throw new Error('BILL.md does not contain a Markdown table')

  const headers = tableLines[0]!.line.split('|').slice(1, -1).map(value => value.trim())
  if (headers.length !== BILL_HEADERS.length || BILL_HEADERS.some((header, index) => headers[index] !== header)) {
    throw new Error(`BILL.md header mismatch: expected ${BILL_HEADERS.join(', ')}`)
  }

  const parsedRows = tableLines.slice(1).map(({ line, rowNumber }): BillRow => {
    const values = line.split('|').slice(1, -1).map(value => value.trim())
    if (values.length !== BILL_HEADERS.length) {
      throw new Error(`Malformed BILL.md row ${rowNumber}: expected ${BILL_HEADERS.length} columns, got ${values.length}`)
    }
    return {
      rowNumber,
      ...Object.fromEntries(BILL_HEADERS.map((header, index) => [header, values[index] ?? ''])),
    } as BillRow
  })

  const rows = dedupeRows(parsedRows)
  const customerMap = new Map<string, { code: string, name: string }>()
  for (const row of rows) {
    const code = row['Mã khách hàng']
    const name = row['Tên khách hàng']
    if (code && name) customerMap.set(`${code}\u001f${name}`, { code, name })
  }

  return { rows, customers: [...customerMap.values()] }
}

function customerCandidateId(code: string): string {
  return `customer:${encodeURIComponent(code)}`
}

function productCandidateId(lineId: string, productName: string): string {
  return `product:${encodeURIComponent(lineId)}:${encodeURIComponent(normalizeBillText(productName))}`
}

function canonicalSku(sku: string): string {
  const stripped = sku.replace(/^(?:\([^)]*\))+/, '')
  return normalizeBillText(stripped || sku)
}

/**
 * Explicit customer-name alias dictionary: staff write "Coffee" where BILL.md
 * stores "Cafe" ("18Grams Coffee" → 18Grams Cafe). Never semantic guessing.
 */
const CUSTOMER_TOKEN_SYNONYMS: Record<string, string> = {
  coffee: 'cafe',
}

function canonicalCustomerText(value: string): string {
  return tokens(value).map(token => CUSTOMER_TOKEN_SYNONYMS[token] ?? token).join(' ')
}

/** Stable key for chat-memory customer selections. */
export function customerQueryKey(query: string): string {
  return canonicalCustomerText(query)
}

function resolveCustomer(index: BillIndex, query: string, selections: Map<string, string>, memory?: ChatOrderMemory) {
  const selected = selections.get('$customer')
  if (selected) {
    const match = index.customers.find(customer => customerCandidateId(customer.code) === selected)
    if (match) return { status: 'resolved' as const, customer: match, candidates: [] }
  }

  const normalizedQuery = normalizeBillText(query)
  const exactCode = index.customers.filter(customer => normalizeBillText(customer.code) === normalizedQuery)
  if (exactCode.length === 1) return { status: 'resolved' as const, customer: exactCode[0]!, candidates: [] }

  const canonicalQuery = canonicalCustomerText(query)
  const exactName = index.customers.filter(customer => canonicalCustomerText(customer.name) === canonicalQuery)
  if (exactName.length === 1) return { status: 'resolved' as const, customer: exactName[0]!, candidates: [] }

  const queryTokens = tokens(query)
    .filter(token => !/^\d+$/.test(token))
    .map(token => CUSTOMER_TOKEN_SYNONYMS[token] ?? token)
  const matches = index.customers.filter((customer) => {
    const normalizedName = canonicalCustomerText(customer.name)
    return queryTokens.length > 0 && queryTokens.every(token => normalizedName.includes(token))
  })

  if (matches.length === 1) return { status: 'resolved' as const, customer: matches[0]!, candidates: [] }

  // Chat memory fills the gap only when BILL.md itself is ambiguous, and only
  // if the remembered branch is still one of the current candidates.
  if (matches.length > 1 && memory) {
    const remembered = memory.customerSelections.find(entry => entry.queryKey === canonicalQuery)
    const match = remembered && matches.find(customer => customer.code === remembered.customerCode)
    if (match) return { status: 'resolved' as const, customer: match, candidates: [], fromMemory: true }
  }

  return {
    status: matches.length > 1 ? 'ambiguous' as const : 'not_found' as const,
    customer: undefined,
    candidates: matches.map(customer => ({
      candidateId: customerCandidateId(customer.code),
      ...customer,
    })),
  }
}

function isPositiveHistory(row: BillRow): boolean {
  const quantity = parseNumber(row['Số lượng'])
  return row['Thời gian'] !== BILL_STATIC_DATE && quantity !== null && quantity > 0
}

/**
 * Explicit alias dictionary (see ORDER-AGENT-CONTRACT §3): maps confirmed
 * customer vocabulary to the token BILL.md uses. Never semantic guessing.
 */
const PRODUCT_TOKEN_SYNONYMS: Record<string, string> = {
  // Khách gọi "siro"; BILL.md ghi "Syrup" (vd: Syrup Davinci Vải 750ml).
  siro: 'syrup',
  // Frequent transposition typo in compact order messages: "srio" → "syrup".
  srio: 'syrup',
  // F&B shorthand: "bột béo" is the same catalog family as "bột sữa".
  beo: 'sua',
  // Staff/customer shorthand for the Flago creme-brulee powder variant.
  brulee: 'flago',
  // "sto" is the customer's compact form of "sinh tố".
  sto: 'sinh',
  // Common Vietnamese chat shorthand: "ko đường" → "không đường".
  ko: 'khong',
}

function canonicalProductToken(token: string): string {
  return PRODUCT_TOKEN_SYNONYMS[token] ?? token
}

/** Customer vocabulary that needs phrase context rather than a global token alias. */
function productQueryTokens(rawName: string): string[] {
  let queryTokens = tokens(rawName).map(canonicalProductToken)
  const has = (...required: string[]) => required.every(token => queryTokens.includes(token))

  if (has('syrup', 'oi', 'hong')) queryTokens = queryTokens.filter(token => token !== 'hong')
  if (has('ong', 'hut', 'to')) {
    queryTokens = [...queryTokens.filter(token => token !== 'to'), 'tran', 'chau']
  }
  if (has('ong', 'hut', 'nho')) {
    queryTokens = [...queryTokens.filter(token => token !== 'nho'), 'p6']
  }
  if (has('rich', 'lun')) queryTokens = queryTokens.filter(token => token !== 'lun')
  if (has('dua', 'kho', 'vun')) {
    queryTokens = queryTokens.map(token => token === 'kho' ? 'nuong' : token)
  }
  if (has('bot', 'sua', 'tra')) {
    // "bột béo trà sữa" describes the category; customer history decides the brand.
    queryTokens = queryTokens.filter(token => token !== 'tra')
  }
  if (has('syrup', 'trai', 'cay')) {
    queryTokens = queryTokens.filter(token => token !== 'trai' && token !== 'cay')
    queryTokens.push('nhiet', 'doi')
  }

  return unique(queryTokens)
}

/**
 * One-edit typo tolerance for long tokens only ("dinhfong" → "dingfong",
 * "rich" → "richs"). Customer-code scoping and later ambiguity checks still
 * apply, so this never authorizes a cross-customer or arbitrary fuzzy result.
 */
function isOneEditApart(left: string, right: string): boolean {
  if (left === right) return true
  if (Math.min(left.length, right.length) < 4 || Math.abs(left.length - right.length) > 1) return false
  // Changing the first character usually changes the word/category entirely
  // ("đường" vs "muỗng"), while the typos we accept preserve the prefix.
  if (left[0] !== right[0]) return false

  if (left.length === right.length) {
    let differences = 0
    for (let index = 0; index < left.length; index++) {
      if (left[index] !== right[index] && ++differences > 1) return false
    }
    return differences === 1
  }

  const [shorter, longer] = left.length < right.length ? [left, right] : [right, left]
  let shortIndex = 0
  let longIndex = 0
  let skipped = false
  while (shortIndex < shorter.length && longIndex < longer.length) {
    if (shorter[shortIndex] === longer[longIndex]) {
      shortIndex++
      longIndex++
      continue
    }
    if (skipped) return false
    skipped = true
    longIndex++
  }
  return true
}

function productMatches(row: BillRow, rawName: string): boolean {
  const queryTokens = productQueryTokens(rawName)
  if (queryTokens.length === 0) return false
  const haystackTokens = tokens(`${row['Tên hàng']} ${row['Mã hàng']}`).map(canonicalProductToken)
  return queryTokens.every(queryToken =>
    haystackTokens.some(productToken => isOneEditApart(queryToken, productToken)),
  )
}

/**
 * A one-word category such as "đường" can occur incidentally in dozens of
 * unrelated products ("sữa ... không đường", "trân châu ... đường đen"). If
 * this customer's history has products whose names start with that category,
 * keep that narrower set and let recency + frequency choose within it.
 */
function narrowLeadingCategory(rows: BillRow[], rawName: string): BillRow[] {
  const queryTokens = productQueryTokens(rawName)
  if (queryTokens.length === 0 || rows.length < 2) return rows
  const prefixRows = rows.filter((row) => {
    const nameTokens = tokens(row['Tên hàng']).map(canonicalProductToken)
    const leadingToken = nameTokens.find(token => !/\d/.test(token))
    return leadingToken !== undefined && isOneEditApart(queryTokens[0]!, leadingToken)
  })
  return prefixRows.length > 0 ? prefixRows : rows
}

/**
 * Some BILL exports put the container after the measure ("500gram (gói)").
 * Convert that display form into the same container-first shape used by the
 * billing engine, without changing the source file in the sandbox.
 */
function catalogUnitForBilling(rawUnit: string): string {
  const unit = rawUnit.trim()
  const match = unit.match(/^(\d+(?:[.,]\d+)?\s*(?:kg|g|gr|gram|ml|l))\s*\(([^)]+)\)$/i)
  if (!match) return unit
  const container = match[2]!.trim()
  if (!PLAIN_UNITS.has(normalizeBillText(container))) return unit
  return `${container.charAt(0).toUpperCase()}${container.slice(1)} ${match[1]!.trim()}`
}

function catalogUnitMatchesRequest(rawCatalogUnit: string, requestedUnit: string): boolean {
  const catalogUnit = catalogUnitForBilling(rawCatalogUnit)
  if (!catalogUnit || !requestedUnit.trim()) return false
  if (unitsEquivalent(requestedUnit, catalogUnit)) return true
  const pack = parsePackSpec(catalogUnit)
  if (pack && (unitsEquivalent(requestedUnit, pack.container) || unitsEquivalent(requestedUnit, pack.subUnit))) return true
  const sized = parseSizedUnit(catalogUnit)
  return sized.measureBase !== null && unitsEquivalent(requestedUnit, sized.base)
}

/** Use an explicit requested unit to remove impossible product branches. */
function narrowByRequestedUnit(rows: BillRow[], requestedUnit: string): BillRow[] {
  const productCount = new Set(rows.map(row => normalizeBillText(row['Tên hàng']))).size
  if (!requestedUnit.trim() || productCount < 2) return rows
  const matching = rows.filter(row => catalogUnitMatchesRequest(row['ĐVT'], requestedUnit))
  return matching.length > 0 ? matching : rows
}

/** "chanh" means plain lemon when a plain-lemon history row exists, not chanh dây. */
function narrowFlavorVariant(rows: BillRow[], rawName: string): BillRow[] {
  const queryTokens = productQueryTokens(rawName)
  if (!queryTokens.includes('chanh') || queryTokens.includes('day')) return rows
  const plainLemon = rows.filter(row => !tokens(row['Tên hàng']).includes('day'))
  return plainLemon.length > 0 ? plainLemon : rows
}

function isValidCatalogUnit(rawUnit: string): boolean {
  const unit = catalogUnitForBilling(rawUnit)
  if (!unit.trim()) return false
  if (parsePackSpec(unit)) return true
  const sized = parseSizedUnit(unit)
  if (sized.measureBase !== null) return true
  return PLAIN_UNITS.has(normalizeBillText(unit))
}

function businessUnitOverride(productName: string): string | null {
  const normalized = normalizeBillText(productName)
  return BUSINESS_UNIT_OVERRIDES.find(override =>
    override.productTokens.every(token => normalized.includes(token)),
  )?.unit ?? null
}

function unitVariantMatches(rawCatalogUnit: string, requestedUnit: string): boolean {
  const catalogUnit = catalogUnitForBilling(rawCatalogUnit)
  const requested = normalizeBillText(requestedUnit)
  if (!requested || !catalogUnit.trim()) return false
  if (normalizeBillText(catalogUnit) === requested) return true
  const pack = parsePackSpec(catalogUnit)
  return pack !== null && normalizeBillText(pack.container) === requested
}

/**
 * One product name can hide two packaging SKUs (retail "Hộp" vs case
 * "Thùng/12 Hộp"). When the requested unit names one of them, scope the
 * evidence to that variant instead of letting the newest row win.
 */
function scopeRowsToRequest(rows: BillRow[], requestedUnit: string, requestedQuantity: number): BillRow[] {
  const unitKey = (row: BillRow) => normalizeBillText(catalogUnitForBilling(row['ĐVT']))
  const units = unique(rows.map(unitKey).filter(Boolean))
  if (units.length < 2) return rows
  if (requestedUnit.trim()) {
    const matching = rows.filter(row => unitVariantMatches(row['ĐVT'], requestedUnit))
    if (matching.length > 0) return matching
  }

  // Shorthand such as "5 ống hút nhỏ" omits the package unit. When this exact
  // quantity has only ever been bought in one of the product's variants, use
  // that variant as customer-specific evidence (5 Bì, versus 1 Thùng).
  const exactQuantityRows = rows.filter(row => parseNumber(row['Số lượng']) === requestedQuantity)
  const exactUnits = unique(exactQuantityRows.map(unitKey).filter(Boolean))
  return exactUnits.length === 1 ? rows.filter(row => unitKey(row) === exactUnits[0]) : rows
}

/**
 * A customer may repeatedly write a colloquial package word that BILL does not
 * use (for example "6 lốc" while every six-unit purchase is stored as Hộp).
 * Only accept that 1:1 interpretation when the product has multiple variants,
 * the requested unit matches none of them, and at least two real purchases with
 * the exact requested quantity agree on one catalog unit.
 */
function repeatedHistoryUnitForRequest(
  rows: BillRow[],
  requestedUnit: string,
  requestedQuantity: number,
): string | null {
  if (!requestedUnit.trim() || rows.some(row => unitVariantMatches(row['ĐVT'], requestedUnit))) return null
  const units = unique(rows.map(row => normalizeBillText(catalogUnitForBilling(row['ĐVT']))).filter(Boolean))
  if (units.length < 2) return null
  const exactRows = rows.filter(row => parseNumber(row['Số lượng']) === requestedQuantity && isValidCatalogUnit(row['ĐVT']))
  const exactUnits = unique(exactRows.map(row => normalizeBillText(catalogUnitForBilling(row['ĐVT']))))
  if (exactRows.length < 2 || exactUnits.length !== 1) return null
  return catalogUnitForBilling(exactRows[0]!['ĐVT'])
}

function staticRowsForCustomer(index: BillIndex, customerCode: string): BillRow[] {
  const customerHistory = index.rows.filter(row => row['Mã khách hàng'] === customerCode && row['Thời gian'] !== BILL_STATIC_DATE)
  const priceLists = new Set(customerHistory.map(row => row['Bảng giá']).filter(Boolean))
  return index.rows.filter(row =>
    row['Thời gian'] === BILL_STATIC_DATE
    && (row['Mã khách hàng'] === customerCode || (row['Bảng giá'] !== '' && priceLists.has(row['Bảng giá']))),
  )
}

/**
 * Product discovery fallback for a staff-confirmed new item. Rows stay inside
 * the customer's own price-list names; they are never preference evidence and
 * their price is never accepted without an explicit resolver confirmation.
 */
function referenceRowsForCustomerPriceLists(index: BillIndex, customerCode: string): BillRow[] {
  const priceLists = new Set(index.rows
    .filter(row => row['Mã khách hàng'] === customerCode)
    .map(row => row['Bảng giá'])
    .filter(Boolean))
  if (priceLists.size === 0) return []
  return dedupeRows(index.rows.filter(row =>
    row['Mã khách hàng'] !== customerCode
    && priceLists.has(row['Bảng giá'])
    && isPositiveHistory(row),
  ))
}

function latestRows(rows: BillRow[]): BillRow[] {
  if (rows.length === 0) return []
  const sorted = [...rows].sort((a, b) => parseDate(b['Thời gian']) - parseDate(a['Thời gian']))
  const latestDate = sorted[0]!['Thời gian']
  return sorted.filter(row => row['Thời gian'] === latestDate)
}

/**
 * Price evidence: the newest priced purchase date in the customer's entire
 * history of the product. The newest purchase sometimes carries no numeric
 * price; any earlier priced purchase is still current-price evidence and
 * beats the static price list. Newest price wins when several exist.
 */
function newestPricedRows(rows: BillRow[]): BillRow[] {
  const priced = rows.filter((row) => {
    const price = parseNumber(row['Giá bán'])
    return price !== null && price > 0
  })
  return latestRows(priced)
}

function warningText(rows: BillRow[]): string {
  return rows.map(row => `${row['Số lượng']} ${row['Giảm giá']} ${row['Ghi chú hàng hóa']}`).join(' ')
}

const CHAT_MEMORY_NOTE = '✔️ Dùng xác nhận trước đó trong chat'

function resolveLine(index: BillIndex, item: RequestedOrderItem, options: {
  customerCode: string
  selectedCandidateId?: string
  confirmedIds: Set<string>
  memory?: ChatOrderMemory
}): ResolvedBillLine {
  const { customerCode, selectedCandidateId, confirmedIds, memory } = options
  // Marks the line's visible provenance whenever chat memory decided anything.
  let usedChatMemory = false
  const finalize = (line: ResolvedBillLine): ResolvedBillLine => usedChatMemory
    ? { ...line, warning: line.warning ? `${line.warning} — ${CHAT_MEMORY_NOTE}` : CHAT_MEMORY_NOTE }
    : line

  const historyScope = dedupeRows(index.rows.filter(row => row['Mã khách hàng'] === customerCode && isPositiveHistory(row)))
  const staticScope = dedupeRows(staticRowsForCustomer(index, customerCode))
  const priceListReferenceScope = referenceRowsForCustomerPriceLists(index, customerCode)
  let historyMatches = narrowLeadingCategory(
    narrowFlavorVariant(
      narrowByRequestedUnit(historyScope.filter(row => productMatches(row, item.rawName)), item.requestedUnit),
      item.rawName,
    ),
    item.rawName,
  )
  let staticMatches = narrowLeadingCategory(
    narrowFlavorVariant(
      narrowByRequestedUnit(staticScope.filter(row => productMatches(row, item.rawName)), item.requestedUnit),
      item.rawName,
    ),
    item.rawName,
  )

  // A confirmed per-customer alias narrows/overrides token matching — but only
  // when the aliased product still exists in this customer's history/price list.
  let aliasApplied = false
  const alias = memory?.productAliases.find(entry =>
    entry.customerCode === customerCode && entry.aliasKey === normalizeBillText(item.rawName))
  if (alias) {
    const aliasHistory = historyScope.filter(row => normalizeBillText(row['Tên hàng']) === alias.productKey)
    const aliasStatic = staticScope.filter(row => normalizeBillText(row['Tên hàng']) === alias.productKey)
    if (aliasHistory.length > 0 || aliasStatic.length > 0) {
      historyMatches = aliasHistory
      staticMatches = aliasStatic
      aliasApplied = true
    }
  }

  let candidateRows = historyMatches.length > 0 ? historyMatches : staticMatches
  let referenceMatches: BillRow[] = []
  if (candidateRows.length === 0) {
    referenceMatches = narrowLeadingCategory(
      narrowFlavorVariant(
        narrowByRequestedUnit(
          priceListReferenceScope.filter(row => productMatches(row, item.rawName)),
          item.requestedUnit,
        ),
        item.rawName,
      ),
      item.rawName,
    )
    candidateRows = referenceMatches
  }
  const usesPriceListReference = referenceMatches.length > 0
  const candidateGroups = new Map<string, BillRow[]>()
  for (const row of candidateRows) {
    const key = normalizeBillText(row['Tên hàng'])
    const group = candidateGroups.get(key) ?? []
    group.push(row)
    candidateGroups.set(key, group)
  }

  const candidates = [...candidateGroups.values()].map((rows) => {
    const newest = [...rows].sort((a, b) => parseDate(b['Thời gian']) - parseDate(a['Thời gian']))[0]!
    return {
      candidateId: productCandidateId(item.lineId, newest['Tên hàng']),
      sku: newest['Mã hàng'],
      productName: newest['Tên hàng'],
      reason: historyMatches.length > 0
        ? 'Có trong lịch sử mua thực của khách hàng'
        : usesPriceListReference
          ? 'Mặt hàng mới: có trong cùng bảng giá nhưng khách chưa từng mua'
          : 'Chỉ có trong bảng giá tĩnh',
    }
  })

  let selectedProduct: string | undefined
  let selectionSource: ResolvedBillLine['evidence']['selectionSource']
  if (selectedCandidateId) {
    const selected = candidates.find(candidate => candidate.candidateId === selectedCandidateId)
    if (selected) {
      selectedProduct = selected.productName
      selectionSource = 'staff_confirmation'
    }
  }
  if (!selectedProduct && candidateGroups.size === 1 && !usesPriceListReference) {
    selectedProduct = candidates[0]!.productName
    selectionSource = aliasApplied
      ? 'chat_memory'
      : historyMatches.length > 0 ? 'positive_history' : 'static_price'
    if (aliasApplied) usedChatMemory = true
  }
  if (!selectedProduct && !usesPriceListReference) {
    const exact = candidates.filter(candidate => normalizeBillText(candidate.productName) === normalizeBillText(item.rawName))
    if (exact.length === 1) {
      selectedProduct = exact[0]!.productName
      selectionSource = historyMatches.length > 0 ? 'positive_history' : 'static_price'
    }
  }
  if (!selectedProduct && historyMatches.length > 0 && candidateGroups.size > 1) {
    const newestCandidateTimestamp = Math.max(...historyMatches.map(row => parseDate(row['Thời gian'])))
    const recentCutoff = newestCandidateTimestamp - 30 * 24 * 60 * 60 * 1000
    const ranked = [...candidateGroups.values()]
      .map(rows => ({
        productName: rows[0]!['Tên hàng'],
        count: rows.length,
        recentCount: rows.filter(row => parseDate(row['Thời gian']) >= recentCutoff).length,
        latest: Math.max(...rows.map(row => parseDate(row['Thời gian']))),
      }))
      .sort((a, b) => b.latest - a.latest || b.count - a.count)
    const [first, second] = ranked
    // Prefer a newer product when either all-time frequency agrees, or the
    // customer has repeatedly bought it during the latest 30-day window. The
    // latter captures a genuine product switch without letting one recent
    // outlier override an established preference.
    const allTimePreference = first && second && first.latest > second.latest && first.count > second.count
    const recentPreference = first && first.recentCount >= 2 && ranked.slice(1).every(other =>
      first.latest > other.latest && first.recentCount > other.recentCount,
    )
    if (first && (allTimePreference || recentPreference)) {
      selectedProduct = first.productName
      selectionSource = 'positive_history'
    }
  }

  if (!selectedProduct) {
    const warning = candidates.length > 0
      ? `Cần xác nhận sản phẩm cho "${item.rawName}"`
      : `Không tìm thấy sản phẩm "${item.rawName}" trong lịch sử/bảng giá của khách hàng`
    return finalize({
      lineId: item.lineId,
      status: candidates.length > 0 ? 'needs_product_confirmation' : 'not_found',
      request: item,
      evidence: { rowDates: [] },
      candidates,
      confirmations: [],
      warning,
    })
  }

  const productKey = normalizeBillText(selectedProduct)
  const fullProductHistory = historyScope.filter(row => normalizeBillText(row['Tên hàng']) === productKey)
  const historyQuantityUnit = repeatedHistoryUnitForRequest(
    fullProductHistory,
    item.requestedUnit,
    item.requestedQuantity,
  )
  const productHistory = scopeRowsToRequest(
    fullProductHistory,
    item.requestedUnit,
    item.requestedQuantity,
  )
  const productStatic = scopeRowsToRequest(
    staticScope.filter(row => normalizeBillText(row['Tên hàng']) === productKey),
    item.requestedUnit,
    item.requestedQuantity,
  )
  const productReference = scopeRowsToRequest(
    referenceMatches.filter(row => normalizeBillText(row['Tên hàng']) === productKey),
    item.requestedUnit,
    item.requestedQuantity,
  )
  const newestHistoryRows = latestRows(productHistory)
  const newest = newestHistoryRows[0] ?? productStatic[0] ?? latestRows(productReference)[0]!
  const sku = newest['Mã hàng']
  const matched = { sku, canonicalSku: canonicalSku(sku), productName: newest['Tên hàng'] }

  const historyPrices = unique(newestPricedRows(productHistory).map(row => parseNumber(row['Giá bán'])).filter((price): price is number => price !== null && price > 0))
  const staticPrices = unique(productStatic.map(row => parseNumber(row['Giá bán'])).filter((price): price is number => price !== null && price > 0))
  const referencePrices = unique(newestPricedRows(productReference).map(row => parseNumber(row['Giá bán'])).filter((price): price is number => price !== null && price > 0))
  const price = historyPrices.length === 1
    ? historyPrices[0]!
    : historyPrices.length === 0 && staticPrices.length === 1
      ? staticPrices[0]!
      : historyPrices.length === 0 && staticPrices.length === 0 && referencePrices.length === 1
        ? referencePrices[0]!
        : null
  const usesReferencePrice = historyPrices.length === 0 && staticPrices.length === 0 && referencePrices.length === 1
  const priceSource = historyPrices.length === 1
    ? 'latest_positive_history' as const
    : staticPrices.length === 1
      ? 'static_price' as const
      : usesReferencePrice ? 'global_reference' as const : undefined

  const priceConfirmationId = `price:${encodeURIComponent(item.lineId)}:use-current`
  const flags = warningText(productStatic)
  // Price memory is keyed to the approved value: any other computed price
  // invalidates the remembered approval (ADR 0001).
  const memoryPriceApproved = price !== null && (memory?.priceConfirmations.some(entry =>
    entry.customerCode === customerCode && entry.productKey === productKey && entry.price === price) ?? false)
  const priceFlagDate = flags.match(/(?:báo\s*tăng)[^\d]*(\d{1,2})[./](\d{1,2})[./](\d{2,4})/i)
  const priceFlagTimestamp = priceFlagDate
    ? Date.UTC(
      Number(priceFlagDate[3]!) < 100 ? Number(priceFlagDate[3]!) + 2000 : Number(priceFlagDate[3]!),
      Number(priceFlagDate[2]!) - 1,
      Number(priceFlagDate[1]!),
    )
    : null
  // A dated "Báo Tăng" is no longer pending once the customer bought the same
  // SKU again at that price after the notice. "Hỏi lại giá" remains explicit.
  const acceptedDatedIncrease = price !== null
    && priceFlagTimestamp !== null
    && productHistory.some(row =>
      parseDate(row['Thời gian']) >= priceFlagTimestamp && parseNumber(row['Giá bán']) === price)
  const priceFlagged = /hỏi\s*lại\s*giá/i.test(flags)
    || (/báo\s*tăng/i.test(flags) && !acceptedDatedIncrease)
  if ((priceFlagged || usesReferencePrice) && !confirmedIds.has(priceConfirmationId) && memoryPriceApproved) usedChatMemory = true
  const priceNeedsConfirmation = (priceFlagged || usesReferencePrice)
    && !confirmedIds.has(priceConfirmationId)
    && !memoryPriceApproved

  const historyUnitRow = [...productHistory]
    .sort((a, b) => parseDate(b['Thời gian']) - parseDate(a['Thời gian']))
    .find(row => isValidCatalogUnit(row['ĐVT']))
  const staticUnitRow = productStatic.find(row => isValidCatalogUnit(row['ĐVT']))
  const referenceUnitRow = [...productReference]
    .sort((a, b) => parseDate(b['Thời gian']) - parseDate(a['Thời gian']))
    .find(row => isValidCatalogUnit(row['ĐVT']))
  const overrideUnit = businessUnitOverride(selectedProduct)
  // ĐVT column blank but the packaging + size sits in the product name ("... Túi 1Kg").
  const nameUnit = unitFromProductName(selectedProduct)
  const requestedUnitKey = normalizeBillText(item.requestedUnit)
  const unitConfirmationId = `unit:${encodeURIComponent(item.lineId)}:requested-1to1`
  const draftConfirmedUnit = confirmedIds.has(unitConfirmationId) ? item.requestedUnit : null
  // A remembered 1:1 unit sits last in precedence, exactly like a fresh staff
  // confirmation: it can only ever fill a catalog gap, never override one.
  const memoryUnit = !draftConfirmedUnit && memory?.unitMappings.some(entry =>
    entry.kind === 'requested-1to1' && entry.productKey === productKey && entry.requestedUnitKey === requestedUnitKey)
    ? item.requestedUnit
    : null
  const confirmedUnit = draftConfirmedUnit ?? memoryUnit
  const requestedPackaging = ['goi', 'tui', 'bi', 'bich'].includes(normalizeBillText(item.requestedUnit))
  const productCarriesMeasure = /\d+(?:[.,]\d+)?\s*(?:kg|g|gr|gram|ml|l)\b/i.test(selectedProduct)
  const implicitRequestedUnit = !historyUnitRow && !staticUnitRow && !referenceUnitRow && !overrideUnit && !nameUnit
    && requestedPackaging && productCarriesMeasure
    ? item.requestedUnit
    : null
  // If neither the customer nor BILL states a unit, quantity is already the
  // catalog count (one price-bearing row = one item). Use an honest neutral
  // label instead of forcing the model to invent "chai", "hộp", etc.
  const implicitEachUnit = !item.requestedUnit.trim() && !historyUnitRow && !staticUnitRow && !referenceUnitRow
    && !overrideUnit && !nameUnit
    ? 'Đơn vị'
    : null
  const unit = historyUnitRow
    ? catalogUnitForBilling(historyUnitRow['ĐVT'])
    : staticUnitRow
      ? catalogUnitForBilling(staticUnitRow['ĐVT'])
      : referenceUnitRow
        ? catalogUnitForBilling(referenceUnitRow['ĐVT'])
        : overrideUnit ?? nameUnit ?? implicitRequestedUnit ?? implicitEachUnit ?? confirmedUnit
  // The catalog has a ĐVT but the customer ordered in another unit ("1 bì" of a
  // "Gói" product). Staff can map it 1:1; until they do, the line stays pending.
  const mappingConfirmationId = `unit:${encodeURIComponent(item.lineId)}:requested-equals-catalog`
  const draftMapped = confirmedIds.has(mappingConfirmationId)
  // A remembered mapping is valid only while the catalog unit it was confirmed
  // against is unchanged; a new catalog ĐVT invalidates it (ADR 0001).
  const memoryMapped = !draftMapped && unit !== null && (memory?.unitMappings.some(entry =>
    entry.kind === 'requested-equals-catalog'
    && entry.productKey === productKey
    && entry.requestedUnitKey === requestedUnitKey
    && entry.catalogUnitKey === normalizeBillText(unit)) ?? false)
  const unitMappedByStaff = draftMapped || memoryMapped
  const unitMappedByHistory = historyQuantityUnit !== null
    && unit !== null
    && normalizeBillText(historyQuantityUnit) === normalizeBillText(unit)
  if (memoryMapped) usedChatMemory = true
  const unitSource = draftMapped
    ? 'staff_confirmation' as const
    : memoryMapped
      ? 'chat_memory' as const
      : historyUnitRow
        ? unitMappedByHistory ? 'history_quantity_pattern' as const : 'history' as const
        : staticUnitRow ? 'static_price' as const
        : referenceUnitRow ? 'global_reference' as const
        : overrideUnit ? 'business_override' as const
        : nameUnit ? 'product_name' as const
        : implicitRequestedUnit ? 'positive_history' as const
        : implicitEachUnit ? 'implicit_each' as const
        : draftConfirmedUnit ? 'staff_confirmation' as const
        : memoryUnit ? 'chat_memory' as const : undefined
  if (unitSource === 'chat_memory' && memoryUnit) usedChatMemory = true

  const confirmations: ResolvedBillLine['confirmations'] = []
  if (!unit) {
    confirmations.push({
      confirmationId: unitConfirmationId,
      kind: 'unit',
      label: `Dùng ${item.requestedUnit} làm ĐVT 1:1 cho ${selectedProduct}`,
      reason: 'BILL.md không có ĐVT hợp lệ cho sản phẩm này',
    })
  }
  if (priceNeedsConfirmation) {
    confirmations.push({
      confirmationId: priceConfirmationId,
      kind: 'price',
      label: price === null ? 'Xác nhận lại giá' : `Xác nhận dùng giá ${price.toLocaleString('vi-VN')}đ`,
      reason: usesReferencePrice
        ? 'Khách chưa từng mua; đây là giá mới nhất của cùng SKU trong cùng bảng giá'
        : 'Bảng giá có ghi chú Hỏi lại giá/Báo tăng',
    })
  }

  const base = {
    lineId: item.lineId,
    request: item,
    matched,
    evidence: {
      selectionSource,
      priceSource,
      unitSource,
      rowDates: unique((productHistory.length > 0
        ? productHistory
        : productStatic.length > 0 ? productStatic : productReference)
        .map(row => row['Thời gian'])).slice(0, 5),
    },
    candidates,
    confirmations,
  }

  if (price === null || priceNeedsConfirmation) {
    const warning = price === null
      ? 'Cần xác nhận giá bán'
      : usesReferencePrice
        ? 'Mặt hàng mới: cần xác nhận giá tham khảo từ cùng bảng giá'
        : 'Cần xác nhận giá theo ghi chú bảng giá'
    return finalize({ ...base, status: 'needs_price_confirmation', warning })
  }
  if (!unit) {
    return finalize({ ...base, status: 'needs_unit_confirmation', warning: `Cần xác nhận ĐVT cho ${selectedProduct}` })
  }

  const calculated = resolveOrderLine({
    productName: selectedProduct,
    catalogUnit: unit,
    catalogPrice: price,
    requestedQuantity: item.requestedQuantity,
    // Staff confirmed 1 requested unit = 1 catalog unit → bill in the catalog unit.
    requestedUnit: unitMappedByStaff || unitMappedByHistory ? undefined : item.requestedUnit,
  })
  if (!calculated.ok) {
    // A fractional pack ("5 Hộp" of "Thùng/24 Hộp") must never be offered as a
    // 1:1 mapping — that would bill 5 thùng. Only an unknown unit is mappable.
    const mappable = calculated.reason === 'unit_mismatch'
    return finalize({
      ...base,
      status: 'needs_unit_confirmation',
      confirmations: mappable
        ? [
          ...base.confirmations, {
            confirmationId: mappingConfirmationId,
            kind: 'unit' as const,
            label: `Xác nhận 1 ${item.requestedUnit} = 1 ${unit} cho ${selectedProduct}`,
            reason: `Bảng giá ghi ĐVT "${unit}", khách đặt theo "${item.requestedUnit}"`,
          }
        ]
        : base.confirmations,
      warning: calculated.warning,
    })
  }

  const resolved = {
    quantity: calculated.quantity,
    unit: calculated.unit,
    catalogPrice: price,
    unitPrice: calculated.unitPrice,
    lineTotal: calculated.lineTotal,
    ...(unitMappedByStaff ? { unitConfirmed: true } : {}),
  }

  if (/cập\s*nhật\s*-?\s*báo\s*khách/i.test(flags)) {
    const notified = flags.match(/(\d{1,2})[./](\d{1,2})[./](\d{2,4})/)
    if (!notified) {
      // Note flags an update but records no notified date → keep the generic notice.
      return finalize({ ...base, status: 'resolved', resolved, warning: '⚠️ Bảng giá ghi CẬP NHẬT - BÁO KHÁCH' })
    }
    const [notifiedLabel] = notified
    const year = Number(notified[3]!) < 100 ? Number(notified[3]!) + 2000 : Number(notified[3]!)
    const notifiedDate = Date.UTC(year, Number(notified[2]!) - 1, Number(notified[1]!))
    const repurchased = productHistory.some(row =>
      parseDate(row['Thời gian']) >= notifiedDate && parseNumber(row['Giá bán']) === price)
    if (repurchased) {
      return finalize({ ...base, status: 'resolved', resolved, warning: `✅ Đã báo khách ${notifiedLabel}, khách đã mua lại — dùng giá hiện tại` })
    }
    const notifiedConfirmationId = `notified:${encodeURIComponent(item.lineId)}:confirmed`
    if (confirmedIds.has(notifiedConfirmationId)) {
      return finalize({ ...base, status: 'resolved', resolved, warning: `✅ Đã xác nhận báo khách ${notifiedLabel}, dùng giá hiện tại` })
    }
    if (memoryPriceApproved) {
      usedChatMemory = true
      return finalize({ ...base, status: 'resolved', resolved, warning: `✅ Đã xác nhận báo khách ${notifiedLabel}, dùng giá hiện tại` })
    }
    return finalize({
      ...base,
      status: 'needs_price_confirmation',
      confirmations: [
        ...base.confirmations,
        {
          confirmationId: notifiedConfirmationId,
          kind: 'price' as const,
          label: `Xác nhận đã báo khách, dùng giá ${price.toLocaleString('vi-VN')}đ`,
          reason: `CẬP NHẬT - đã báo khách ${notifiedLabel} nhưng chưa có đơn mua lại sau đó`,
        },
      ],
      warning: `⚠️ CẬP NHẬT - đã báo khách ${notifiedLabel} nhưng chưa mua lại, cần báo lại giá`,
    })
  }

  return finalize({ ...base, status: 'resolved', resolved })
}

/**
 * The left side of `requested words - catalog annotation` is authoritative.
 * Only when it cannot identify a product may the right side disambiguate it.
 * This preserves `sto đào - ... Vải` as Đào while still using an explicit
 * `... - Trân Châu 3Q Bibi Jelly Trắng` annotation for a generic left side.
 */
function resolveLineWithAnnotation(index: BillIndex, item: RequestedOrderItem, options: {
  customerCode: string
  selectedCandidateId?: string
  confirmedIds: Set<string>
  memory?: ChatOrderMemory
}): ResolvedBillLine {
  const annotationSeparator = item.rawName.indexOf(' - ')
  if (annotationSeparator <= 0) return resolveLine(index, item, options)

  const requestedName = item.rawName.slice(0, annotationSeparator).trim()
  const annotationName = item.rawName.slice(annotationSeparator + 3).trim()
  if (!requestedName || !annotationName) return resolveLine(index, item, options)

  const primary = resolveLine(index, { ...item, rawName: requestedName }, options)
  if (primary.status !== 'not_found' && primary.status !== 'needs_product_confirmation') return primary

  const annotated = resolveLine(index, { ...item, rawName: annotationName }, options)
  return annotated.status !== 'not_found' && annotated.status !== 'needs_product_confirmation'
    ? annotated
    : primary
}

function upsert<T>(entries: T[], entry: T, key: (value: T) => string): T[] {
  const entryKey = key(entry)
  return [...entries.filter(existing => key(existing) !== entryKey), entry]
}

/**
 * Fold one resolution into the chat's confirmation memory (ADR 0001). Only
 * staff-driven facts are recorded: branch selections, shorthand renames or
 * candidate picks, and unit/price confirmation IDs the resolver issued.
 * Auto-resolved lines need no memory — they resolve again by themselves.
 */
export function collectChatMemory(options: {
  memory: ChatOrderMemory
  previousQuery?: string
  previousItems?: RequestedOrderItem[]
  request: {
    customerQuery: string
    items: RequestedOrderItem[]
    selections: BillOrderSelection[]
    confirmations: BillOrderConfirmation[]
  }
  output: ResolveBillOrderOutput
}): ChatOrderMemory {
  const { previousQuery, previousItems, request, output } = options
  let { memory } = options
  if (output.customer.status !== 'resolved' || !output.customer.code) return memory

  const customerCode = output.customer.code
  const customerKey = (entry: { queryKey: string }) => entry.queryKey

  const staffPickedBranch = request.selections.some(selection => selection.lineId === '$customer')
  if (staffPickedBranch) {
    memory = {
      ...memory,
      customerSelections: upsert(memory.customerSelections, {
        queryKey: customerQueryKey(request.customerQuery),
        customerCode,
      }, customerKey),
    }
  }
  // Staff answered an ambiguous branch question by retyping the query (often
  // the raw code): remember the resolution under the original query.
  if (previousQuery && customerQueryKey(previousQuery) !== customerQueryKey(request.customerQuery)) {
    memory = {
      ...memory,
      customerSelections: upsert(memory.customerSelections, {
        queryKey: customerQueryKey(previousQuery),
        customerCode,
      }, customerKey),
    }
  }

  const previousByLine = new Map((previousItems ?? []).map(item => [item.lineId, item]))
  const selectionByLine = new Map(request.selections.map(selection => [selection.lineId, selection.candidateId]))
  const confirmationsByLine = new Map<string, string[]>()
  for (const confirmation of request.confirmations) {
    confirmationsByLine.set(confirmation.lineId, [
      ...(confirmationsByLine.get(confirmation.lineId) ?? []),
      confirmation.confirmationId,
    ])
  }

  const aliasEntryKey = (entry: { customerCode: string, aliasKey: string }) => `${entry.customerCode}${entry.aliasKey}`
  const unitEntryKey = (entry: { productKey: string, requestedUnitKey: string, kind: string }) => `${entry.productKey}${entry.requestedUnitKey}${entry.kind}`
  const priceEntryKey = (entry: { customerCode: string, productKey: string }) => `${entry.customerCode}${entry.productKey}`

  for (const line of output.lines) {
    if (!line.matched) continue
    const productKey = normalizeBillText(line.matched.productName)

    // Alias: staff picked a candidate for this shorthand …
    const aliasSourceNames: string[] = []
    if (selectionByLine.has(line.lineId)) aliasSourceNames.push(line.request.rawName)
    // … or renamed the line until it resolved; the original shorthand is the alias.
    const previous = previousByLine.get(line.lineId)
    if (previous && normalizeBillText(previous.rawName) !== normalizeBillText(line.request.rawName)) {
      aliasSourceNames.push(previous.rawName)
    }
    for (const sourceName of aliasSourceNames) {
      const aliasKey = normalizeBillText(sourceName)
      if (aliasKey === productKey) continue
      memory = {
        ...memory,
        productAliases: upsert(memory.productAliases, { customerCode, aliasKey, productKey }, aliasEntryKey),
      }
    }

    const confirmedIds = confirmationsByLine.get(line.lineId) ?? []
    const requestedUnitKey = normalizeBillText(line.request.requestedUnit)
    if (line.evidence.unitSource === 'staff_confirmation') {
      if (line.resolved?.unitConfirmed && confirmedIds.some(id => id.endsWith(':requested-equals-catalog'))) {
        memory = {
          ...memory,
          unitMappings: upsert(memory.unitMappings, {
            productKey,
            requestedUnitKey,
            kind: 'requested-equals-catalog' as const,
            catalogUnitKey: normalizeBillText(line.resolved.unit),
          }, unitEntryKey),
        }
      } else if (confirmedIds.some(id => id.endsWith(':requested-1to1'))) {
        memory = {
          ...memory,
          unitMappings: upsert(memory.unitMappings, {
            productKey,
            requestedUnitKey,
            kind: 'requested-1to1' as const,
          }, unitEntryKey),
        }
      }
    }

    const priceConfirmed = confirmedIds.some(id => id.startsWith('price:') || id.startsWith('notified:'))
    if (priceConfirmed && line.status === 'resolved' && line.resolved) {
      memory = {
        ...memory,
        priceConfirmations: upsert(memory.priceConfirmations, {
          customerCode,
          productKey,
          price: line.resolved.catalogPrice,
        }, priceEntryKey),
      }
    }
  }

  return memory
}

export function resolveBillOrder(index: BillIndex, request: ResolveBillOrderRequest): ResolveBillOrderOutput {
  const selections = new Map((request.selections ?? []).map(selection => [selection.lineId, selection.candidateId]))
  const confirmationsByLine = new Map<string, Set<string>>()
  for (const confirmation of request.confirmations ?? []) {
    const set = confirmationsByLine.get(confirmation.lineId) ?? new Set<string>()
    set.add(confirmation.confirmationId)
    confirmationsByLine.set(confirmation.lineId, set)
  }

  const customerResolution = resolveCustomer(index, request.customerQuery, selections, request.chatMemory)
  if (!customerResolution.customer) {
    return {
      resolutionStatus: 'needs_confirmation',
      draftId: request.draftId,
      source: { path: 'files/bill/BILL.md', rowCount: index.rows.length },
      customer: {
        status: customerResolution.status,
        candidates: customerResolution.candidates,
      },
      lines: [],
      orderDraft: null,
    }
  }

  const { customer } = customerResolution
  const customerFromMemory = 'fromMemory' in customerResolution && customerResolution.fromMemory === true
  const normalizedItems = request.items.map(normalizeRequestedOrderItem)
  const lines = normalizedItems.map(item => resolveLineWithAnnotation(index, item, {
    customerCode: customer.code,
    selectedCandidateId: selections.get(item.lineId),
    confirmedIds: confirmationsByLine.get(item.lineId) ?? new Set(),
    memory: request.chatMemory,
  }))

  const draftItems = lines.map((line) => {
    const { resolved } = line
    return {
      name: line.matched?.productName ?? line.request.rawName,
      ...(line.matched?.sku ? { sku: line.matched.sku } : {}),
      orderedQuantity: line.request.requestedQuantity,
      orderedUnit: line.request.requestedUnit,
      quantity: resolved?.quantity ?? 0,
      unit: resolved?.unit ?? '',
      ...(resolved?.unitConfirmed ? { unitConfirmed: true } : {}),
      unitPrice: resolved?.unitPrice ?? null,
      lineTotal: resolved?.lineTotal ?? null,
      ...(line.warning ? { note: line.warning } : {}),
    }
  })
  const orderDraft: ResolvedOrderDraft = {
    customerName: customer.name,
    customerCode: customer.code,
    ...(customerFromMemory
      ? { customerNote: `Dùng chi nhánh ${customer.code} đã chọn trước đó trong chat` }
      : {}),
    items: draftItems,
    totalQuantity: Math.round(draftItems.reduce((sum, item) => sum + item.quantity, 0) * 1000) / 1000,
    totalAmount: draftItems.reduce((sum, item) => sum + (item.lineTotal ?? 0), 0),
    pendingCount: draftItems.filter(item => item.lineTotal === null).length,
  }

  return {
    resolutionStatus: orderDraft.pendingCount > 0 ? 'needs_confirmation' : 'resolved',
    draftId: request.draftId,
    source: { path: 'files/bill/BILL.md', rowCount: index.rows.length },
    customer: { status: 'resolved', code: customer.code, name: customer.name, candidates: [] },
    lines,
    orderDraft,
  }
}
