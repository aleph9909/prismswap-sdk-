import { sha256 } from '@noble/hashes/sha2'
import bs58 from 'bs58'
export { TRADE_V2_DIAGNOSTIC_HEADER, readTradeV2DiagnosticId, sanitizeTradeV2DiagnosticEvidence, type TradeV2DiagnosticEvidence } from './diagnostics.js'

export const TRADE_V2_PROTOCOL_VERSION = 1 as const
export const TRADE_V2_COMMITMENT_SCHEMA_VERSION = 1 as const
export const TRADE_V2_ORACLE_SCHEMA_VERSION = 1 as const
export const TRADE_V2_OBSERVATION_SCHEMA_VERSION = 1 as const
export const TRADE_V2_LIFECYCLE_OBSERVATION_SCHEMA_VERSION = 2 as const
export const TRADE_V2_SUPPORTED_PROGRAM_VERSIONS = [2] as const
export const TRADE_V2_DOMAIN_SEPARATOR = new TextDecoder().decode(Uint8Array.from([83,87,65,80,70,85,78,95,84,82,65,68,69,95,65,85,84,72,79,82,73,84,89,95,86,50,0]))
export const TRADE_V2_MAX_NON_SOL_ASSETS_PER_SIDE = 8 as const
export const TRADE_V2_FUTURE_PROTOCOL_FEATURES = {
  basketSupport: 'trade_session_execution_strategy',
  maxNonSolAssetsPerSide: TRADE_V2_MAX_NON_SOL_ASSETS_PER_SIDE,
  solRepresentation: 'aggregate_lamports_per_side',
} as const

export const TRADE_V2_ERROR = {
  INVALID_ASSETS: 'INVALID_ASSETS',
  INVALID_PROPOSAL_ASSET: 'INVALID_PROPOSAL_ASSET',
  INVALID_DECIMAL_STRING: 'INVALID_DECIMAL_STRING',
  INVALID_AMOUNT: 'INVALID_AMOUNT',
  AMOUNT_OUT_OF_RANGE: 'AMOUNT_OUT_OF_RANGE',
  DUPLICATE_SOL_LEG: 'DUPLICATE_SOL_LEG',
  DUPLICATE_ASSET_INDEX: 'DUPLICATE_ASSET_INDEX',
  DUPLICATE_ASSET: 'DUPLICATE_ASSET',
  MAX_BASKET_SIZE_EXCEEDED: 'MAX_BASKET_SIZE_EXCEEDED',
  INVALID_UUID: 'INVALID_UUID',
  INVALID_PUBLIC_KEY: 'INVALID_PUBLIC_KEY',
  INVALID_ORACLE_OBSERVATION: 'INVALID_ORACLE_OBSERVATION',
  UNSUPPORTED_ORACLE_PROGRAM_VERSION: 'UNSUPPORTED_ORACLE_PROGRAM_VERSION',
  TERMINAL_CUSTODY_NOT_GONE: 'TERMINAL_CUSTODY_NOT_GONE',
  INCONSISTENT_CLOSURE_PROOF: 'INCONSISTENT_CLOSURE_PROOF',
  INCOMPLETE_CLOSURE_PROOF: 'INCOMPLETE_CLOSURE_PROOF',
  SETTLEMENT_CLOSURE_KIND_REQUIRED: 'SETTLEMENT_CLOSURE_KIND_REQUIRED',
  CANCELLATION_CLOSURE_KIND_REQUIRED: 'CANCELLATION_CLOSURE_KIND_REQUIRED',
  TERMINAL_PROOF_REQUIRED: 'TERMINAL_PROOF_REQUIRED',
  UNSUPPORTED_CLOSURE_INSTRUCTION: 'UNSUPPORTED_CLOSURE_INSTRUCTION',
  SETTLEMENT_INSTRUCTION_REQUIRED: 'SETTLEMENT_INSTRUCTION_REQUIRED',
  CANCELLATION_INSTRUCTION_REQUIRED: 'CANCELLATION_INSTRUCTION_REQUIRED',
  INVALID_ORACLE_INITIALIZATION_EVIDENCE: 'INVALID_ORACLE_INITIALIZATION_EVIDENCE',
} as const
export type TradeV2ErrorCode = typeof TRADE_V2_ERROR[keyof typeof TRADE_V2_ERROR]

export type ProposalSide = 'maker' | 'taker'
export type ProposalStatus = 'draft' | 'sent' | 'approved' | 'expired' | 'closed'
export type ApprovalStatus = 'pending' | 'approved' | 'revoked'
export type TradeLifecycle = 'open' | 'closed_off_chain' | 'escrow_pending' | 'bound' | 'settled' | 'cancelled' | 'expired'
export type EscrowLifecycle = 'initializing' | 'active' | 'settling' | 'expired' | 'recoverable' | 'settled' | 'cancelled' | 'closed' | 'unknown'
export type OracleCustody = 'present' | 'gone' | 'unknown' | 'conflict'
export type OracleClosureKind = 'settled' | 'cancelled'
export type OracleTerminalProof = OracleClosureKind | 'closed'
export type KnownOracleRecoveryAction = 'cancel_escrow_v2' | 'recover_escrow_v2_heavy_split_taker_cnft'
export type CustomOracleRecoveryAction = string & { readonly __tradeV2CustomOracleRecoveryAction?: unique symbol }
export type OracleRecoveryAction = KnownOracleRecoveryAction | CustomOracleRecoveryAction
export type OracleLifecycleState = EscrowLifecycle

/**
 * Public, server-owned Trade Authority V2 inbox vocabulary.
 *
 * These values are shared by the server and browser so React never has to
 * reinterpret Oracle lifecycle evidence or reconstruct action authority.
 */
export const TRADE_V2_INBOX_STATUSES = [
  'sent_unseen',
  'sent_seen',
  'awaiting_your_approval',
  'awaiting_their_approval',
  'agreed_awaiting_escrow',
  'escrow_submitted_verifying',
  'closed_off_chain',
  'expired',
  'awaiting_taker_acceptance',
  'accepted_awaiting_funding',
  'awaiting_maker_funding',
  'awaiting_taker_funding',
  'partially_funded',
  'fully_funded_ready_to_settle',
  'oracle_verifying',
  'settlement_verifying',
  'settled',
  'cancel_in_progress',
  'cancelled',
  'recovery_available',
  'recovery_in_progress',
  'recovered',
  'oracle_conflict',
  // Existing Phase 5A compatibility statuses for loaded legacy/orphan rows.
  // The browser must preserve these rows rather than discard unknown custody.
  'settlement_in_progress',
  'expired_recovery_available',
  'recovery_required',
  'escrow_initialized_awaiting_custody',
  'escrow_loaded_awaiting_counterparty',
] as const
export type TradeV2InboxStatus = typeof TRADE_V2_INBOX_STATUSES[number]

export const TRADE_V2_INBOX_ACTIONS = [
  'approve',
  'create_escrow',
  'accept',
  'fund',
  'settle',
  'cancel',
  'recover',
  'withdraw',
  'complete_exit', 'release', 'close_session',
  'wait_for_oracle',
  'none',
] as const
export type TradeV2InboxAction = typeof TRADE_V2_INBOX_ACTIONS[number]

export const TRADE_V2_SUBMITTED_TRANSITIONS = [
  'authority_initialized',
  'acceptance_recorded',
  'maker_sol_funded',
  'maker_asset_funded',
  'taker_sol_funded',
  'taker_asset_funded',
  'settlement_completed',
  'cancellation_initiated',
  'recovery_initiated',
  'maker_sol_withdrawn',
  'maker_asset_withdrawn',
  'taker_sol_withdrawn',
  'taker_asset_withdrawn',
  'exit_completed',
] as const
export type TradeV2SubmittedTransition = typeof TRADE_V2_SUBMITTED_TRANSITIONS[number]

export const TRADE_V2_STANDARD_RAILS = ['sol', 'spl', 'token2022'] as const
export const TRADE_V2_RAILS = [...TRADE_V2_STANDARD_RAILS, 'core', 'pnft', 'compressed_nft'] as const
export type TradeV2StandardRail = typeof TRADE_V2_STANDARD_RAILS[number]
export type TradeV2Rail = typeof TRADE_V2_RAILS[number]

export function isTradeV2InboxStatus(value: unknown): value is TradeV2InboxStatus {
  return typeof value === 'string' && (TRADE_V2_INBOX_STATUSES as readonly string[]).includes(value)
}

export function isTradeV2InboxAction(value: unknown): value is TradeV2InboxAction {
  return typeof value === 'string' && (TRADE_V2_INBOX_ACTIONS as readonly string[]).includes(value)
}

export function isTradeV2SubmittedTransition(value: unknown): value is TradeV2SubmittedTransition {
  return typeof value === 'string' && (TRADE_V2_SUBMITTED_TRANSITIONS as readonly string[]).includes(value)
}

export function isTradeV2StandardRailAsset(value: Pick<ProposalAsset, 'kind'>): boolean {
  return (TRADE_V2_STANDARD_RAILS as readonly string[]).includes(value.kind)
}

export type SolProposalAsset = { readonly side: ProposalSide; readonly index: 0; readonly kind: 'sol'; readonly lamports: string }
export type SplProposalAsset = { readonly side: ProposalSide; readonly index: number; readonly kind: 'spl'; readonly mint: string; readonly amount: string }
export type Token2022ProposalAsset = { readonly side: ProposalSide; readonly index: number; readonly kind: 'token2022'; readonly mint: string; readonly amount: string }
export type PnftProposalAsset = { readonly side: ProposalSide; readonly index: number; readonly kind: 'pnft'; readonly mint: string }
export type CompressedNftProposalAsset = { readonly side: ProposalSide; readonly index: number; readonly kind: 'compressed_nft'; readonly assetId: string; readonly tree: string; readonly leafIndex: number }
export type CoreProposalAsset = { readonly side: ProposalSide; readonly index: number; readonly kind: 'core'; readonly assetId: string }
export type NonSolProposalAsset = SplProposalAsset | Token2022ProposalAsset | PnftProposalAsset | CompressedNftProposalAsset | CoreProposalAsset
export type ProposalAsset = SolProposalAsset | NonSolProposalAsset
export type ProposalTerms = {
  readonly maker: string
  readonly taker: string
  readonly assets: readonly NonSolProposalAsset[]
  readonly makerSolLamports: string
  readonly takerSolLamports: string
  readonly expiresAt: string
  readonly protocolVersion: number
}
export type TradeAuthorityExecutionStrategy = 'trade_v2_atomic' | 'trade_session'

export function selectTradeAuthorityExecutionStrategy(_terms: Pick<ProposalTerms, 'assets'>): TradeAuthorityExecutionStrategy {
  // New Trade Authority proposals use one settlement contract at every
  // supported basket size. `trade_v2_atomic` remains decodable only for
  // historical rows; it is never selected for forward construction.
  return 'trade_session'
}
export type TradeV2OracleInitializedAccountEvidence = {
  readonly kind: 'trade_v2_initialized_account_only'
  readonly source: 'chain'
  readonly programId: string
  readonly maker: string
  readonly taker: string
  readonly escrowPda: string
  readonly tradeCommitment: string
  readonly allowedRecoverer: string | null
  readonly schemaVersion: number
  readonly programVersion: number
  readonly accountSlot: string
  readonly verifiedPdaDerivation: true
}
export type TradeV2OracleInitializationTransactionEvidence = {
  readonly kind: 'trade_v2_initialization_transaction'
  readonly source: 'chain'
  readonly transactionSignature: string
  readonly transactionSlot: string
  readonly confirmationStatus: 'confirmed' | 'finalized'
  readonly blockTime: number | null
  readonly initializeInstructionVerified: true
  readonly payer: string
  readonly maker: string
  readonly taker: string
  readonly escrowPda: string
  readonly tradeCommitment: string
  readonly allowedRecoverer: string | null
  readonly schemaVersion: number
  readonly programVersion: number
  readonly accountSlot: string
  readonly verifiedPdaDerivation: true
}
export type TradeV2OracleInitializationEvidence = TradeV2OracleInitializedAccountEvidence | TradeV2OracleInitializationTransactionEvidence

export type TradeV2OracleDecodedTerms = {
  readonly assets: readonly ProposalAsset[]
  readonly makerSolLamports: string
  readonly takerSolLamports: string
}
export type TradeV2OracleObservation = {
  readonly schemaVersion: typeof TRADE_V2_OBSERVATION_SCHEMA_VERSION
  readonly cluster: string
  readonly programId: string
  readonly programVersion: number
  readonly escrowPda: string
  readonly observationSequence: string
  readonly observedSlot: string
  readonly observedAt: string
  readonly accountExists: boolean
  readonly accountActive: boolean
  readonly accountOwnerVerified: boolean
  readonly accountDiscriminatorVerified: boolean
  readonly tradeCommitment: string | null
  readonly maker: string | null
  readonly taker: string | null
  readonly decodedTerms: TradeV2OracleDecodedTerms | null
  readonly makerCustody: OracleCustody
  readonly takerCustody: OracleCustody
  readonly lifecycle: OracleLifecycleState
  readonly closureKind: OracleClosureKind | null
  readonly closureSignature: string | null
  readonly closureInstruction: string | null
  readonly recoveryAction: OracleRecoveryAction | null
  readonly allowedRecoverer: string | null
  readonly evidence: unknown
}

export type TradeV2LifecycleVerdict =
  | 'initializing'
  | 'awaiting_acceptance'
  | 'accepted_unfunded'
  | 'partially_funded'
  | 'fully_funded'
  | 'settled'
  | 'cancel_initiated'
  | 'cancel_complete'
  | 'recovery_initiated'
  | 'recovery_complete'
  | 'expired_awaiting_recovery'
  | 'invalid'
  | 'conflict'
  | 'unknown'

export type TradeV2EvidenceVerdict = 'verified' | 'excess' | 'missing' | 'invalid' | 'conflict' | 'unknown' | 'not_required'
export type TradeV2AccountExistence = 'exists' | 'missing' | 'unknown'
export type TradeV2AccountBindingVerdict = 'verified' | 'invalid' | 'conflict' | 'unknown' | 'not_applicable'
export type TradeV2AcceptanceVerdict = 'absent' | 'pending' | 'accepted' | 'invalid' | 'conflict' | 'unknown'
export type TradeV2TerminalCompletionVerdict = 'absent' | 'valid' | 'invalid' | 'conflict' | 'unknown'
export type TradeV2FinalOracleVerdict = 'verified' | 'invalid' | 'conflict' | 'unknown'

export type TradeV2AccountDecodedIdentity = {
  readonly tradeAuthority: string | null
  readonly tradeCustody: string | null
  readonly tradeExecutionPlan: string | null
  readonly tradeFundingState: string | null
  readonly tradeCommitment: string | null
  readonly maker: string | null
  readonly taker: string | null
  readonly outcome: 'cancelled' | 'recovered' | null
}

export type TradeV2CanonicalAccountEvidence = {
  readonly accountType: 'authority' | 'custody' | 'execution_plan' | 'acceptance' | 'funding' | 'terminal_completion'
  readonly expectedPda: string
  readonly existence: TradeV2AccountExistence
  readonly accountOwner: string | null
  readonly ownerVerified: boolean
  readonly discriminatorHex: string | null
  readonly discriminatorVerified: boolean
  readonly schemaVersion: number | null
  readonly programVersion: number | null
  readonly canonicalBump: number | null
  readonly pdaAndBumpVerified: boolean
  readonly reservedBytesVerified: boolean
  readonly decodedIdentity: TradeV2AccountDecodedIdentity
  readonly crossAccountBinding: TradeV2AccountBindingVerdict
  readonly rawDataSha256: string | null
  readonly valid: boolean
}

export type TradeV2ExecutionPlanProjection = {
  readonly makerAsset: ProposalAsset | null
  readonly takerAsset: ProposalAsset | null
  readonly makerSolLamports: string
  readonly takerSolLamports: string
  readonly expiresAt: string
  readonly verified: boolean
}

export type TradeV2AcceptanceProjection = {
  readonly state: TradeV2AcceptanceVerdict
  readonly acceptedAt: string | null
  readonly acceptedSlot: string | null
  readonly verified: boolean
}

export type TradeV2FundingCustodyReference = {
  readonly sol: TradeV2EvidenceVerdict
  readonly asset: TradeV2EvidenceVerdict
}

export type TradeV2FundingSideProjection = {
  readonly solRequired: string
  readonly solDepositedFlag: boolean
  readonly assetRequired: boolean
  readonly assetDepositedFlag: boolean
  readonly fullyFundedStored: boolean
  readonly fullyFundedDerived: boolean
  readonly custodyEvidence: TradeV2FundingCustodyReference
}

export type TradeV2SolCustodyEvidence = {
  readonly totalCustodyLamports: string
  readonly currentDataLength: number
  readonly rentExemptMinimum: string
  readonly principalAboveRent: string
  readonly expectedMakerSolPrincipal: string
  readonly expectedTakerSolPrincipal: string
  readonly expectedCombinedProtocolPrincipal: string
  readonly unsolicitedExcessLamports: string
  readonly missingPrincipalAmount: string
  readonly verdict: TradeV2EvidenceVerdict
}

export type TradeV2TokenCustodyEvidence = {
  readonly side: ProposalSide
  readonly assetKind: 'spl' | 'token2022'
  readonly mint: string
  readonly tokenProgram: string
  readonly expectedCustodyAta: string
  readonly ataExistence: TradeV2AccountExistence
  readonly accountOwner: string | null
  readonly tokenAccountOwner: string | null
  readonly tokenAccountMint: string | null
  readonly amount: string
  readonly expectedPlannedPrincipal: string
  readonly unsolicitedExcess: string
  readonly missingPrincipal: string
  readonly token2022ExtensionVerdict: 'extension_free' | 'not_applicable' | 'unsupported' | 'unknown'
  readonly verdict: TradeV2EvidenceVerdict
}

export type TradeV2CustodyProjection = {
  readonly sol: TradeV2SolCustodyEvidence
  readonly tokenLegs: readonly TradeV2TokenCustodyEvidence[]
  readonly aggregateVerdict: TradeV2EvidenceVerdict
  readonly mayContainProtocolPrincipal: boolean
}

export type TradeV2TerminalCompletionProjection = {
  readonly state: TradeV2TerminalCompletionVerdict
  readonly outcome: 'cancelled' | 'recovered' | null
  readonly completedAt: string | null
  readonly completedSlot: string | null
  readonly verified: boolean
}

export type TradeV2RpcSnapshotEvidence = {
  readonly endpointId: string
  readonly commitment: 'confirmed' | 'finalized'
  readonly contextSlot: string
  readonly readContextSlots: readonly string[]
  readonly maxSlotDrift: number
  readonly sufficientlyConsistent: boolean
  readonly accountFetchLatencyMs: number
}

export type TradeV2OracleLifecycleObservation = {
  readonly schemaVersion: typeof TRADE_V2_LIFECYCLE_OBSERVATION_SCHEMA_VERSION
  readonly cluster: string
  readonly programId: string
  readonly programVersion: number
  readonly oracleObservationId: string
  readonly observationSequence: string
  readonly observedSlot: string
  readonly observedBlockTime: { readonly status: 'available'; readonly unixSeconds: string } | { readonly status: 'unavailable'; readonly reason: string }
  readonly observedAt: string
  readonly authorityPda: string
  readonly custodyPda: string
  readonly executionPlanPda: string
  readonly acceptancePda: string
  readonly fundingPda: string
  readonly terminalCompletionPda: string | null
  readonly tradeCommitment: string
  readonly maker: string
  readonly taker: string
  readonly allowedRecoverer: string | null
  readonly rpcEvidence: TradeV2RpcSnapshotEvidence
  readonly accounts: {
    readonly authority: TradeV2CanonicalAccountEvidence
    readonly custody: TradeV2CanonicalAccountEvidence
    readonly executionPlan: TradeV2CanonicalAccountEvidence
    readonly acceptance: TradeV2CanonicalAccountEvidence
    readonly funding: TradeV2CanonicalAccountEvidence
    readonly terminalCompletion: TradeV2CanonicalAccountEvidence
  }
  readonly executionPlan: TradeV2ExecutionPlanProjection
  readonly acceptance: TradeV2AcceptanceProjection
  readonly funding: {
    readonly maker: TradeV2FundingSideProjection
    readonly taker: TradeV2FundingSideProjection
  }
  readonly custody: TradeV2CustodyProjection
  readonly rawAuthorityLifecycle: 'initialized' | 'settled' | 'cancelled' | 'recovered' | 'unknown'
  readonly derivedLifecycle: TradeV2LifecycleVerdict
  readonly terminalCompletion: TradeV2TerminalCompletionProjection
  readonly finalVerdict: TradeV2FinalOracleVerdict
  readonly conflictCodes: readonly string[]
  readonly unknownReasons: readonly string[]
}

class ProtocolError extends Error {
  constructor(readonly code: TradeV2ErrorCode, message = code) {
    super(message)
  }
}

const encoder = new TextEncoder()
const DECIMAL_RE = /^(0|[1-9][0-9]*)$/
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/
const U64_MAX = 18446744073709551615n
const kindOrder: Record<ProposalAsset['kind'], number> = { sol: 0, spl: 1, token2022: 2, pnft: 3, compressed_nft: 4, core: 5 }
const sideOrder: Record<ProposalSide, number> = { maker: 0, taker: 1 }
const custodyValues = new Set<OracleCustody>(['present', 'gone', 'unknown', 'conflict'])
const lifecycleValues = new Set<OracleLifecycleState>(['initializing', 'active', 'settling', 'expired', 'recoverable', 'settled', 'cancelled', 'closed', 'unknown'])
const observationKeys = ['schemaVersion', 'cluster', 'programId', 'programVersion', 'escrowPda', 'observationSequence', 'observedSlot', 'observedAt', 'accountExists', 'accountActive', 'accountOwnerVerified', 'accountDiscriminatorVerified', 'tradeCommitment', 'maker', 'taker', 'decodedTerms', 'makerCustody', 'takerCustody', 'lifecycle', 'closureKind', 'closureSignature', 'closureInstruction', 'recoveryAction', 'allowedRecoverer', 'evidence'] as const
const decodedTermsKeys = ['assets', 'makerSolLamports', 'takerSolLamports'] as const

const initializedAccountEvidenceKeys = ['kind', 'source', 'programId', 'maker', 'taker', 'escrowPda', 'tradeCommitment', 'allowedRecoverer', 'schemaVersion', 'programVersion', 'accountSlot', 'verifiedPdaDerivation'] as const
const initializationTransactionEvidenceKeys = ['kind', 'source', 'transactionSignature', 'transactionSlot', 'confirmationStatus', 'blockTime', 'initializeInstructionVerified', 'payer', 'maker', 'taker', 'escrowPda', 'tradeCommitment', 'allowedRecoverer', 'schemaVersion', 'programVersion', 'accountSlot', 'verifiedPdaDerivation'] as const
const lifecycleObservationKeys = [
  'schemaVersion', 'cluster', 'programId', 'programVersion', 'oracleObservationId', 'observationSequence',
  'observedSlot', 'observedBlockTime', 'observedAt', 'authorityPda', 'custodyPda', 'executionPlanPda',
  'acceptancePda', 'fundingPda', 'terminalCompletionPda', 'tradeCommitment', 'maker', 'taker',
  'allowedRecoverer', 'rpcEvidence', 'accounts', 'executionPlan', 'acceptance', 'funding', 'custody',
  'rawAuthorityLifecycle', 'derivedLifecycle', 'terminalCompletion', 'finalVerdict', 'conflictCodes',
  'unknownReasons',
] as const
const observedBlockTimeKeys = ['status', 'unixSeconds'] as const
const observedBlockTimeUnavailableKeys = ['status', 'reason'] as const
const rpcEvidenceKeys = ['endpointId', 'commitment', 'contextSlot', 'readContextSlots', 'maxSlotDrift', 'sufficientlyConsistent', 'accountFetchLatencyMs'] as const
const accountsKeys = ['authority', 'custody', 'executionPlan', 'acceptance', 'funding', 'terminalCompletion'] as const
const accountEvidenceKeys = [
  'accountType', 'expectedPda', 'existence', 'accountOwner', 'ownerVerified', 'discriminatorHex',
  'discriminatorVerified', 'schemaVersion', 'programVersion', 'canonicalBump', 'pdaAndBumpVerified',
  'reservedBytesVerified', 'decodedIdentity', 'crossAccountBinding', 'rawDataSha256', 'valid',
] as const
const decodedIdentityKeys = ['tradeAuthority', 'tradeCustody', 'tradeExecutionPlan', 'tradeFundingState', 'tradeCommitment', 'maker', 'taker', 'outcome'] as const
const executionPlanKeys = ['makerAsset', 'takerAsset', 'makerSolLamports', 'takerSolLamports', 'expiresAt', 'verified'] as const
const acceptanceProjectionKeys = ['state', 'acceptedAt', 'acceptedSlot', 'verified'] as const
const fundingKeys = ['maker', 'taker'] as const
const fundingSideKeys = ['solRequired', 'solDepositedFlag', 'assetRequired', 'assetDepositedFlag', 'fullyFundedStored', 'fullyFundedDerived', 'custodyEvidence'] as const
const fundingCustodyKeys = ['sol', 'asset'] as const
const custodyKeys = ['sol', 'tokenLegs', 'aggregateVerdict', 'mayContainProtocolPrincipal'] as const
const solCustodyKeys = [
  'totalCustodyLamports', 'currentDataLength', 'rentExemptMinimum', 'principalAboveRent',
  'expectedMakerSolPrincipal', 'expectedTakerSolPrincipal', 'expectedCombinedProtocolPrincipal',
  'unsolicitedExcessLamports', 'missingPrincipalAmount', 'verdict',
] as const
const tokenCustodyKeys = [
  'side', 'assetKind', 'mint', 'tokenProgram', 'expectedCustodyAta', 'ataExistence', 'accountOwner',
  'tokenAccountOwner', 'tokenAccountMint', 'amount', 'expectedPlannedPrincipal', 'unsolicitedExcess',
  'missingPrincipal', 'token2022ExtensionVerdict', 'verdict',
] as const
const terminalCompletionKeys = ['state', 'outcome', 'completedAt', 'completedSlot', 'verified'] as const
const assetKeys = {
  sol: ['side', 'index', 'kind', 'lamports'],
  spl: ['side', 'index', 'kind', 'mint', 'amount'],
  token2022: ['side', 'index', 'kind', 'mint', 'amount'],
  pnft: ['side', 'index', 'kind', 'mint'],
  compressed_nft: ['side', 'index', 'kind', 'assetId', 'tree', 'leafIndex'],
  core: ['side', 'index', 'kind', 'assetId'],
} as const

export type TradeV2CommitmentInput = {
  readonly cluster: string
  readonly programId: string
  readonly tradeId: string
  readonly proposalId: string
  readonly maker: string
  readonly taker: string
  readonly assets: readonly ProposalAsset[]
  readonly expiresAt: string
  readonly protocolVersion?: number
}

export type TradeV2CommitmentOutput = {
  readonly commitment: string
  readonly termsHash: string
  readonly preimageHex: string
  readonly canonicalTerms: string
  readonly canonicalTermsHex: string
  readonly termsHashHex: string
  readonly commitmentPreimageHex: string
  readonly tradeCommitment: string
}

function bytes(value: string): Uint8Array { return encoder.encode(value) }
function hex(data: Uint8Array): string { return Array.from(data, (b) => b.toString(16).padStart(2, '0')).join('') }
function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const size = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Uint8Array(size)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.length
  }
  return out
}
function fail(code: TradeV2ErrorCode): never { throw new ProtocolError(code) }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === 'object' && !Array.isArray(value)) }
function assertStrictKeys(value: Record<string, unknown>, keys: readonly string[], code: TradeV2ErrorCode): void {
  const allowed = new Set(keys)
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail(code)
  for (const key of keys) if (!(key in value)) fail(code)
}
function validateString(value: unknown, code: TradeV2ErrorCode): string {
  if (typeof value !== 'string') fail(code)
  return value
}
function validateNullableString(value: unknown, code: TradeV2ErrorCode): string | null {
  if (value === null) return null
  return validateString(value, code)
}
function validateIsoDateTime(value: unknown): string {
  const text = validateString(value, TRADE_V2_ERROR.INVALID_ORACLE_OBSERVATION)
  if (!ISO_DATETIME_RE.test(text) || Number.isNaN(Date.parse(text))) fail(TRADE_V2_ERROR.INVALID_ORACLE_OBSERVATION)
  return text
}
function validatePublicKeyString(value: unknown): string {
  const text = validateString(value, TRADE_V2_ERROR.INVALID_PUBLIC_KEY)
  publicKeyBytes(text)
  return text
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const object = value as Record<string, unknown>
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`
}

export function sha256Hex(value: string | Uint8Array): string { return hex(sha256(typeof value === 'string' ? bytes(value) : value)) }

export function validateTradeV2DecimalString(value: unknown, positive = false): string {
  if (typeof value !== 'string' || !DECIMAL_RE.test(value)) fail(TRADE_V2_ERROR.INVALID_DECIMAL_STRING)
  const parsed = BigInt(value)
  if (positive && parsed <= 0n) fail(TRADE_V2_ERROR.INVALID_AMOUNT)
  if (parsed > U64_MAX) fail(TRADE_V2_ERROR.AMOUNT_OUT_OF_RANGE)
  return value
}

export function publicKeyBytes(value: string): Uint8Array {
  let decoded: Uint8Array
  try { decoded = bs58.decode(value) } catch { fail(TRADE_V2_ERROR.INVALID_PUBLIC_KEY) }
  if (decoded.length !== 32) fail(TRADE_V2_ERROR.INVALID_PUBLIC_KEY)
  return decoded
}

function uuidBytes(uuid: string): Uint8Array {
  const raw = uuid.replace(/-/g, '')
  if (!/^[0-9a-fA-F]{32}$/.test(raw)) fail(TRADE_V2_ERROR.INVALID_UUID)
  const out = new Uint8Array(16)
  for (let i = 0; i < 16; i++) out[i] = Number.parseInt(raw.slice(i * 2, i * 2 + 2), 16)
  return out
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] - b[i]
  return a.length - b.length
}

export function compareProposalAssetIdentity(a: ProposalAsset, b: ProposalAsset): number {
  if (a.kind !== b.kind) return kindOrder[a.kind] - kindOrder[b.kind]
  if (a.kind === 'sol' && b.kind === 'sol') return 0
  if ((a.kind === 'spl' || a.kind === 'token2022' || a.kind === 'pnft') && b.kind === a.kind) return compareBytes(publicKeyBytes(a.mint), publicKeyBytes(b.mint))
  if (a.kind === 'compressed_nft' && b.kind === 'compressed_nft') return compareBytes(publicKeyBytes(a.assetId), publicKeyBytes(b.assetId)) || compareBytes(publicKeyBytes(a.tree), publicKeyBytes(b.tree)) || a.leafIndex - b.leafIndex
  if (a.kind === 'core' && b.kind === 'core') return compareBytes(publicKeyBytes(a.assetId), publicKeyBytes(b.assetId))
  return 0
}

export function compareProposalAssets(a: ProposalAsset, b: ProposalAsset): number {
  return sideOrder[a.side] - sideOrder[b.side] || a.index - b.index || kindOrder[a.kind] - kindOrder[b.kind] || compareProposalAssetIdentity(a, b)
}

export function parseProposalAsset(raw: unknown): ProposalAsset {
  if (!isRecord(raw)) fail(TRADE_V2_ERROR.INVALID_PROPOSAL_ASSET)
  if (raw.side !== 'maker' && raw.side !== 'taker') fail(TRADE_V2_ERROR.INVALID_PROPOSAL_ASSET)
  const side = raw.side as ProposalSide
  if (!Number.isInteger(raw.index) || Number(raw.index) < 0 || Number(raw.index) >= TRADE_V2_MAX_NON_SOL_ASSETS_PER_SIDE) {
    fail(TRADE_V2_ERROR.INVALID_PROPOSAL_ASSET)
  }
  const index = Number(raw.index)
  const base = { side, index }

  switch (raw.kind) {
    case 'sol':
      assertStrictKeys(raw, assetKeys.sol, TRADE_V2_ERROR.INVALID_PROPOSAL_ASSET)
      if (index !== 0) fail(TRADE_V2_ERROR.INVALID_PROPOSAL_ASSET)
      return { side, index: 0, kind: 'sol', lamports: validateTradeV2DecimalString(raw.lamports, true) }
    case 'spl':
      assertStrictKeys(raw, assetKeys.spl, TRADE_V2_ERROR.INVALID_PROPOSAL_ASSET)
      return { ...base, kind: 'spl', mint: validatePublicKeyString(raw.mint), amount: validateTradeV2DecimalString(raw.amount, true) }
    case 'token2022':
      assertStrictKeys(raw, assetKeys.token2022, TRADE_V2_ERROR.INVALID_PROPOSAL_ASSET)
      return { ...base, kind: 'token2022', mint: validatePublicKeyString(raw.mint), amount: validateTradeV2DecimalString(raw.amount, true) }
    case 'pnft':
      assertStrictKeys(raw, assetKeys.pnft, TRADE_V2_ERROR.INVALID_PROPOSAL_ASSET)
      return { ...base, kind: 'pnft', mint: validatePublicKeyString(raw.mint) }
    case 'compressed_nft':
      assertStrictKeys(raw, assetKeys.compressed_nft, TRADE_V2_ERROR.INVALID_PROPOSAL_ASSET)
      if (!Number.isInteger(raw.leafIndex) || Number(raw.leafIndex) < 0) fail(TRADE_V2_ERROR.INVALID_PROPOSAL_ASSET)
      return { ...base, kind: 'compressed_nft', assetId: validatePublicKeyString(raw.assetId), tree: validatePublicKeyString(raw.tree), leafIndex: Number(raw.leafIndex) }
    case 'core':
      assertStrictKeys(raw, assetKeys.core, TRADE_V2_ERROR.INVALID_PROPOSAL_ASSET)
      return { ...base, kind: 'core', assetId: validatePublicKeyString(raw.assetId) }
    default:
      fail(TRADE_V2_ERROR.INVALID_PROPOSAL_ASSET)
  }
}

export function normalizeProposalAssets(raw: unknown): ProposalAsset[] {
  if (!Array.isArray(raw)) fail(TRADE_V2_ERROR.INVALID_ASSETS)
  const assets = raw.map(parseProposalAsset)
  const seen = new Set<string>()
  const sideIndex = new Set<string>()
  const sideCounts = new Map<ProposalSide, number>()
  for (const asset of assets) {
    if (asset.kind === 'sol') {
      const id = `sol:${asset.side}`
      if (seen.has(id)) fail(TRADE_V2_ERROR.DUPLICATE_SOL_LEG)
      seen.add(id)
      continue
    }
    sideCounts.set(asset.side, (sideCounts.get(asset.side) ?? 0) + 1)
    const legKey = `${asset.side}:${asset.index}`
    if (sideIndex.has(legKey)) fail(TRADE_V2_ERROR.DUPLICATE_ASSET_INDEX)
    sideIndex.add(legKey)
    const id = asset.kind === 'compressed_nft' ? `${asset.kind}:${asset.assetId}:tree:${asset.tree}:leaf:${asset.leafIndex}` : asset.kind === 'core' ? `${asset.kind}:${asset.assetId}` : `${asset.kind}:${asset.mint}`
    if (seen.has(id)) fail(TRADE_V2_ERROR.DUPLICATE_ASSET)
    seen.add(id)
  }
  if ((sideCounts.get('maker') ?? 0) > TRADE_V2_MAX_NON_SOL_ASSETS_PER_SIDE || (sideCounts.get('taker') ?? 0) > TRADE_V2_MAX_NON_SOL_ASSETS_PER_SIDE) fail(TRADE_V2_ERROR.MAX_BASKET_SIZE_EXCEEDED)
  for (const side of ['maker', 'taker'] as const) {
    const indexes = assets
      .filter((asset) => asset.kind !== 'sol' && asset.side === side)
      .map((asset) => asset.index)
      .sort((a, b) => a - b)
    for (let expected = 0; expected < indexes.length; expected += 1) {
      if (indexes[expected] !== expected) fail(TRADE_V2_ERROR.DUPLICATE_ASSET_INDEX)
    }
  }
  return assets.sort(compareProposalAssets)
}

export function nonSolProposalAssets(assets: readonly ProposalAsset[]): NonSolProposalAsset[] {
  return normalizeProposalAssets([...assets]).filter((asset): asset is NonSolProposalAsset => asset.kind !== 'sol')
}

export function proposalSolLamports(assets: readonly ProposalAsset[], side: ProposalSide): string {
  let sum = 0n
  for (const asset of assets) if (asset.side === side && asset.kind === 'sol') sum += BigInt(asset.lamports)
  return sum.toString()
}

export function canonicalProposalTerms(input: { readonly maker: string; readonly taker: string; readonly assets: readonly ProposalAsset[]; readonly expiresAt: string; readonly protocolVersion?: number }): ProposalTerms {
  const assets = normalizeProposalAssets([...input.assets])
  return {
    maker: input.maker,
    taker: input.taker,
    assets: nonSolProposalAssets(assets),
    makerSolLamports: proposalSolLamports(assets, 'maker'),
    takerSolLamports: proposalSolLamports(assets, 'taker'),
    expiresAt: input.expiresAt,
    protocolVersion: input.protocolVersion ?? TRADE_V2_PROTOCOL_VERSION,
  }
}

export function serializeTradeV2CommitmentPreimage(input: { readonly cluster: string; readonly programId: string; readonly tradeId: string; readonly proposalId: string; readonly termsHashBytes: Uint8Array }): Uint8Array {
  return concat([bytes(TRADE_V2_DOMAIN_SEPARATOR), new Uint8Array([TRADE_V2_COMMITMENT_SCHEMA_VERSION]), bytes(input.cluster), new Uint8Array([0]), publicKeyBytes(input.programId), uuidBytes(input.tradeId), uuidBytes(input.proposalId), input.termsHashBytes])
}

export function computeTradeV2Commitment(input: TradeV2CommitmentInput): TradeV2CommitmentOutput {
  const terms = canonicalJson(canonicalProposalTerms(input))
  const termsHashBytes = sha256(bytes(terms))
  const preimage = serializeTradeV2CommitmentPreimage({ ...input, termsHashBytes })
  const commitmentHex = sha256Hex(preimage)
  const termsHashHex = hex(termsHashBytes)
  const preimageHex = hex(preimage)
  return {
    commitment: `sha256:${commitmentHex}`,
    termsHash: `sha256:${termsHashHex}`,
    preimageHex,
    canonicalTerms: terms,
    canonicalTermsHex: hex(bytes(terms)),
    termsHashHex,
    commitmentPreimageHex: preimageHex,
    tradeCommitment: `sha256:${commitmentHex}`,
  }
}

export function parseTradeV2OracleObservation(raw: unknown): TradeV2OracleObservation {
  if (!isRecord(raw)) fail(TRADE_V2_ERROR.INVALID_ORACLE_OBSERVATION)
  assertStrictKeys(raw, observationKeys, TRADE_V2_ERROR.INVALID_ORACLE_OBSERVATION)
  if (raw.schemaVersion !== TRADE_V2_OBSERVATION_SCHEMA_VERSION) fail(TRADE_V2_ERROR.INVALID_ORACLE_OBSERVATION)
  if (typeof raw.programVersion !== 'number' || !Number.isInteger(raw.programVersion) || raw.programVersion < 0) fail(TRADE_V2_ERROR.INVALID_ORACLE_OBSERVATION)
  if (typeof raw.accountExists !== 'boolean' || typeof raw.accountActive !== 'boolean' || typeof raw.accountOwnerVerified !== 'boolean' || typeof raw.accountDiscriminatorVerified !== 'boolean') fail(TRADE_V2_ERROR.INVALID_ORACLE_OBSERVATION)
  if (!DECIMAL_RE.test(validateString(raw.observationSequence, TRADE_V2_ERROR.INVALID_ORACLE_OBSERVATION))) fail(TRADE_V2_ERROR.INVALID_ORACLE_OBSERVATION)
  if (!DECIMAL_RE.test(validateString(raw.observedSlot, TRADE_V2_ERROR.INVALID_ORACLE_OBSERVATION))) fail(TRADE_V2_ERROR.INVALID_ORACLE_OBSERVATION)
  const makerCustody = validateString(raw.makerCustody, TRADE_V2_ERROR.INVALID_ORACLE_OBSERVATION)
  const takerCustody = validateString(raw.takerCustody, TRADE_V2_ERROR.INVALID_ORACLE_OBSERVATION)
  const lifecycle = validateString(raw.lifecycle, TRADE_V2_ERROR.INVALID_ORACLE_OBSERVATION)
  if (!custodyValues.has(makerCustody as OracleCustody) || !custodyValues.has(takerCustody as OracleCustody) || !lifecycleValues.has(lifecycle as OracleLifecycleState)) fail(TRADE_V2_ERROR.INVALID_ORACLE_OBSERVATION)
  if (raw.closureKind !== null && raw.closureKind !== 'settled' && raw.closureKind !== 'cancelled') fail(TRADE_V2_ERROR.INVALID_ORACLE_OBSERVATION)

  let decodedTerms: TradeV2OracleDecodedTerms | null = null
  if (raw.decodedTerms !== null) {
    if (!isRecord(raw.decodedTerms)) fail(TRADE_V2_ERROR.INVALID_ORACLE_OBSERVATION)
    assertStrictKeys(raw.decodedTerms, decodedTermsKeys, TRADE_V2_ERROR.INVALID_ORACLE_OBSERVATION)
    decodedTerms = {
      assets: normalizeProposalAssets(raw.decodedTerms.assets),
      makerSolLamports: validateTradeV2DecimalString(raw.decodedTerms.makerSolLamports),
      takerSolLamports: validateTradeV2DecimalString(raw.decodedTerms.takerSolLamports),
    }
  }

  return {
    schemaVersion: TRADE_V2_OBSERVATION_SCHEMA_VERSION,
    cluster: validateString(raw.cluster, TRADE_V2_ERROR.INVALID_ORACLE_OBSERVATION),
    programId: validateString(raw.programId, TRADE_V2_ERROR.INVALID_ORACLE_OBSERVATION),
    programVersion: raw.programVersion,
    escrowPda: validateString(raw.escrowPda, TRADE_V2_ERROR.INVALID_ORACLE_OBSERVATION),
    observationSequence: raw.observationSequence as string,
    observedSlot: raw.observedSlot as string,
    observedAt: validateIsoDateTime(raw.observedAt),
    accountExists: raw.accountExists,
    accountActive: raw.accountActive,
    accountOwnerVerified: raw.accountOwnerVerified,
    accountDiscriminatorVerified: raw.accountDiscriminatorVerified,
    tradeCommitment: validateNullableString(raw.tradeCommitment, TRADE_V2_ERROR.INVALID_ORACLE_OBSERVATION),
    maker: validateNullableString(raw.maker, TRADE_V2_ERROR.INVALID_ORACLE_OBSERVATION),
    taker: validateNullableString(raw.taker, TRADE_V2_ERROR.INVALID_ORACLE_OBSERVATION),
    decodedTerms,
    makerCustody: makerCustody as OracleCustody,
    takerCustody: takerCustody as OracleCustody,
    lifecycle: lifecycle as OracleLifecycleState,
    closureKind: raw.closureKind as OracleClosureKind | null,
    closureSignature: validateNullableString(raw.closureSignature, TRADE_V2_ERROR.INVALID_ORACLE_OBSERVATION),
    closureInstruction: validateNullableString(raw.closureInstruction, TRADE_V2_ERROR.INVALID_ORACLE_OBSERVATION),
    recoveryAction: validateNullableString(raw.recoveryAction, TRADE_V2_ERROR.INVALID_ORACLE_OBSERVATION) as OracleRecoveryAction | null,
    allowedRecoverer: validateNullableString(raw.allowedRecoverer, TRADE_V2_ERROR.INVALID_ORACLE_OBSERVATION),
    evidence: raw.evidence,
  }
}

function observationError(): never { fail(TRADE_V2_ERROR.INVALID_ORACLE_OBSERVATION) }
function strictObservationRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!isRecord(value)) observationError()
  assertStrictKeys(value, keys, TRADE_V2_ERROR.INVALID_ORACLE_OBSERVATION)
  return value
}
function observationBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') observationError()
  return value
}
function observationNullablePublicKey(value: unknown): string | null {
  return value === null ? null : validatePublicKeyString(value)
}
function observationNullableCommitment(value: unknown): string | null {
  if (value === null) return null
  const text = validateString(value, TRADE_V2_ERROR.INVALID_ORACLE_OBSERVATION)
  if (!/^sha256:[0-9a-f]{64}$/.test(text)) observationError()
  return text
}
function observationDecimal(value: unknown): string {
  const text = validateString(value, TRADE_V2_ERROR.INVALID_ORACLE_OBSERVATION)
  if (!DECIMAL_RE.test(text) || BigInt(text) > U64_MAX) observationError()
  return text
}
function observationNullableDecimal(value: unknown): string | null {
  return value === null ? null : observationDecimal(value)
}
function observationNonNegativeInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) observationError()
  return Number(value)
}
function observationNullableU16(value: unknown): number | null {
  if (value === null) return null
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 0xffff) observationError()
  return Number(value)
}
function observationNullableU8(value: unknown): number | null {
  if (value === null) return null
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 0xff) observationError()
  return Number(value)
}
function observationStringList(value: unknown): string[] {
  if (!Array.isArray(value)) observationError()
  return value.map((entry) => {
    const text = validateString(entry, TRADE_V2_ERROR.INVALID_ORACLE_OBSERVATION)
    if (!text || text.length > 256) observationError()
    return text
  })
}

const evidenceVerdicts = new Set<TradeV2EvidenceVerdict>(['verified', 'excess', 'missing', 'invalid', 'conflict', 'unknown', 'not_required'])
const accountExistenceValues = new Set<TradeV2AccountExistence>(['exists', 'missing', 'unknown'])
const accountBindingValues = new Set<TradeV2AccountBindingVerdict>(['verified', 'invalid', 'conflict', 'unknown', 'not_applicable'])
const acceptanceVerdicts = new Set<TradeV2AcceptanceVerdict>(['absent', 'pending', 'accepted', 'invalid', 'conflict', 'unknown'])
const terminalCompletionVerdicts = new Set<TradeV2TerminalCompletionVerdict>(['absent', 'valid', 'invalid', 'conflict', 'unknown'])
const lifecycleVerdicts = new Set<TradeV2LifecycleVerdict>(['initializing', 'awaiting_acceptance', 'accepted_unfunded', 'partially_funded', 'fully_funded', 'settled', 'cancel_initiated', 'cancel_complete', 'recovery_initiated', 'recovery_complete', 'expired_awaiting_recovery', 'invalid', 'conflict', 'unknown'])
const finalOracleVerdicts = new Set<TradeV2FinalOracleVerdict>(['verified', 'invalid', 'conflict', 'unknown'])

function parseEvidenceVerdict(value: unknown): TradeV2EvidenceVerdict {
  const verdict = validateString(value, TRADE_V2_ERROR.INVALID_ORACLE_OBSERVATION) as TradeV2EvidenceVerdict
  if (!evidenceVerdicts.has(verdict)) observationError()
  return verdict
}

function parseDecodedAccountIdentity(raw: unknown): TradeV2AccountDecodedIdentity {
  const value = strictObservationRecord(raw, decodedIdentityKeys)
  if (value.outcome !== null && value.outcome !== 'cancelled' && value.outcome !== 'recovered') observationError()
  return {
    tradeAuthority: observationNullablePublicKey(value.tradeAuthority),
    tradeCustody: observationNullablePublicKey(value.tradeCustody),
    tradeExecutionPlan: observationNullablePublicKey(value.tradeExecutionPlan),
    tradeFundingState: observationNullablePublicKey(value.tradeFundingState),
    tradeCommitment: observationNullableCommitment(value.tradeCommitment),
    maker: observationNullablePublicKey(value.maker),
    taker: observationNullablePublicKey(value.taker),
    outcome: value.outcome as 'cancelled' | 'recovered' | null,
  }
}

function parseCanonicalAccountEvidence(raw: unknown, accountType: TradeV2CanonicalAccountEvidence['accountType']): TradeV2CanonicalAccountEvidence {
  const value = strictObservationRecord(raw, accountEvidenceKeys)
  if (value.accountType !== accountType) observationError()
  const existence = validateString(value.existence, TRADE_V2_ERROR.INVALID_ORACLE_OBSERVATION) as TradeV2AccountExistence
  const binding = validateString(value.crossAccountBinding, TRADE_V2_ERROR.INVALID_ORACLE_OBSERVATION) as TradeV2AccountBindingVerdict
  if (!accountExistenceValues.has(existence) || !accountBindingValues.has(binding)) observationError()
  const discriminatorHex = validateNullableString(value.discriminatorHex, TRADE_V2_ERROR.INVALID_ORACLE_OBSERVATION)
  const rawDataSha256 = validateNullableString(value.rawDataSha256, TRADE_V2_ERROR.INVALID_ORACLE_OBSERVATION)
  if (discriminatorHex !== null && !/^[0-9a-f]{16}$/.test(discriminatorHex)) observationError()
  if (rawDataSha256 !== null && !/^[0-9a-f]{64}$/.test(rawDataSha256)) observationError()
  const evidence: TradeV2CanonicalAccountEvidence = {
    accountType,
    expectedPda: validatePublicKeyString(value.expectedPda),
    existence,
    accountOwner: observationNullablePublicKey(value.accountOwner),
    ownerVerified: observationBoolean(value.ownerVerified),
    discriminatorHex,
    discriminatorVerified: observationBoolean(value.discriminatorVerified),
    schemaVersion: observationNullableU16(value.schemaVersion),
    programVersion: observationNullableU16(value.programVersion),
    canonicalBump: observationNullableU8(value.canonicalBump),
    pdaAndBumpVerified: observationBoolean(value.pdaAndBumpVerified),
    reservedBytesVerified: observationBoolean(value.reservedBytesVerified),
    decodedIdentity: parseDecodedAccountIdentity(value.decodedIdentity),
    crossAccountBinding: binding,
    rawDataSha256,
    valid: observationBoolean(value.valid),
  }
  if (evidence.valid && (
    evidence.existence !== 'exists'
    || !evidence.ownerVerified
    || !evidence.discriminatorVerified
    || evidence.schemaVersion === null
    || evidence.programVersion === null
    || evidence.canonicalBump === null
    || !evidence.pdaAndBumpVerified
    || !evidence.reservedBytesVerified
    || evidence.crossAccountBinding === 'invalid'
    || evidence.crossAccountBinding === 'conflict'
    || evidence.crossAccountBinding === 'unknown'
    || evidence.rawDataSha256 === null
  )) observationError()
  return evidence
}

function parseExecutionPlanProjection(raw: unknown): TradeV2ExecutionPlanProjection {
  const value = strictObservationRecord(raw, executionPlanKeys)
  const makerAsset = value.makerAsset === null ? null : parseProposalAsset(value.makerAsset)
  const takerAsset = value.takerAsset === null ? null : parseProposalAsset(value.takerAsset)
  if ((makerAsset && (makerAsset.side !== 'maker' || (makerAsset.kind !== 'spl' && makerAsset.kind !== 'token2022')))
    || (takerAsset && (takerAsset.side !== 'taker' || (takerAsset.kind !== 'spl' && takerAsset.kind !== 'token2022')))) observationError()
  return {
    makerAsset,
    takerAsset,
    makerSolLamports: observationDecimal(value.makerSolLamports),
    takerSolLamports: observationDecimal(value.takerSolLamports),
    expiresAt: observationDecimal(value.expiresAt),
    verified: observationBoolean(value.verified),
  }
}

function parseAcceptanceProjection(raw: unknown): TradeV2AcceptanceProjection {
  const value = strictObservationRecord(raw, acceptanceProjectionKeys)
  const state = validateString(value.state, TRADE_V2_ERROR.INVALID_ORACLE_OBSERVATION) as TradeV2AcceptanceVerdict
  if (!acceptanceVerdicts.has(state)) observationError()
  const acceptedAt = observationNullableDecimal(value.acceptedAt)
  const acceptedSlot = observationNullableDecimal(value.acceptedSlot)
  const verified = observationBoolean(value.verified)
  if (state === 'accepted' && (!verified || acceptedAt === null || acceptedSlot === null || BigInt(acceptedAt) <= 0n || BigInt(acceptedSlot) <= 0n)) observationError()
  if ((state === 'absent' || state === 'pending') && (acceptedAt !== null || acceptedSlot !== null)) observationError()
  return { state, acceptedAt, acceptedSlot, verified }
}

function parseFundingSideProjection(raw: unknown): TradeV2FundingSideProjection {
  const value = strictObservationRecord(raw, fundingSideKeys)
  const custodyValue = strictObservationRecord(value.custodyEvidence, fundingCustodyKeys)
  const projection: TradeV2FundingSideProjection = {
    solRequired: observationDecimal(value.solRequired),
    solDepositedFlag: observationBoolean(value.solDepositedFlag),
    assetRequired: observationBoolean(value.assetRequired),
    assetDepositedFlag: observationBoolean(value.assetDepositedFlag),
    fullyFundedStored: observationBoolean(value.fullyFundedStored),
    fullyFundedDerived: observationBoolean(value.fullyFundedDerived),
    custodyEvidence: { sol: parseEvidenceVerdict(custodyValue.sol), asset: parseEvidenceVerdict(custodyValue.asset) },
  }
  const recomputed = (projection.solRequired === '0' || projection.solDepositedFlag)
    && (!projection.assetRequired || projection.assetDepositedFlag)
  if (projection.fullyFundedDerived !== recomputed) observationError()
  if ((projection.solDepositedFlag && projection.solRequired === '0') || (projection.assetDepositedFlag && !projection.assetRequired)) observationError()
  return projection
}

function parseSolCustodyEvidence(raw: unknown): TradeV2SolCustodyEvidence {
  const value = strictObservationRecord(raw, solCustodyKeys)
  const evidence: TradeV2SolCustodyEvidence = {
    totalCustodyLamports: observationDecimal(value.totalCustodyLamports),
    currentDataLength: observationNonNegativeInteger(value.currentDataLength),
    rentExemptMinimum: observationDecimal(value.rentExemptMinimum),
    principalAboveRent: observationDecimal(value.principalAboveRent),
    expectedMakerSolPrincipal: observationDecimal(value.expectedMakerSolPrincipal),
    expectedTakerSolPrincipal: observationDecimal(value.expectedTakerSolPrincipal),
    expectedCombinedProtocolPrincipal: observationDecimal(value.expectedCombinedProtocolPrincipal),
    unsolicitedExcessLamports: observationDecimal(value.unsolicitedExcessLamports),
    missingPrincipalAmount: observationDecimal(value.missingPrincipalAmount),
    verdict: parseEvidenceVerdict(value.verdict),
  }
  const total = BigInt(evidence.totalCustodyLamports)
  const rent = BigInt(evidence.rentExemptMinimum)
  const aboveRent = total > rent ? total - rent : 0n
  const expected = BigInt(evidence.expectedMakerSolPrincipal) + BigInt(evidence.expectedTakerSolPrincipal)
  const excess = aboveRent > expected ? aboveRent - expected : 0n
  const missing = expected > aboveRent ? expected - aboveRent : 0n
  if (
    BigInt(evidence.principalAboveRent) !== aboveRent
    || BigInt(evidence.expectedCombinedProtocolPrincipal) !== expected
    || BigInt(evidence.unsolicitedExcessLamports) !== excess
    || BigInt(evidence.missingPrincipalAmount) !== missing
  ) observationError()
  return evidence
}

function parseTokenCustodyEvidence(raw: unknown): TradeV2TokenCustodyEvidence {
  const value = strictObservationRecord(raw, tokenCustodyKeys)
  if (value.side !== 'maker' && value.side !== 'taker') observationError()
  if (value.assetKind !== 'spl' && value.assetKind !== 'token2022') observationError()
  if (!['extension_free', 'not_applicable', 'unsupported', 'unknown'].includes(String(value.token2022ExtensionVerdict))) observationError()
  const evidence: TradeV2TokenCustodyEvidence = {
    side: value.side,
    assetKind: value.assetKind,
    mint: validatePublicKeyString(value.mint),
    tokenProgram: validatePublicKeyString(value.tokenProgram),
    expectedCustodyAta: validatePublicKeyString(value.expectedCustodyAta),
    ataExistence: validateString(value.ataExistence, TRADE_V2_ERROR.INVALID_ORACLE_OBSERVATION) as TradeV2AccountExistence,
    accountOwner: observationNullablePublicKey(value.accountOwner),
    tokenAccountOwner: observationNullablePublicKey(value.tokenAccountOwner),
    tokenAccountMint: observationNullablePublicKey(value.tokenAccountMint),
    amount: observationDecimal(value.amount),
    expectedPlannedPrincipal: observationDecimal(value.expectedPlannedPrincipal),
    unsolicitedExcess: observationDecimal(value.unsolicitedExcess),
    missingPrincipal: observationDecimal(value.missingPrincipal),
    token2022ExtensionVerdict: value.token2022ExtensionVerdict as TradeV2TokenCustodyEvidence['token2022ExtensionVerdict'],
    verdict: parseEvidenceVerdict(value.verdict),
  }
  if (!accountExistenceValues.has(evidence.ataExistence)) observationError()
  const amount = BigInt(evidence.amount)
  const expected = BigInt(evidence.expectedPlannedPrincipal)
  if (BigInt(evidence.unsolicitedExcess) !== (amount > expected ? amount - expected : 0n)
    || BigInt(evidence.missingPrincipal) !== (expected > amount ? expected - amount : 0n)) observationError()
  return evidence
}

function parseCustodyProjection(raw: unknown): TradeV2CustodyProjection {
  const value = strictObservationRecord(raw, custodyKeys)
  if (!Array.isArray(value.tokenLegs) || value.tokenLegs.length > 2) observationError()
  const tokenLegs = value.tokenLegs.map(parseTokenCustodyEvidence)
  if (new Set(tokenLegs.map((leg) => leg.side)).size !== tokenLegs.length) observationError()
  return {
    sol: parseSolCustodyEvidence(value.sol),
    tokenLegs,
    aggregateVerdict: parseEvidenceVerdict(value.aggregateVerdict),
    mayContainProtocolPrincipal: observationBoolean(value.mayContainProtocolPrincipal),
  }
}

function parseTerminalCompletionProjection(raw: unknown): TradeV2TerminalCompletionProjection {
  const value = strictObservationRecord(raw, terminalCompletionKeys)
  const state = validateString(value.state, TRADE_V2_ERROR.INVALID_ORACLE_OBSERVATION) as TradeV2TerminalCompletionVerdict
  if (!terminalCompletionVerdicts.has(state)) observationError()
  if (value.outcome !== null && value.outcome !== 'cancelled' && value.outcome !== 'recovered') observationError()
  const completedAt = observationNullableDecimal(value.completedAt)
  const completedSlot = observationNullableDecimal(value.completedSlot)
  const verified = observationBoolean(value.verified)
  if (state === 'valid' && (!verified || value.outcome === null || completedAt === null || completedSlot === null || BigInt(completedAt) <= 0n || BigInt(completedSlot) <= 0n)) observationError()
  if (state === 'absent' && (value.outcome !== null || completedAt !== null || completedSlot !== null)) observationError()
  return { state, outcome: value.outcome as 'cancelled' | 'recovered' | null, completedAt, completedSlot, verified }
}

export function parseTradeV2OracleLifecycleObservation(raw: unknown): TradeV2OracleLifecycleObservation {
  const value = strictObservationRecord(raw, lifecycleObservationKeys)
  if (value.schemaVersion !== TRADE_V2_LIFECYCLE_OBSERVATION_SCHEMA_VERSION) observationError()
  if (!Number.isInteger(value.programVersion) || !TRADE_V2_SUPPORTED_PROGRAM_VERSIONS.includes(value.programVersion as 2)) observationError()
  const observationId = validateString(value.oracleObservationId, TRADE_V2_ERROR.INVALID_ORACLE_OBSERVATION)
  if (!/^sha256:[0-9a-f]{64}$/.test(observationId)) observationError()
  const observedBlockTimeValue = isRecord(value.observedBlockTime) ? value.observedBlockTime : observationError()
  let observedBlockTime: TradeV2OracleLifecycleObservation['observedBlockTime']
  if (observedBlockTimeValue.status === 'available') {
    assertStrictKeys(observedBlockTimeValue, observedBlockTimeKeys, TRADE_V2_ERROR.INVALID_ORACLE_OBSERVATION)
    observedBlockTime = { status: 'available', unixSeconds: observationDecimal(observedBlockTimeValue.unixSeconds) }
  } else if (observedBlockTimeValue.status === 'unavailable') {
    assertStrictKeys(observedBlockTimeValue, observedBlockTimeUnavailableKeys, TRADE_V2_ERROR.INVALID_ORACLE_OBSERVATION)
    observedBlockTime = { status: 'unavailable', reason: validateString(observedBlockTimeValue.reason, TRADE_V2_ERROR.INVALID_ORACLE_OBSERVATION) }
  } else observationError()
  const rpcValue = strictObservationRecord(value.rpcEvidence, rpcEvidenceKeys)
  if (rpcValue.commitment !== 'confirmed' && rpcValue.commitment !== 'finalized') observationError()
  if (!Array.isArray(rpcValue.readContextSlots) || rpcValue.readContextSlots.length === 0) observationError()
  const readContextSlots = rpcValue.readContextSlots.map(observationDecimal)
  const rpcEvidence: TradeV2RpcSnapshotEvidence = {
    endpointId: validateString(rpcValue.endpointId, TRADE_V2_ERROR.INVALID_ORACLE_OBSERVATION),
    commitment: rpcValue.commitment,
    contextSlot: observationDecimal(rpcValue.contextSlot),
    readContextSlots,
    maxSlotDrift: observationNonNegativeInteger(rpcValue.maxSlotDrift),
    sufficientlyConsistent: observationBoolean(rpcValue.sufficientlyConsistent),
    accountFetchLatencyMs: observationNonNegativeInteger(rpcValue.accountFetchLatencyMs),
  }
  const accountsValue = strictObservationRecord(value.accounts, accountsKeys)
  const accounts = {
    authority: parseCanonicalAccountEvidence(accountsValue.authority, 'authority'),
    custody: parseCanonicalAccountEvidence(accountsValue.custody, 'custody'),
    executionPlan: parseCanonicalAccountEvidence(accountsValue.executionPlan, 'execution_plan'),
    acceptance: parseCanonicalAccountEvidence(accountsValue.acceptance, 'acceptance'),
    funding: parseCanonicalAccountEvidence(accountsValue.funding, 'funding'),
    terminalCompletion: parseCanonicalAccountEvidence(accountsValue.terminalCompletion, 'terminal_completion'),
  }
  const fundingValue = strictObservationRecord(value.funding, fundingKeys)
  const funding = { maker: parseFundingSideProjection(fundingValue.maker), taker: parseFundingSideProjection(fundingValue.taker) }
  const rawAuthorityLifecycle = validateString(value.rawAuthorityLifecycle, TRADE_V2_ERROR.INVALID_ORACLE_OBSERVATION)
  if (!['initialized', 'settled', 'cancelled', 'recovered', 'unknown'].includes(rawAuthorityLifecycle)) observationError()
  const derivedLifecycle = validateString(value.derivedLifecycle, TRADE_V2_ERROR.INVALID_ORACLE_OBSERVATION) as TradeV2LifecycleVerdict
  const finalVerdict = validateString(value.finalVerdict, TRADE_V2_ERROR.INVALID_ORACLE_OBSERVATION) as TradeV2FinalOracleVerdict
  if (!lifecycleVerdicts.has(derivedLifecycle) || !finalOracleVerdicts.has(finalVerdict)) observationError()
  const conflictCodes = observationStringList(value.conflictCodes)
  const unknownReasons = observationStringList(value.unknownReasons)
  if ((derivedLifecycle === 'invalid') !== (finalVerdict === 'invalid')
    || (derivedLifecycle === 'conflict') !== (finalVerdict === 'conflict')
    || (derivedLifecycle === 'unknown') !== (finalVerdict === 'unknown')) observationError()
  if (finalVerdict === 'verified' && (conflictCodes.length > 0 || unknownReasons.length > 0 || !rpcEvidence.sufficientlyConsistent)) observationError()
  const observation: TradeV2OracleLifecycleObservation = {
    schemaVersion: TRADE_V2_LIFECYCLE_OBSERVATION_SCHEMA_VERSION,
    cluster: validateString(value.cluster, TRADE_V2_ERROR.INVALID_ORACLE_OBSERVATION),
    programId: validatePublicKeyString(value.programId),
    programVersion: value.programVersion as number,
    oracleObservationId: observationId,
    observationSequence: observationDecimal(value.observationSequence),
    observedSlot: observationDecimal(value.observedSlot),
    observedBlockTime,
    observedAt: validateIsoDateTime(value.observedAt),
    authorityPda: validatePublicKeyString(value.authorityPda),
    custodyPda: validatePublicKeyString(value.custodyPda),
    executionPlanPda: validatePublicKeyString(value.executionPlanPda),
    acceptancePda: validatePublicKeyString(value.acceptancePda),
    fundingPda: validatePublicKeyString(value.fundingPda),
    terminalCompletionPda: observationNullablePublicKey(value.terminalCompletionPda),
    tradeCommitment: observationNullableCommitment(value.tradeCommitment) ?? observationError(),
    maker: validatePublicKeyString(value.maker),
    taker: validatePublicKeyString(value.taker),
    allowedRecoverer: observationNullablePublicKey(value.allowedRecoverer),
    rpcEvidence,
    accounts,
    executionPlan: parseExecutionPlanProjection(value.executionPlan),
    acceptance: parseAcceptanceProjection(value.acceptance),
    funding,
    custody: parseCustodyProjection(value.custody),
    rawAuthorityLifecycle: rawAuthorityLifecycle as TradeV2OracleLifecycleObservation['rawAuthorityLifecycle'],
    derivedLifecycle,
    terminalCompletion: parseTerminalCompletionProjection(value.terminalCompletion),
    finalVerdict,
    conflictCodes,
    unknownReasons,
  }
  if (observation.maker === observation.taker) observationError()
  if (accounts.authority.expectedPda !== observation.authorityPda
    || accounts.custody.expectedPda !== observation.custodyPda
    || accounts.executionPlan.expectedPda !== observation.executionPlanPda
    || accounts.acceptance.expectedPda !== observation.acceptancePda
    || accounts.funding.expectedPda !== observation.fundingPda
    || (observation.terminalCompletionPda !== null && accounts.terminalCompletion.expectedPda !== observation.terminalCompletionPda)) observationError()
  const validAccounts = Object.values(accounts).filter((account) => account.valid)
  if (validAccounts.some((account) => account.schemaVersion !== TRADE_V2_COMMITMENT_SCHEMA_VERSION || account.programVersion !== observation.programVersion)) observationError()
  const authorityIdentity = accounts.authority.decodedIdentity
  if (accounts.authority.valid && (
    authorityIdentity.tradeAuthority !== observation.authorityPda
    || authorityIdentity.tradeCommitment !== observation.tradeCommitment
    || authorityIdentity.maker !== observation.maker
    || authorityIdentity.taker !== observation.taker
  )) observationError()
  const custodyIdentity = accounts.custody.decodedIdentity
  if (accounts.custody.valid && (
    custodyIdentity.tradeAuthority !== observation.authorityPda
    || custodyIdentity.tradeCustody !== observation.custodyPda
    || custodyIdentity.tradeCommitment !== observation.tradeCommitment
    || custodyIdentity.maker !== observation.maker
    || custodyIdentity.taker !== observation.taker
  )) observationError()
  const planIdentity = accounts.executionPlan.decodedIdentity
  if (accounts.executionPlan.valid && (
    planIdentity.tradeCustody !== observation.custodyPda
    || planIdentity.tradeExecutionPlan !== observation.executionPlanPda
    || planIdentity.tradeCommitment !== observation.tradeCommitment
  )) observationError()
  const acceptanceIdentity = accounts.acceptance.decodedIdentity
  if (accounts.acceptance.valid && (
    acceptanceIdentity.tradeAuthority !== observation.authorityPda
    || acceptanceIdentity.tradeCustody !== observation.custodyPda
    || acceptanceIdentity.tradeExecutionPlan !== observation.executionPlanPda
    || acceptanceIdentity.tradeCommitment !== observation.tradeCommitment
    || acceptanceIdentity.maker !== observation.maker
    || acceptanceIdentity.taker !== observation.taker
  )) observationError()
  const fundingIdentity = accounts.funding.decodedIdentity
  if (accounts.funding.valid && (
    fundingIdentity.tradeCustody !== observation.custodyPda
    || fundingIdentity.tradeExecutionPlan !== observation.executionPlanPda
    || fundingIdentity.tradeFundingState !== observation.fundingPda
    || fundingIdentity.tradeCommitment !== observation.tradeCommitment
  )) observationError()
  const terminalIdentity = accounts.terminalCompletion.decodedIdentity
  if (accounts.terminalCompletion.valid && (
    observation.terminalCompletionPda === null
    || terminalIdentity.tradeAuthority !== observation.authorityPda
    || terminalIdentity.tradeCustody !== observation.custodyPda
    || terminalIdentity.tradeExecutionPlan !== observation.executionPlanPda
    || terminalIdentity.tradeFundingState !== observation.fundingPda
    || terminalIdentity.tradeCommitment !== observation.tradeCommitment
    || terminalIdentity.outcome !== observation.terminalCompletion.outcome
  )) observationError()
  if (observation.finalVerdict === 'verified' && (
    !accounts.authority.valid
    || !accounts.custody.valid
    || !accounts.executionPlan.valid
    || !accounts.acceptance.valid
    || !accounts.funding.valid
    || !observation.executionPlan.verified
    || observation.funding.maker.fullyFundedStored !== observation.funding.maker.fullyFundedDerived
    || observation.funding.taker.fullyFundedStored !== observation.funding.taker.fullyFundedDerived
  )) observationError()
  if (observation.observedSlot !== observation.rpcEvidence.contextSlot
    || observation.observationSequence !== observation.observedSlot) observationError()
  if (observation.executionPlan.verified && BigInt(observation.executionPlan.expiresAt) <= 0n) observationError()
  if (observation.funding.maker.solRequired !== observation.executionPlan.makerSolLamports
    || observation.funding.taker.solRequired !== observation.executionPlan.takerSolLamports
    || observation.funding.maker.assetRequired !== (observation.executionPlan.makerAsset !== null)
    || observation.funding.taker.assetRequired !== (observation.executionPlan.takerAsset !== null)) observationError()
  for (const side of ['maker', 'taker'] as const) {
    const projectedAsset = observation.executionPlan[side === 'maker' ? 'makerAsset' : 'takerAsset']
    const fundingSide = observation.funding[side]
    const tokenEvidence = observation.custody.tokenLegs.find((leg) => leg.side === side)
    if (projectedAsset === null) {
      if (tokenEvidence) observationError()
      continue
    }
    if (!tokenEvidence
      || tokenEvidence.assetKind !== projectedAsset.kind
      || tokenEvidence.mint !== projectedAsset.mint
      || tokenEvidence.expectedPlannedPrincipal !== (fundingSide.assetDepositedFlag ? projectedAsset.amount : '0')) observationError()
    const custodyAccountRequired = tokenEvidence.expectedPlannedPrincipal !== '0' || tokenEvidence.amount !== '0'
    if (observation.finalVerdict === 'verified' && (
      tokenEvidence.ataExistence === 'unknown'
      || (custodyAccountRequired && tokenEvidence.ataExistence !== 'exists')
      || (tokenEvidence.ataExistence === 'exists' && (
        tokenEvidence.tokenAccountOwner !== observation.custodyPda
        || tokenEvidence.tokenAccountMint !== projectedAsset.mint
        || tokenEvidence.accountOwner !== tokenEvidence.tokenProgram
      ))
      || (projectedAsset.kind === 'token2022' && tokenEvidence.token2022ExtensionVerdict !== 'extension_free')
      || (projectedAsset.kind === 'spl' && tokenEvidence.token2022ExtensionVerdict !== 'not_applicable')
    )) observationError()
  }
  const expectedMakerSol = observation.funding.maker.solDepositedFlag ? observation.executionPlan.makerSolLamports : '0'
  const expectedTakerSol = observation.funding.taker.solDepositedFlag ? observation.executionPlan.takerSolLamports : '0'
  if (observation.custody.sol.expectedMakerSolPrincipal !== expectedMakerSol
    || observation.custody.sol.expectedTakerSolPrincipal !== expectedTakerSol) observationError()
  const derivedMayContainPrincipal = observation.custody.sol.expectedCombinedProtocolPrincipal !== '0'
    || observation.custody.tokenLegs.some((leg) => leg.expectedPlannedPrincipal !== '0')
  if (observation.custody.mayContainProtocolPrincipal !== derivedMayContainPrincipal) observationError()
  const flagsCleared = !observation.funding.maker.solDepositedFlag
    && !observation.funding.maker.assetDepositedFlag
    && !observation.funding.taker.solDepositedFlag
    && !observation.funding.taker.assetDepositedFlag
  const noPlannedPrincipal = observation.custody.sol.expectedCombinedProtocolPrincipal === '0'
    && observation.custody.sol.missingPrincipalAmount === '0'
    && observation.custody.tokenLegs.every((leg) => leg.expectedPlannedPrincipal === '0' && leg.missingPrincipal === '0')
  const custodyVerifiable = !['invalid', 'conflict', 'unknown', 'missing'].includes(observation.custody.aggregateVerdict)
  if (observation.finalVerdict === 'verified' && !custodyVerifiable) observationError()
  if (observation.derivedLifecycle === 'fully_funded' && (
    observation.rawAuthorityLifecycle !== 'initialized'
    || observation.acceptance.state !== 'accepted'
    || !observation.acceptance.verified
    || !accounts.acceptance.valid
    || !observation.funding.maker.fullyFundedDerived
    || !observation.funding.taker.fullyFundedDerived
  )) observationError()
  if (['accepted_unfunded', 'partially_funded'].includes(observation.derivedLifecycle) && (
    observation.rawAuthorityLifecycle !== 'initialized'
    || observation.acceptance.state !== 'accepted'
    || !observation.acceptance.verified
    || !accounts.acceptance.valid
  )) observationError()
  if (['awaiting_acceptance', 'expired_awaiting_recovery'].includes(observation.derivedLifecycle) && (
    observation.rawAuthorityLifecycle !== 'initialized'
    || observation.acceptance.state !== 'pending'
    || !observation.acceptance.verified
    || !accounts.acceptance.valid
  )) observationError()
  if (observation.derivedLifecycle === 'settled' && (
    observation.rawAuthorityLifecycle !== 'settled'
    || observation.acceptance.state !== 'accepted'
    || !observation.acceptance.verified
    || !accounts.acceptance.valid
    || !flagsCleared
    || !noPlannedPrincipal
    || observation.terminalCompletion.state !== 'absent'
    || accounts.terminalCompletion.existence === 'exists'
  )) observationError()
  if (observation.derivedLifecycle === 'cancel_complete' || observation.derivedLifecycle === 'recovery_complete') {
    const expectedOutcome = observation.derivedLifecycle === 'cancel_complete' ? 'cancelled' : 'recovered'
    if (
      observation.rawAuthorityLifecycle !== expectedOutcome
      || observation.terminalCompletion.state !== 'valid'
      || observation.terminalCompletion.outcome !== expectedOutcome
      || !observation.terminalCompletion.verified
      || observation.terminalCompletionPda === null
      || !accounts.terminalCompletion.valid
      || !flagsCleared
      || !noPlannedPrincipal
    ) observationError()
  }
  if (observation.derivedLifecycle === 'cancel_initiated' && (
    observation.rawAuthorityLifecycle !== 'cancelled'
    || observation.terminalCompletion.state !== 'absent'
    || accounts.terminalCompletion.existence === 'exists'
  )) observationError()
  if (observation.derivedLifecycle === 'recovery_initiated' && (
    observation.rawAuthorityLifecycle !== 'recovered'
    || observation.terminalCompletion.state !== 'absent'
    || accounts.terminalCompletion.existence === 'exists'
  )) observationError()
  return observation
}

export function canonicalizeTradeV2OracleLifecycleObservation(raw: unknown): string {
  return canonicalJson(parseTradeV2OracleLifecycleObservation(raw))
}

export function digestTradeV2OracleLifecycleObservation(raw: unknown): string {
  return `sha256:${sha256Hex(canonicalizeTradeV2OracleLifecycleObservation(raw))}`
}



function validateInitializationEvidenceCommon(raw: Record<string, unknown>) {
  if (raw.source !== 'chain') fail(TRADE_V2_ERROR.INVALID_ORACLE_INITIALIZATION_EVIDENCE)
  if (raw.verifiedPdaDerivation !== true) fail(TRADE_V2_ERROR.INVALID_ORACLE_INITIALIZATION_EVIDENCE)
  if (typeof raw.schemaVersion !== 'number' || !Number.isInteger(raw.schemaVersion) || raw.schemaVersion !== TRADE_V2_COMMITMENT_SCHEMA_VERSION) fail(TRADE_V2_ERROR.INVALID_ORACLE_INITIALIZATION_EVIDENCE)
  if (typeof raw.programVersion !== 'number' || !Number.isInteger(raw.programVersion) || !TRADE_V2_SUPPORTED_PROGRAM_VERSIONS.includes(raw.programVersion as 2)) fail(TRADE_V2_ERROR.INVALID_ORACLE_INITIALIZATION_EVIDENCE)
  return {
    maker: validatePublicKeyString(raw.maker),
    taker: validatePublicKeyString(raw.taker),
    escrowPda: validatePublicKeyString(raw.escrowPda),
    tradeCommitment: validateString(raw.tradeCommitment, TRADE_V2_ERROR.INVALID_ORACLE_INITIALIZATION_EVIDENCE),
    allowedRecoverer: raw.allowedRecoverer === null ? null : validatePublicKeyString(raw.allowedRecoverer),
    schemaVersion: raw.schemaVersion,
    programVersion: raw.programVersion,
    accountSlot: validateTradeV2DecimalString(raw.accountSlot),
  }
}

export function parseTradeV2OracleInitializedAccountEvidence(raw: unknown): TradeV2OracleInitializedAccountEvidence {
  if (!isRecord(raw)) fail(TRADE_V2_ERROR.INVALID_ORACLE_INITIALIZATION_EVIDENCE)
  assertStrictKeys(raw, initializedAccountEvidenceKeys, TRADE_V2_ERROR.INVALID_ORACLE_INITIALIZATION_EVIDENCE)
  if (raw.kind !== 'trade_v2_initialized_account_only') fail(TRADE_V2_ERROR.INVALID_ORACLE_INITIALIZATION_EVIDENCE)
  const common = validateInitializationEvidenceCommon(raw)
  return { kind: 'trade_v2_initialized_account_only', source: 'chain', programId: validatePublicKeyString(raw.programId), ...common, verifiedPdaDerivation: true }
}

export function parseTradeV2OracleInitializationTransactionEvidence(raw: unknown): TradeV2OracleInitializationTransactionEvidence {
  if (!isRecord(raw)) fail(TRADE_V2_ERROR.INVALID_ORACLE_INITIALIZATION_EVIDENCE)
  assertStrictKeys(raw, initializationTransactionEvidenceKeys, TRADE_V2_ERROR.INVALID_ORACLE_INITIALIZATION_EVIDENCE)
  if (raw.kind !== 'trade_v2_initialization_transaction' || raw.initializeInstructionVerified !== true) fail(TRADE_V2_ERROR.INVALID_ORACLE_INITIALIZATION_EVIDENCE)
  if (raw.confirmationStatus !== 'confirmed' && raw.confirmationStatus !== 'finalized') fail(TRADE_V2_ERROR.INVALID_ORACLE_INITIALIZATION_EVIDENCE)
  if (raw.blockTime !== null && (!Number.isInteger(raw.blockTime) || Number(raw.blockTime) < 0)) fail(TRADE_V2_ERROR.INVALID_ORACLE_INITIALIZATION_EVIDENCE)
  const common = validateInitializationEvidenceCommon(raw)
  return {
    kind: 'trade_v2_initialization_transaction',
    source: 'chain',
    transactionSignature: validateString(raw.transactionSignature, TRADE_V2_ERROR.INVALID_ORACLE_INITIALIZATION_EVIDENCE),
    transactionSlot: validateTradeV2DecimalString(raw.transactionSlot),
    confirmationStatus: raw.confirmationStatus,
    blockTime: raw.blockTime as number | null,
    initializeInstructionVerified: true,
    payer: validatePublicKeyString(raw.payer),
    ...common,
    verifiedPdaDerivation: true,
  }
}

export function parseTradeV2OracleInitializationEvidence(raw: unknown): TradeV2OracleInitializationEvidence {
  if (!isRecord(raw)) fail(TRADE_V2_ERROR.INVALID_ORACLE_INITIALIZATION_EVIDENCE)
  return raw.kind === 'trade_v2_initialization_transaction'
    ? parseTradeV2OracleInitializationTransactionEvidence(raw)
    : parseTradeV2OracleInitializedAccountEvidence(raw)
}

export function validateTradeV2TerminalOracleProof(observation: TradeV2OracleObservation): void {
  if (!TRADE_V2_SUPPORTED_PROGRAM_VERSIONS.includes(observation.programVersion as 2)) fail(TRADE_V2_ERROR.UNSUPPORTED_ORACLE_PROGRAM_VERSION)
  const terminalLifecycle = observation.lifecycle === 'settled' || observation.lifecycle === 'cancelled' || observation.lifecycle === 'closed'
  const hasClosureField = Boolean(observation.closureKind || observation.closureInstruction || observation.closureSignature)
  if (terminalLifecycle && (observation.makerCustody !== 'gone' || observation.takerCustody !== 'gone')) fail(TRADE_V2_ERROR.TERMINAL_CUSTODY_NOT_GONE)
  if (!terminalLifecycle && hasClosureField) fail(TRADE_V2_ERROR.INCONSISTENT_CLOSURE_PROOF)
  if (Boolean(observation.closureSignature) !== Boolean(observation.closureInstruction)) fail(TRADE_V2_ERROR.INCOMPLETE_CLOSURE_PROOF)
  if (observation.lifecycle === 'settled' && observation.closureKind !== 'settled') fail(TRADE_V2_ERROR.SETTLEMENT_CLOSURE_KIND_REQUIRED)
  if (observation.lifecycle === 'cancelled' && observation.closureKind !== 'cancelled') fail(TRADE_V2_ERROR.CANCELLATION_CLOSURE_KIND_REQUIRED)
  if (observation.lifecycle === 'closed' && !observation.closureKind) fail(TRADE_V2_ERROR.TERMINAL_PROOF_REQUIRED)
  if (terminalLifecycle && (!observation.closureKind || !observation.closureInstruction || !observation.closureSignature)) fail(TRADE_V2_ERROR.TERMINAL_PROOF_REQUIRED)
  if (observation.closureInstruction && !/^((settle|cancel|recover)_escrow_v2(_[a-z0-9_]+)?|accept_escrow_v2(_[a-z0-9_]+)?)$/.test(observation.closureInstruction)) fail(TRADE_V2_ERROR.UNSUPPORTED_CLOSURE_INSTRUCTION)
  if (observation.closureKind === 'settled' && observation.closureInstruction && !/^(settle|accept)_escrow_v2/.test(observation.closureInstruction)) fail(TRADE_V2_ERROR.SETTLEMENT_INSTRUCTION_REQUIRED)
  if (observation.closureKind === 'cancelled' && observation.closureInstruction && !/^(cancel|recover)_escrow_v2/.test(observation.closureInstruction)) fail(TRADE_V2_ERROR.CANCELLATION_INSTRUCTION_REQUIRED)
}

export async function loadTradeV2GoldenVectors(readText: (path: string) => Promise<string>, path = 'docs/fixtures/trade_authority_v2_vectors.json') {
  return JSON.parse(await readText(path)) as {
    readonly schemaVersion: number
    readonly generatedBy: string
    readonly vectors: readonly { readonly name: string; readonly input: TradeV2CommitmentInput; readonly [key: string]: unknown }[]
  }
}

export function verifyTradeV2GoldenVector(vector: { readonly input: TradeV2CommitmentInput; readonly [key: string]: unknown }): boolean {
  const actual = computeTradeV2Commitment(vector.input)
  return actual.canonicalTerms === vector.canonicalTerms
    && actual.canonicalTermsHex === vector.canonicalTermsHex
    && actual.termsHashHex === vector.termsHashHex
    && actual.commitmentPreimageHex === vector.commitmentPreimageHex
    && actual.tradeCommitment === vector.tradeCommitment
}

// Bounded Oracle error contract shared by service boundaries.
export { safeAssetResolutionErrorCode, sessionOracleFailure } from './trade-authority-errors.js'
