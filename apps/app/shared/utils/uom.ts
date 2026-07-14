/**
 * Unit-of-measure (ĐVT) handling for customer orders.
 *
 * Price lists use pack-size units like "Thùng/24 Hộp", "Thùng /50gói",
 * "Thùng (100 cuộn)", "Lốc/4 Hộp": the listed price is for ONE container
 * (Thùng/Lốc) holding N sub-units (Hộp/gói/cuộn/xâu). Customers often order
 * in sub-units ("12 hộp Richs"), so billing must convert to catalog units
 * deterministically — the model is never trusted with this arithmetic.
 *
 * Two softer mismatches are also handled here so lines are not flagged pending
 * for no reason:
 *   - Synonym units — customers say "hộp" for a product listed as "Lon".
 *   - Measure units — a product listed as "Túi 1Kg" ordered as "1kg" / "500g".
 *   - Plain measures — a product listed by "Lạng" ordered as grams (100g = 1 lạng).
 */

export interface PackSpec {
  /** Container unit, e.g. "Thùng", "Lốc" */
  container: string
  /** Number of sub-units per container, e.g. 24 */
  count: number
  /** Sub-unit, e.g. "Hộp", "gói", "cuộn" — may be empty when the ĐVT omits it */
  subUnit: string
}

// Matches "Thùng/24 Hộp", "Thùng /50gói", "Thùng (100 cuộn)", "Lốc/4 Hộp"
const PACK_SPEC_RE = /^(.+?)\s*[/(]\s*(\d+)\s*([^)/]*?)\s*\)?$/

export function parsePackSpec(unit: string | null | undefined): PackSpec | null {
  if (!unit) return null
  const match = unit.trim().match(PACK_SPEC_RE)
  if (!match) return null
  const count = Number(match[2])
  if (!Number.isInteger(count) || count <= 0) return null
  return { container: match[1]!.trim(), count, subUnit: (match[3] ?? '').trim() }
}

export function normalizeUnit(unit: string): string {
  return unit
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Units that mean the same thing for pricing (1:1, same price). Groups are
 * transitive: "hộp" = "lon" and "lon" = "hũ" collapse into one group.
 * Confirmed with the business — extend deliberately, a wrong pair mis-bills.
 */
const UNIT_SYNONYMS: string[][] = [
  ['hop', 'lon', 'hu'],
  // Staff/customer shorthand "bì/bi" means one bag in these orders.
  ['goi', 'tui', 'bi', 'bich'],
  ['chai', 'lo'],
]

/** True when two unit names are the same or belong to the same synonym group. */
export function unitsEquivalent(a: string, b: string): boolean {
  const na = normalizeUnit(a)
  const nb = normalizeUnit(b)
  if (na === nb) return true
  return UNIT_SYNONYMS.some(group => group.includes(na) && group.includes(nb))
}

type Dimension = 'mass' | 'volume'

/** Measure units → (dimension, factor to a common base: grams for mass, ml for volume). */
const MEASURE_FACTORS: Record<string, { dimension: Dimension, toBase: number }> = {
  kg: { dimension: 'mass', toBase: 1000 },
  g: { dimension: 'mass', toBase: 1 },
  gr: { dimension: 'mass', toBase: 1 },
  gam: { dimension: 'mass', toBase: 1 },
  gram: { dimension: 'mass', toBase: 1 },
  lạng: { dimension: 'mass', toBase: 100 },
  lang: { dimension: 'mass', toBase: 100 },
  l: { dimension: 'volume', toBase: 1000 },
  lit: { dimension: 'volume', toBase: 1000 },
  lít: { dimension: 'volume', toBase: 1000 },
  ml: { dimension: 'volume', toBase: 1 },
}

function measureFactor(unit: string): { dimension: Dimension, toBase: number } | null {
  return MEASURE_FACTORS[normalizeUnit(unit)] ?? null
}

export interface SizedUnit {
  /** Bare unit name without the size, e.g. "Túi" from "Túi 1Kg" */
  base: string
  /** Size expressed in the common base (grams / ml), null when the ĐVT has no measure */
  measureBase: number | null
  dimension: Dimension | null
}

// Matches "Túi 1Kg", "Gói 1kg", "Lon 400ml", "Chai 1.5L" — an optional name then a number + measure unit.
const SIZED_UNIT_RE = /^(.*?)\s*(\d+(?:[.,]\d+)?)\s*([a-zà-ỹ]+)\.?$/i

/** Split a catalog unit like "Túi 1Kg" into its base name and its size in a common base. */
export function parseSizedUnit(unit: string): SizedUnit {
  const trimmed = unit.trim()
  const match = trimmed.match(SIZED_UNIT_RE)
  if (match) {
    const factor = measureFactor(match[3]!)
    if (factor) {
      const value = Number(match[2]!.replace(',', '.'))
      if (Number.isFinite(value) && value > 0) {
        return { base: match[1]!.trim() || trimmed, measureBase: value * factor.toBase, dimension: factor.dimension }
      }
    }
  }
  return { base: trimmed, measureBase: null, dimension: null }
}

/**
 * Packaging container nouns that can carry a size inside a product name,
 * e.g. "... Túi 1Kg". Kept deliberately small — only nouns that are genuine
 * packaging, so a descriptive word before a size ("Lộc Phát 1Kg") is not
 * mistaken for a ĐVT.
 */
const CONTAINER_UNIT_WORDS = ['túi', 'gói', 'hộp', 'lon', 'chai', 'lọ', 'hũ', 'hủ', 'bịch', 'can', 'thùng', 'lốc', 'xâu', 'cuộn', 'khay', 'vỉ', 'bao']

// "<container> <number><measure>" anywhere in a product name, e.g. "Túi 1Kg", "Chai 1.5L".
// Longer measures first so "gram" is not shadowed by "g"; \b stops "1kg" leaking into a word.
const NAME_UNIT_RE = new RegExp(
  `(${CONTAINER_UNIT_WORDS.join('|')})\\s*(\\d+(?:[.,]\\d+)?)\\s*(${Object.keys(MEASURE_FACTORS).sort((a, b) => b.length - a.length).join('|')})\\b`,
  'giu',
)

/**
 * Some price lists leave the ĐVT column blank but write the packaging size into
 * the product name, e.g. "Mứt Chunky Vải, Hoa Hồng Túi 1Kg". Pull that trailing
 * packaging phrase out ("Túi 1Kg") so the line can bill as a sized unit instead
 * of stalling on a missing ĐVT. Returns the phrase verbatim, or null when the
 * name carries no recognisable packaging + measure.
 */
export function unitFromProductName(name: string): string | null {
  const matches = [...name.matchAll(NAME_UNIT_RE)]
  const last = matches.at(-1)
  if (!last) return null
  const candidate = last[0].replace(/\s+/g, ' ').trim()
  return parseSizedUnit(candidate).measureBase === null ? null : candidate
}

/**
 * Packaging aliases confirmed by the business for specific products only.
 * Hộp and Túi must not become global synonyms because that would mis-bill
 * unrelated products.
 */
const PRODUCT_PACKAGING_ALIASES = [
  { productTokens: ['boduo', 'mut', 'xoai'], units: ['hop', 'tui'] },
  { productTokens: ['thach', 'agar', 'chuandai'], units: ['hop', 'tui'] },
]

function normalizeLookupText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function packagingBase(unit: string): string {
  const sized = parseSizedUnit(unit)
  const base = sized.measureBase === null
    ? unit.replace(/\s*\([^)]*\)\s*$/, '')
    : sized.base
  return normalizeLookupText(base)
}

function annotatedMeasure(unit: string): { dimension: Dimension, measureBase: number } | null {
  const match = unit.match(/\(\s*(\d+(?:[.,]\d+)?)\s*([a-zà-ỹ]+)\s*\)\s*$/i)
  if (!match) return null
  const factor = measureFactor(match[2]!)
  if (!factor) return null
  return {
    dimension: factor.dimension,
    measureBase: Number(match[1]!.replace(',', '.')) * factor.toBase,
  }
}

function productUnitsEquivalent(productName: string | undefined, a: string, b: string): boolean {
  if (!productName) return false
  const normalizedProduct = normalizeLookupText(productName)
  const alias = PRODUCT_PACKAGING_ALIASES.find(candidate =>
    candidate.productTokens.every(token => normalizedProduct.includes(token)),
  )
  if (!alias) return false

  const left = packagingBase(a)
  const right = packagingBase(b)
  if (!alias.units.includes(left) || !alias.units.includes(right)) return false

  // If the model adds a size annotation, it must agree with the sized catalog
  // unit. This prevents a confirmed packaging alias from accepting the wrong SKU.
  const leftAnnotation = annotatedMeasure(a)
  const rightAnnotation = annotatedMeasure(b)
  const leftSized = parseSizedUnit(a)
  const rightSized = parseSizedUnit(b)
  const leftMeasure = leftAnnotation
    ?? (leftSized.measureBase === null ? null : { dimension: leftSized.dimension!, measureBase: leftSized.measureBase })
  const rightMeasure = rightAnnotation
    ?? (rightSized.measureBase === null ? null : { dimension: rightSized.dimension!, measureBase: rightSized.measureBase })

  return !leftMeasure || !rightMeasure
    || (leftMeasure.dimension === rightMeasure.dimension && Math.abs(leftMeasure.measureBase - rightMeasure.measureBase) < 1e-9)
}

export interface ResolveOrderLineInput {
  /** Used only for explicitly confirmed, product-specific unit aliases. */
  productName?: string
  /** ĐVT exactly as written in the price list, e.g. "Thùng/24 Hộp" */
  catalogUnit: string
  /** Giá bán for ONE catalog unit */
  catalogPrice: number
  /** Quantity the customer asked for */
  requestedQuantity: number
  /** Unit the customer used, e.g. "Hộp". Undefined = ordered in catalog unit */
  requestedUnit?: string
}

/**
 * Why a line could not be billed. Callers must treat these differently:
 * only `unit_mismatch` may be cleared by a staff 1:1 unit mapping — mapping a
 * `fraction` failure 1:1 would bill 5 Hộp as 5 Thùng.
 */
export type ResolveOrderLineFailure = 'invalid_input' | 'unit_mismatch' | 'fraction'

export type ResolveOrderLineResult =
  | {
    ok: true
    /** Billed quantity in catalog units (may be fractional, e.g. 0.5) */
    quantity: number
    unit: string
    unitPrice: number
    lineTotal: number
    /** Human-readable conversion, e.g. "12 Hộp = 0.5 × Thùng/24 Hộp" */
    conversion: string
  }
  | { ok: false, reason: ResolveOrderLineFailure, warning: string }

/** Whole or half containers only. Returns the snapped quantity, or null if it isn't a 0.5 multiple. */
function toHalfStep(quantity: number): number | null {
  const doubled = quantity * 2
  const rounded = Math.round(doubled)
  if (Math.abs(doubled - rounded) > 1e-9) return null
  return rounded / 2
}

function resolved(quantity: number, catalogUnit: string, catalogPrice: number, conversion: string): ResolveOrderLineResult {
  return { ok: true, quantity, unit: catalogUnit, unitPrice: catalogPrice, lineTotal: Math.round(quantity * catalogPrice), conversion }
}

/**
 * Deterministic conversion + pricing for one order line.
 *
 * Resolution order: order in the catalog unit (or a synonym / the container
 * name) → pack sub-unit conversion ("Thùng/24 Hộp") → sized measure conversion
 * ("Túi 1Kg" ordered as kg/g) → plain measure conversion (grams to Lạng/KG).
 * Anything that doesn't cleanly convert to a
 * whole or half container returns ok:false so the caller marks it pending
 * instead of guessing.
 */
export function resolveOrderLine(input: ResolveOrderLineInput): ResolveOrderLineResult {
  const { productName, catalogUnit, catalogPrice, requestedQuantity, requestedUnit } = input

  if (!Number.isFinite(requestedQuantity) || requestedQuantity <= 0) {
    return { ok: false, reason: 'invalid_input', warning: `Cần xác nhận: số lượng không hợp lệ (${requestedQuantity})` }
  }
  if (!Number.isFinite(catalogPrice) || catalogPrice < 0) {
    return { ok: false, reason: 'invalid_input', warning: `Cần xác nhận: đơn giá không hợp lệ (${catalogPrice})` }
  }

  const pack = parsePackSpec(catalogUnit)
  const sized = pack ? null : parseSizedUnit(catalogUnit)
  const requestedIsSingleGoiShorthand = requestedQuantity === 1
    && normalizeUnit(requestedUnit ?? '') === 'g'
  const equivalentForOrder = (requested: string, catalog: string): boolean =>
    unitsEquivalent(requested, catalog)
    || (requestedIsSingleGoiShorthand && normalizeUnit(catalog) === 'goi')
  const requestedPackagingUnit = ['goi', 'tui', 'bi', 'bich'].includes(normalizeUnit(requestedUnit ?? ''))
  const pureSizedMeasure = sized?.measureBase !== null
    && /^\d+(?:[.,]\d+)?\s*[a-zà-ỹ]+\.?$/i.test(catalogUnit.trim())

  // 1. Ordered directly in the catalog unit, a synonym of it, or the container name.
  const orderedInCatalogUnit = !requestedUnit
    || equivalentForOrder(requestedUnit, catalogUnit)
    || (pack !== null && equivalentForOrder(requestedUnit, pack.container))
    || (sized !== null && equivalentForOrder(requestedUnit, sized.base))
    // BILL sometimes stores a retail pack only as "500gr". A requested bì/gói
    // is one such catalog pack, not 500 individual grams.
    || (pureSizedMeasure && requestedPackagingUnit)
    || productUnitsEquivalent(productName, requestedUnit, catalogUnit)
  if (orderedInCatalogUnit) {
    return resolved(requestedQuantity, catalogUnit, catalogPrice, `${requestedQuantity} ${catalogUnit}`)
  }

  // 2. Pack sub-unit conversion, e.g. 12 Hộp of "Thùng/24 Hộp".
  if (pack && pack.subUnit && equivalentForOrder(requestedUnit!, pack.subUnit)) {
    const quantity = toHalfStep(requestedQuantity / pack.count)
    if (quantity === null) {
      return { ok: false, reason: 'fraction', warning: `Cần xác nhận: ${requestedQuantity} ${requestedUnit} lẻ so với quy cách ${catalogUnit} (chỉ bán nguyên hoặc nửa ${pack.container.toLowerCase()})` }
    }
    return resolved(quantity, catalogUnit, catalogPrice, `${requestedQuantity} ${requestedUnit} = ${quantity} × ${catalogUnit}`)
  }

  // 3. Measure conversion, e.g. 500g of "Túi 1Kg".
  if (sized && sized.measureBase !== null) {
    const factor = measureFactor(requestedUnit!)
    if (factor && factor.dimension === sized.dimension) {
      const quantity = toHalfStep((requestedQuantity * factor.toBase) / sized.measureBase)
      if (quantity === null) {
        return { ok: false, reason: 'fraction', warning: `Cần xác nhận: ${requestedQuantity}${requestedUnit} lẻ so với quy cách ${catalogUnit} (chỉ bán nguyên hoặc nửa ${sized.base.toLowerCase()})` }
      }
      return resolved(quantity, catalogUnit, catalogPrice, `${requestedQuantity}${requestedUnit} = ${quantity} × ${catalogUnit}`)
    }
  }

  // 4. Plain catalog measure conversion, e.g. 200gr = 2 Lạng.
  const catalogMeasure = measureFactor(catalogUnit)
  const requestedMeasure = measureFactor(requestedUnit!)
  if (catalogMeasure && requestedMeasure && catalogMeasure.dimension === requestedMeasure.dimension) {
    const quantity = toHalfStep((requestedQuantity * requestedMeasure.toBase) / catalogMeasure.toBase)
    if (quantity === null) {
      return { ok: false, reason: 'fraction', warning: `Cần xác nhận: ${requestedQuantity}${requestedUnit} lẻ so với đơn vị ${catalogUnit} (chỉ hỗ trợ bước 0.5 ${catalogUnit.toLowerCase()})` }
    }
    return resolved(quantity, catalogUnit, catalogPrice, `${requestedQuantity}${requestedUnit} = ${quantity} ${catalogUnit}`)
  }

  return { ok: false, reason: 'unit_mismatch', warning: `Cần xác nhận: đơn vị "${requestedUnit}" không khớp quy cách "${catalogUnit}"` }
}

export interface OrderLineItem {
  name: string
  sku?: string
  orderedQuantity?: number
  orderedUnit?: string
  quantity: number
  unit: string
  /**
   * Staff confirmed that one orderedUnit is one catalog unit (e.g. 1 bì = 1 Gói).
   * Set only by the resolver from a confirmationId it issued — without it, the
   * conversion below would re-flag the line pending on every present_order call.
   */
  unitConfirmed?: boolean
  /** Known price retained when a line is pending only because of its unit. */
  catalogPrice?: number
  unitPrice: number | null
  lineTotal: number | null
  note?: string
}

export interface OrderDraft {
  customerName: string
  customerCode?: string
  /** Provenance note, e.g. the branch was reused from chat memory (ADR 0001). */
  customerNote?: string
  items: OrderLineItem[]
  totalQuantity: number
  totalAmount: number
  pendingCount: number
}

function appendNote(existing: string | undefined, added: string): string {
  if (existing?.includes(added)) return existing
  return existing ? `${existing} — ${added}` : added
}

function clearResolvedUnitWarnings(note: string | undefined): string | undefined {
  if (!note) return undefined
  const remaining = note
    .split(' — ')
    .filter(part => !part.trim().startsWith('⚠️ Cần xác nhận: đơn vị'))
  return remaining.length > 0 ? remaining.join(' — ') : undefined
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}

/**
 * Recompute every model-supplied number in an order draft.
 *
 * - Lines with orderedQuantity/orderedUnit get their billed quantity re-derived
 *   from the catalog ĐVT (pack spec, synonym, or measure); a failed conversion
 *   flips the line to pending (unitPrice/lineTotal = null) with a warning note.
 * - lineTotal, totalQuantity, totalAmount and pendingCount are always
 *   recomputed — the model's arithmetic is never trusted.
 */
export function normalizeOrder(order: OrderDraft): OrderDraft {
  const items = order.items.map((item): OrderLineItem => {
    const effectivePrice = item.unitPrice ?? item.catalogPrice ?? null
    if (effectivePrice === null) {
      return { ...item, lineTotal: null }
    }

    let { quantity } = item
    if (item.unitConfirmed && item.orderedQuantity !== undefined && item.orderedQuantity !== null && item.orderedUnit) {
      // Staff mapped the requested unit onto the catalog unit 1:1 — bill it as is.
      quantity = item.orderedQuantity
    } else if (item.orderedQuantity !== undefined && item.orderedQuantity !== null && item.orderedUnit) {
      const result = resolveOrderLine({
        productName: item.name,
        catalogUnit: item.unit,
        catalogPrice: effectivePrice,
        requestedQuantity: item.orderedQuantity,
        requestedUnit: item.orderedUnit,
      })
      if (!result.ok) {
        return {
          ...item,
          catalogPrice: effectivePrice,
          unitPrice: null,
          lineTotal: null,
          note: appendNote(item.note, `⚠️ ${result.warning}`),
        }
      }
      ({ quantity } = result)
    }

    return {
      ...item,
      quantity,
      unitPrice: effectivePrice,
      lineTotal: Math.round(quantity * effectivePrice),
      note: clearResolvedUnitWarnings(item.note),
    }
  })

  return {
    ...order,
    items,
    totalQuantity: round3(items.reduce((sum, item) => sum + item.quantity, 0)),
    totalAmount: items.reduce((sum, item) => sum + (item.lineTotal ?? 0), 0),
    pendingCount: items.filter(item => item.lineTotal === null).length,
  }
}
