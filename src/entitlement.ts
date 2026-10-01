import type { ProposalSide, TradeV2Rail } from './protocol.js'

export const TRADE_AUTHORITY_SETTLEMENT_MODEL = 'atomic_entitlement_durable_delivery' as const

export type TradeAuthorityEntitlementState =
  | 'NOT_SETTLED'
  | 'ENTITLED_PENDING_DELIVERY'
  | 'DELIVERED'

export type TradeAuthorityProductState =
  | 'READY_TO_SETTLE'
  | 'SETTLED_PENDING_DELIVERY'
  | 'DELIVERY_COMPLETE'

export type TradeAuthorityEntitlementParticipants = {
  readonly maker: string
  readonly taker: string
}

export function tradeAuthorityEntitlementBeneficiary(
  side: ProposalSide,
  participants: TradeAuthorityEntitlementParticipants,
): string {
  return side === 'maker' ? participants.taker : participants.maker
}

export function tradeAuthorityOriginalDepositor(
  side: ProposalSide,
  participants: TradeAuthorityEntitlementParticipants,
): string {
  return side === 'maker' ? participants.maker : participants.taker
}

export function deriveTradeAuthorityEntitlementState(args: {
  readonly phase: string
  readonly slotStatus: string
}): TradeAuthorityEntitlementState {
  if (args.slotStatus === 'released') return 'DELIVERED'
  if ((args.phase === 'committed' || args.phase === 'releasing') && args.slotStatus === 'deposited') {
    return 'ENTITLED_PENDING_DELIVERY'
  }
  return 'NOT_SETTLED'
}

export function deriveTradeAuthorityProductState(args: {
  readonly phase: string
  readonly slots: readonly { readonly status: string }[]
  readonly terminalVerified?: boolean
}): TradeAuthorityProductState {
  if (args.terminalVerified === true && args.slots.every((slot) => slot.status === 'released')) {
    return 'DELIVERY_COMPLETE'
  }
  if (args.phase === 'committed' || args.phase === 'releasing' || args.phase === 'settled') {
    return 'SETTLED_PENDING_DELIVERY'
  }
  return 'READY_TO_SETTLE'
}

export type TradeAuthorityClaimabilityEvidence =
  | {
      readonly kind: 'spl'
      readonly mint: string
      readonly freezeAuthority: string | null
      readonly custodyDelegate: string | null
      readonly frozen?: boolean
    }
  | {
      readonly kind: 'token2022'
      readonly mint: string
      readonly freezeAuthority: string | null
      readonly extensionFree: boolean
      readonly custodyDelegate: string | null
      readonly frozen?: boolean
    }
  | {
      readonly kind: 'pnft'
      readonly mint: string
      readonly metadataImmutable: boolean
      readonly ruleSet: string | null
      readonly externalDelegate: boolean
      readonly tokenRecordUnlocked: boolean
    }
  | {
      readonly kind: 'core'
      readonly assetId: string
      readonly externalFreezeAuthority: string | null
      readonly blockingPlugins: readonly string[]
      readonly transferable: boolean
      readonly updateAuthorityCanAddBlockingPlugin: boolean
    }
  | {
      readonly kind: 'compressed_nft'
      readonly assetId: string
      readonly tree: string
      readonly leafIndex: number
      readonly proofRefreshSupported: boolean
      readonly externalLeafDelegate: string | null
    }
  | {
      readonly kind: 'sol'
      readonly commitTransferSupported: boolean
    }

type ClaimabilityLeg = {
  readonly side: ProposalSide
  readonly index: number
  readonly kind: TradeV2Rail
  readonly mint?: string | null
  readonly assetId?: string | null
  readonly tree?: string | null
  readonly leafIndex?: number | null
}

export type TradeAuthorityLifecyclePolicy = 'admission' | 'custody' | 'release' | 'recovery'

export function tradeAuthorityObservationPolicy(phase: string, status: string): TradeAuthorityLifecyclePolicy {
  if (status === 'deposited') return phase === 'committed' || phase === 'releasing' ? 'release' : phase === 'cancelling' || phase === 'recovery' ? 'recovery' : 'custody'
  return 'admission'
}

export type TradeAuthorityClaimabilityDecision = {
  readonly policy?: TradeAuthorityLifecyclePolicy
  readonly source: 'authenticated_oracle'
  readonly side: ProposalSide
  readonly index: number
  readonly identity: string
  readonly oracleSequence: string
  readonly observedSlot: string
  readonly verdict: 'claimable' | 'unsupported'
  readonly evidence: TradeAuthorityClaimabilityEvidence
  readonly blockers: readonly string[]
}

export function tradeAuthorityClaimabilityIdentity(leg: ClaimabilityLeg): string {
  if (leg.kind === 'compressed_nft') return `${leg.assetId}:${leg.tree}:${leg.leafIndex}`
  if (leg.kind === 'core') return String(leg.assetId)
  if (leg.kind === 'sol') return `sol:${leg.side}`
  return String(leg.mint)
}

export function tradeAuthorityClaimabilityBlockers(
  leg: ClaimabilityLeg,
  evidence: TradeAuthorityClaimabilityEvidence | undefined,
): readonly string[] {
  const at = `${leg.side}:${leg.index}`
  if (!evidence || evidence.kind !== leg.kind) return [`CLAIMABILITY_EVIDENCE_REQUIRED:${at}`]
  if ((leg.kind === 'spl' || leg.kind === 'token2022' || leg.kind === 'pnft') && evidence.kind === leg.kind) {
    if (evidence.mint !== leg.mint) return [`CLAIMABILITY_IDENTITY_MISMATCH:${at}`]
  }
  // Legacy wire evidence stays decodable, but absence is not proof of an unfrozen account.
  // Require a fresh affirmative observation before admission or irreversible commit.
  if ((evidence.kind === 'spl' || evidence.kind === 'token2022') && typeof evidence.frozen !== 'boolean') return [`CLAIMABILITY_EVIDENCE_REQUIRED:${at}`]
  if (leg.kind === 'spl' && evidence.kind === 'spl') {
    if (evidence.frozen === true) return [`SPL_CURRENT_TRANSFER_FROZEN:${at}`]
    return evidence.freezeAuthority !== null || evidence.custodyDelegate !== null
      ? [`SPL_MUTABLE_TRANSFER_AUTHORITY_UNSUPPORTED:${at}`] : []
  }
  if (leg.kind === 'token2022' && evidence.kind === 'token2022') {
    const blockers: string[] = []
    if (evidence.frozen === true) blockers.push(`TOKEN_2022_CURRENT_TRANSFER_FROZEN:${at}`)
    if (evidence.freezeAuthority !== null) blockers.push(`TOKEN_2022_FREEZE_AUTHORITY_UNSUPPORTED:${at}`)
    if (evidence.extensionFree !== true) blockers.push(`TOKEN_2022_EXTENSIONS_UNSUPPORTED:${at}`)
    if (evidence.custodyDelegate !== null) blockers.push(`TOKEN_2022_CUSTODY_DELEGATE_UNSUPPORTED:${at}`)
    return blockers
  }
  if (leg.kind === 'pnft' && evidence.kind === 'pnft') {
    const blockers: string[] = []
    if (evidence.metadataImmutable !== true) blockers.push(`PNFT_MUTABLE_METADATA_UNSUPPORTED:${at}`)
    if (evidence.ruleSet !== null) blockers.push(`PNFT_RULE_SET_UNSUPPORTED:${at}`)
    if (evidence.externalDelegate !== false) blockers.push(`PNFT_EXTERNAL_DELEGATE_UNSUPPORTED:${at}`)
    if (evidence.tokenRecordUnlocked !== true) blockers.push(`PNFT_LOCKED_TOKEN_RECORD_UNSUPPORTED:${at}`)
    return blockers
  }
  if (leg.kind === 'core' && evidence.kind === 'core') {
    if (evidence.assetId !== leg.assetId) return [`CLAIMABILITY_IDENTITY_MISMATCH:${at}`]
    if (!Array.isArray(evidence.blockingPlugins) || evidence.blockingPlugins.some(value => typeof value !== 'string')
      || typeof evidence.transferable !== 'boolean' || typeof evidence.updateAuthorityCanAddBlockingPlugin !== 'boolean'
      || (evidence.externalFreezeAuthority !== null && typeof evidence.externalFreezeAuthority !== 'string')) {
      return [`CLAIMABILITY_EVIDENCE_REQUIRED:${at}`]
    }
    const blockers: string[] = []
    if (evidence.blockingPlugins.length > 0) blockers.push(`CORE_BLOCKING_PLUGIN_UNSUPPORTED:${at}`)
    if (evidence.transferable !== true) blockers.push(`CORE_NONTRANSFERABLE_UNSUPPORTED:${at}`)
    // Future mutable freeze/royalty rules affect withdrawal liveness, not the
    // immutable counterparty entitlement created by Committed. Current blockers
    // and destructive permanent delegates remain admission failures above.
    return blockers
  }
  if (leg.kind === 'compressed_nft' && evidence.kind === 'compressed_nft') {
    if (evidence.assetId !== leg.assetId || evidence.tree !== leg.tree || evidence.leafIndex !== leg.leafIndex) {
      return [`CLAIMABILITY_IDENTITY_MISMATCH:${at}`]
    }
    const blockers: string[] = []
    if (evidence.proofRefreshSupported !== true) blockers.push(`CNFT_PROOF_REFRESH_REQUIRED:${at}`)
    if (evidence.externalLeafDelegate !== null) blockers.push(`CNFT_EXTERNAL_LEAF_DELEGATE_UNSUPPORTED:${at}`)
    return blockers
  }
  if (leg.kind === 'sol' && evidence.kind === 'sol') {
    return evidence.commitTransferSupported === true ? [] : [`SOL_COMMIT_TRANSFER_UNSUPPORTED:${at}`]
  }
  return [`CLAIMABILITY_EVIDENCE_REQUIRED:${at}`]
}

/** Admission is deliberately not the policy for returning already-held property. */
export const tradeAuthorityAdmissionSafetyBlockers = tradeAuthorityClaimabilityBlockers

export function tradeAuthorityCurrentTransferBlockers(leg: ClaimabilityLeg, evidence: TradeAuthorityClaimabilityEvidence | undefined): readonly string[] {
  const at = `${leg.side}:${leg.index}`
  if (!evidence || evidence.kind !== leg.kind) return [`CLAIMABILITY_EVIDENCE_REQUIRED:${at}`]
  if ('mint' in evidence && evidence.mint !== leg.mint) return [`CLAIMABILITY_IDENTITY_MISMATCH:${at}`]
  if ('assetId' in evidence && evidence.assetId !== leg.assetId) return [`CLAIMABILITY_IDENTITY_MISMATCH:${at}`]
  if ((evidence.kind === 'spl' || evidence.kind === 'token2022') && typeof evidence.frozen !== 'boolean') return [`CLAIMABILITY_EVIDENCE_REQUIRED:${at}`]
  switch (evidence.kind) {
    case 'spl': return evidence.frozen === true ? [`SPL_CURRENT_TRANSFER_FROZEN:${at}`] : []
    case 'token2022': return [...(evidence.frozen === true ? [`TOKEN_2022_CURRENT_TRANSFER_FROZEN:${at}`] : []), ...(evidence.extensionFree !== true ? [`TOKEN_2022_EXTENSIONS_UNSUPPORTED:${at}`] : [])]
    case 'core': return evidence.transferable === true ? [] : [`CORE_CURRENT_TRANSFER_BLOCKED:${at}`]
    case 'pnft': return [...(evidence.ruleSet !== null ? [`PNFT_RULE_SET_UNSUPPORTED:${at}`] : []), ...(evidence.tokenRecordUnlocked !== true ? [`PNFT_LOCKED_TOKEN_RECORD_UNSUPPORTED:${at}`] : []), ...(evidence.externalDelegate ? [`PNFT_EXTERNAL_DELEGATE_UNSUPPORTED:${at}`] : [])]
    // The current Bubblegum CPI still requires owner==delegate and a fresh proof.
    case 'compressed_nft': return tradeAuthorityAdmissionSafetyBlockers(leg, evidence)
    case 'sol': return evidence.commitTransferSupported ? [] : [`SOL_COMMIT_TRANSFER_UNSUPPORTED:${at}`]
  }
}

export function deriveTradeAuthorityClaimabilityDecision(args: {
  readonly leg: ClaimabilityLeg
  readonly evidence: TradeAuthorityClaimabilityEvidence
  readonly policy?: TradeAuthorityLifecyclePolicy
  readonly oracleSequence: string
  readonly observedSlot: string
}): TradeAuthorityClaimabilityDecision {
  if (!/^\d+$/.test(args.oracleSequence) || !/^\d+$/.test(args.observedSlot)) {
    throw new Error('CLAIMABILITY_ORACLE_BINDING_INVALID')
  }
  const policy = args.policy ?? 'admission'
  const blockers = policy === 'admission' ? tradeAuthorityAdmissionSafetyBlockers(args.leg, args.evidence) : tradeAuthorityCurrentTransferBlockers(args.leg, args.evidence)
  return {
    policy,
    source: 'authenticated_oracle',
    side: args.leg.side,
    index: args.leg.index,
    identity: tradeAuthorityClaimabilityIdentity(args.leg),
    oracleSequence: args.oracleSequence,
    observedSlot: args.observedSlot,
    verdict: blockers.length === 0 ? 'claimable' : 'unsupported',
    evidence: args.evidence,
    blockers,
  }
}

export function verifyTradeAuthorityClaimabilityDecision(args: {
  readonly leg: ClaimabilityLeg
  readonly decision: TradeAuthorityClaimabilityDecision | undefined
  readonly expectedOracleSequence: string
  readonly expectedObservedSlot: string
  readonly expectedPolicy?: TradeAuthorityLifecyclePolicy
}): readonly string[] {
  const at = `${args.leg.side}:${args.leg.index}`
  const decision = args.decision
  if (!decision || decision.source !== 'authenticated_oracle') return [`AUTHORITATIVE_CLAIMABILITY_REQUIRED:${at}`]
  const blockers: string[] = []
  if (decision.side !== args.leg.side || decision.index !== args.leg.index
    || decision.identity !== tradeAuthorityClaimabilityIdentity(args.leg)) blockers.push(`CLAIMABILITY_DECISION_IDENTITY_MISMATCH:${at}`)
  if (decision.oracleSequence !== args.expectedOracleSequence || decision.observedSlot !== args.expectedObservedSlot) {
    blockers.push(`CLAIMABILITY_DECISION_STALE:${at}`)
  }
  const policy = args.expectedPolicy ?? 'admission'
  if ((decision.policy ?? 'admission') !== policy) blockers.push(`CLAIMABILITY_POLICY_MISMATCH:${at}`)
  const derived = policy === 'admission' ? tradeAuthorityAdmissionSafetyBlockers(args.leg, decision.evidence) : tradeAuthorityCurrentTransferBlockers(args.leg, decision.evidence)
  if (decision.verdict !== (derived.length === 0 ? 'claimable' : 'unsupported')
    || decision.blockers.length !== derived.length || decision.blockers.some((item, index) => item !== derived[index])) {
    blockers.push(`CLAIMABILITY_DECISION_FORGED:${at}`)
  }
  if (decision.verdict !== 'claimable') blockers.push(...derived)
  return blockers
}

export function assertTradeAuthorityEntitlementReadiness(args: {
  readonly phase: 'taker_funding'
  readonly participants: TradeAuthorityEntitlementParticipants
  readonly oracleSequence: string
  readonly observedSlot: string
  readonly slots: readonly (ClaimabilityLeg & {
    readonly status: 'deposited' | 'required'
    readonly beneficiary: string
    readonly claimabilityDecision?: TradeAuthorityClaimabilityDecision
  })[]
}): void {
  const blockers: string[] = []
  if (!/^\d+$/.test(args.oracleSequence) || !/^\d+$/.test(args.observedSlot)) {
    blockers.push('CLAIMABILITY_ORACLE_BINDING_INVALID')
  }
  for (const slot of args.slots) {
    if (slot.status !== 'deposited') blockers.push(`SLOT_NOT_FUNDED:${slot.side}:${slot.index}`)
    const beneficiary = tradeAuthorityEntitlementBeneficiary(slot.side, args.participants)
    if (slot.beneficiary !== beneficiary) blockers.push(`ENTITLEMENT_BENEFICIARY_MISMATCH:${slot.side}:${slot.index}`)
    blockers.push(...verifyTradeAuthorityClaimabilityDecision({
      leg: slot,
      decision: slot.claimabilityDecision,
      expectedOracleSequence: args.oracleSequence,
      expectedObservedSlot: args.observedSlot,
      expectedPolicy: slot.claimabilityDecision?.policy ?? 'admission',
    }))
    // Commit is a new irreversible obligation. Recheck future-exit safety here,
    // never as a prerequisite for cancellation or delivery observations.
    blockers.push(...tradeAuthorityAdmissionSafetyBlockers(slot, slot.claimabilityDecision?.evidence))
  }
  if (blockers.length > 0) throw new Error(`ENTITLEMENT_READINESS_FAILED:${blockers.join(',')}`)
}
