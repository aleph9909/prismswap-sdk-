import { safeAssetResolutionErrorCode } from './trade-authority-errors.js'

export const TRADE_V2_DIAGNOSTIC_HEADER = 'x-trade-v2-diagnostic-id'
export function readTradeV2DiagnosticId(value: unknown): string | null {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value) ? value : null
}
const stages = ['classify', 'leg_evidence', 'claimability', 'session_read', 'provider'] as const
const rails = ['core', 'compressed_nft', 'spl', 'pnft', 'token2022', 'sol'] as const
const authorities = ['Owner', 'Address', 'UpdateAuthority', 'None', 'unknown'] as const
const methods = ['getFirstAvailableBlock', 'getSignaturesForAddress', 'getBlockTime', 'getAccountInfo', 'getTokenAccountsByOwner', 'getAsset', 'getAssetProof'] as const
const failures = ['transport', 'timeout', 'http', 'json_parse', 'json_rpc', 'shape', 'decode'] as const
const lifecyclePolicies = ['admission', 'custody', 'release', 'recovery', 'terminal', 'not_deposited'] as const
const blockingNames = ['FreezeDelegate', 'PermanentFreezeDelegate', 'freezeExecute', 'permanentFreezeExecute', 'permanentTransferDelegate', 'permanentBurnDelegate', 'external_lifecycle_control', 'royalty_transfer_rule'] as const
type BlockingPlugin = `${'asset' | 'collection'}:${typeof blockingNames[number]}` | 'non_transferable'
export type TradeV2DiagnosticEvidence = {
  stage: typeof stages[number]; selectionIndex?: number; side?: 'maker' | 'taker'; index?: number
  rail?: typeof rails[number]; blocker?: string
  lifecyclePolicy?: typeof lifecyclePolicies[number]
  core?: { freezePlugins: { scope: 'asset' | 'collection'; plugin: 'FreezeDelegate' | 'PermanentFreezeDelegate'; authorityType: typeof authorities[number]; frozen: boolean; persistentAfterTransfer: boolean; authorityPresent: boolean }[]; blockingPlugins: BlockingPlugin[]; transferable: boolean; mutableTransferControl: boolean;
    currentFrozen?: boolean; futureFreezeAuthorityPresent?: boolean; currentStateEvidenceComplete?: boolean;
    destructiveTransferAuthorityPresent?: boolean; destructiveBurnAuthorityPresent?: boolean;
    /** Current Core conditions only; not proof of funding, custody, or a fresh commit. */
    currentStateSettlementEligible?: boolean;
    entitlementState?: 'ENTITLED_PENDING_DELIVERY';
    releaseBlockedByCurrentFreeze?: boolean; releaseRetryableAfterThaw?: boolean;
  }
  provider?: { source: 'rpc' | 'das'; method: typeof methods[number]; failure: typeof failures[number]; httpStatus?: number; attempt?: number; jsonRpcCode?: number; jsonRpcClass?: 'rate_limit' | 'min_context_slot' | 'node_unavailable' | 'generic_json_rpc' }
}
const record = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const member = <T extends string>(v: unknown, values: readonly T[]): v is T => typeof v === 'string' && values.includes(v as T)
const integer = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max
const blocking = new Set<string>(['non_transferable', ...['asset', 'collection'].flatMap(scope => blockingNames.map(name => `${scope}:${name}`))])

/** Whitelist reconstruction only: never retain arbitrary provider/request data. */
export function sanitizeTradeV2DiagnosticEvidence(value: unknown): TradeV2DiagnosticEvidence | null {
  try {
    if (!record(value) || !member(value.stage, stages)) return null
    const out: TradeV2DiagnosticEvidence = { stage: value.stage }
    if (integer(value.selectionIndex, 0, 15)) out.selectionIndex = value.selectionIndex
    if (member(value.side, ['maker', 'taker'])) out.side = value.side
    if (integer(value.index, 0, 7)) out.index = value.index
    if (member(value.rail, rails)) out.rail = value.rail
    if (member(value.lifecyclePolicy, lifecyclePolicies)) out.lifecyclePolicy = value.lifecyclePolicy
    if (typeof value.blocker === 'string' && value.blocker.length <= 80 && safeAssetResolutionErrorCode(value.blocker) === value.blocker && value.blocker !== 'UNKNOWN') out.blocker = value.blocker
    const c = value.core
    if (record(c) && typeof c.transferable === 'boolean' && typeof c.mutableTransferControl === 'boolean') {
      const freezePlugins: NonNullable<TradeV2DiagnosticEvidence['core']>['freezePlugins'] = []
      if (Array.isArray(c.freezePlugins)) for (const p of c.freezePlugins.slice(0, 4)) {
        if (record(p) && member(p.scope, ['asset', 'collection']) && member(p.plugin, ['FreezeDelegate', 'PermanentFreezeDelegate']) && member(p.authorityType, authorities) && typeof p.frozen === 'boolean' && typeof p.persistentAfterTransfer === 'boolean' && typeof p.authorityPresent === 'boolean') {
          freezePlugins.push({ scope:p.scope, plugin:p.plugin, authorityType:p.authorityType, frozen:p.frozen, persistentAfterTransfer:p.persistentAfterTransfer, authorityPresent:p.authorityPresent })
        }
      }
      out.core = { freezePlugins, blockingPlugins: Array.isArray(c.blockingPlugins) ? c.blockingPlugins.slice(0, 16).filter((p: unknown): p is BlockingPlugin => typeof p === 'string' && blocking.has(p)) : [], transferable:c.transferable, mutableTransferControl:c.mutableTransferControl }
      // Derive bounded facts from the same sanitized observation. Never trust
      // caller-provided entitlement/eligibility booleans, nor log asset/authority IDs.
      const currentFrozen = freezePlugins.some(plugin => plugin.frozen)
      const destructiveTransferAuthorityPresent = out.core.blockingPlugins.some(plugin => plugin.endsWith(':permanentTransferDelegate'))
      const destructiveBurnAuthorityPresent = out.core.blockingPlugins.some(plugin => plugin.endsWith(':permanentBurnDelegate'))
      const release = out.lifecyclePolicy === 'release'
      const completeBlockerEvidence = c.currentStateEvidenceComplete !== false && Array.isArray(c.blockingPlugins) && c.blockingPlugins.length <= 16
        && Array.isArray(c.freezePlugins) && c.freezePlugins.length === freezePlugins.length
        && c.blockingPlugins.every((plugin: unknown) => typeof plugin === 'string' && blocking.has(plugin))
      const freezeOnlyBlockers = completeBlockerEvidence && out.core.blockingPlugins.every(plugin => plugin === 'non_transferable'
        || plugin.endsWith(':FreezeDelegate') || plugin.endsWith(':PermanentFreezeDelegate'))
      Object.assign(out.core, {
        currentFrozen, currentStateEvidenceComplete:completeBlockerEvidence,
        futureFreezeAuthorityPresent: freezePlugins.some(plugin => plugin.persistentAfterTransfer && plugin.authorityPresent),
        destructiveTransferAuthorityPresent, destructiveBurnAuthorityPresent,
        currentStateSettlementEligible: completeBlockerEvidence && !currentFrozen && c.transferable && out.core.blockingPlugins.length === 0,
        ...(release ? {entitlementState:'ENTITLED_PENDING_DELIVERY' as const,
          releaseBlockedByCurrentFreeze:currentFrozen && !c.transferable,
          releaseRetryableAfterThaw:currentFrozen && !c.transferable && freezeOnlyBlockers} : {}),
      })
    }
    const p = value.provider
    if (record(p) && member(p.source, ['rpc', 'das']) && member(p.method, methods) && member(p.failure, failures)) {
      out.provider = { source:p.source, method:p.method, failure:p.failure }
      if (integer(p.httpStatus, 100, 599)) out.provider.httpStatus = p.httpStatus
      if (integer(p.attempt, 1, 3)) out.provider.attempt = p.attempt
      if (p.failure === 'json_rpc') {
        // Numeric provider codes only: never classify by or retain free-form messages/data.
        // Re-derive on each hop rather than trusting a caller-supplied class.
        const code = integer(p.jsonRpcCode, -2147483648, 2147483647) ? p.jsonRpcCode : undefined
        if (code !== undefined) out.provider.jsonRpcCode = code
        out.provider.jsonRpcClass = code === 429 || code === -32429 ? 'rate_limit'
          : code === -32016 ? 'min_context_slot'
            : code === -32005 ? 'node_unavailable' : 'generic_json_rpc'
      }
    }
    return out
  } catch { return null }
}
