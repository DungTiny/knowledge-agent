export interface ResolverProductCandidate {
  candidateId: string
  sku: string
  productName: string
  reason: string
  unit?: string
  unitPrice?: number
  rowDate?: string
}

export interface ResolveBillOrderUIToolInvocation {
  toolCallId: string
  state: string
  output?: {
    draftId?: string
    orderDraft?: import('../utils/uom').OrderDraft | null
    customer?: {
      status?: 'resolved' | 'ambiguous' | 'not_found'
      candidates?: Array<{
        candidateId: string
        code: string
        name: string
      }>
    }
  }
}
