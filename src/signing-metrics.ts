/** Bounded signing diagnostics. Contains no addresses, signatures, transaction bytes or auth material. */
export type SigningMetricKind = 'review' | 'walletRequest' | 'signed' | 'broadcast' | 'confirmed' | 'uncertain' | 'reconciledConfirmed' | 'reconciledFailed' | 'authentication'
export type SigningMetricCategory = 'trade' | 'setup' | 'proofRetry' | 'authentication'
export type SigningMetric = {
  readonly schema: 'signing-metrics-v1'
  readonly kind: SigningMetricKind
  readonly category: SigningMetricCategory
  readonly phase: string | null
  readonly elapsedMs: number
  readonly transactionCount: number
  readonly counters: Readonly<Record<SigningMetricKind, number>>
}

/** One recorder per client/action. Diagnostic consumer failures must never change execution. */
export function createSigningMetrics(onMetric?: (metric: SigningMetric) => void, now = () => performance.now()) {
  const started = now()
  const counters: Record<SigningMetricKind, number> = {review:0,walletRequest:0,signed:0,broadcast:0,confirmed:0,uncertain:0,reconciledConfirmed:0,reconciledFailed:0,authentication:0}
  return {
    record(kind: SigningMetricKind, phase: string | null = null, category: SigningMetricCategory = 'trade', transactionCount = 1) {
      counters[kind] += kind === 'walletRequest' || kind === 'review' || kind === 'authentication' ? 1 : transactionCount
      const metric: SigningMetric = {schema:'signing-metrics-v1',kind,category,phase,elapsedMs:Math.max(0,Math.round(now()-started)),transactionCount:kind === 'authentication' ? 0 : transactionCount,counters:{...counters}}
      try { void Promise.resolve(onMetric?.(metric)).catch(() => undefined) } catch { /* Observability is non-authoritative. */ }
    },
  }
}
