export type PendingTransaction = {
  readonly signature: string
  readonly session: string
  readonly programId: string
  readonly cluster: string
  readonly group: string
  readonly blockhash: string
  readonly lastValidBlockHeight: number
  readonly createdAt: string
}
export interface PendingTransactionStore {
  get(): Promise<PendingTransaction | null>
  set(value: PendingTransaction | null): Promise<void>
}
export function memoryPendingStore(): PendingTransactionStore {
  let pending: PendingTransaction | null = null
  return { async get() { return pending }, async set(value) { pending = value } }
}
/** Inject browser storage so importing the SDK is also safe during SSR. */
export function localStoragePendingStore(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, key = 'prismswap.pending.v1'): PendingTransactionStore {
  return {
    async get() {
      const raw = storage.getItem(key)
      if (!raw) return null
      const p = JSON.parse(raw) as PendingTransaction
      if (!p || typeof p.signature !== 'string' || typeof p.session !== 'string' || typeof p.programId !== 'string' || typeof p.cluster !== 'string' || typeof p.blockhash !== 'string' || typeof p.group !== 'string' || !Number.isSafeInteger(p.lastValidBlockHeight) || typeof p.createdAt !== 'string') throw new Error('INVALID_PENDING_RECEIPT')
      return p
    },
    async set(value) { if (value) storage.setItem(key, JSON.stringify(value)); else storage.removeItem(key) },
  }
}
export class PrismSwapSubmissionError extends Error {
  readonly code = 'SUBMISSION_NEEDS_RECONCILIATION'
  constructor(readonly pending: PendingTransaction, options?: ErrorOptions) { super('Check the known signature before requesting another wallet signature.', options) }
}
