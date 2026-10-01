/**
 * TradeSession (escrow v4) transaction planner — platform-agnostic, pure data.
 *
 * Produces ordered transaction-group descriptors (no RPC calls). Compressed
 * legs are left as placeholders: the group carries `needsFreshCnftProof` plus
 * a `buildWithFreshProof` callback the sender invokes with a fresh DAS proof
 * immediately before signing (docs/program.md §Client transaction-
 * packing rules).
 *
 * Per-kind remaining-account layouts follow docs/program.md §Per-kind
 * layouts, which designates the existing rails as the single source of truth
 * (TS mirror: the frozen rail account contract). The pNFT 13-slot and Core
 * account assemblies below are behavior-identical copies of that module —
 * re-declared here because the session module must not transitively import
 * `escrow/legacy_escrow.ts` (its `enum` breaks the web `erasableSyntaxOnly`
 * build; see types.ts header).
 */

import { PublicKey, SystemProgram, SYSVAR_INSTRUCTIONS_PUBKEY } from '@solana/web3.js'
import { AccountRole, address as kitAddress, type AccountMeta, type Instruction } from '@solana/kit'
import { TOKEN_2022_PROGRAM_ID } from '../internal/token.js'

import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  BUBBLEGUM_PROGRAM_ID,
  CORE_PROGRAM_ID,
  PROGRAM_ID as DEFAULT_PROGRAM_ID,
  SPL_NOOP_PROGRAM_ID,
  TOKEN_AUTH_RULES_PROGRAM_ID,
  TOKEN_METADATA_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '../internal/program-ids.js'
import { deriveConfigPda } from '../internal/pda.js'
import { tradeAuthorityEntitlementBeneficiary } from '../entitlement.js'
import {
  HARD_MAX_SLOTS_PER_SIDE,
  LAUNCH_MAX_SLOTS_PER_SIDE,
  MAX_SESSION_CNFT_PROOF_SIZE,
  RELEASE_REIMBURSEMENT_LAMPORTS,
} from './layout.js'
import { deriveSessionPda } from './pda.js'
import {
  getAppendSlotsV4Instruction,
  getCancelSessionV4Instruction,
  getCloseSessionV4Instruction,
  getCommitTradeV4Instruction,
  getCreateSessionV4Instruction,
  getDepositAssetV4Instruction,
  getFinalizeManifestV4Instruction,
  getReleaseAssetV4Instruction,
  getStartAcceptV4Instruction,
  getWithdrawAssetV4Instruction,
  SLOT_SPEC_V4_ENCODED_LENGTH,
} from './instructions.js'
import {
  AssetKindV4,
  SessionPhase,
  SlotSide,
  SlotStatus,
  type AssetSlotV4,
  type SessionAtaCreation,
  type SessionCnftProofInput,
  type SessionSignerRole,
  type SessionTxGroup,
  type SessionTxPlan,
  type SessionUserFacing,
  type SlotSpecV4,
  type TradeSessionState,
} from './types.js'

export const SPL_ACCOUNT_COMPRESSION_PROGRAM_ID = new PublicKey('cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK')

/** SPL/Token-2022 legs may pack a few deposits/releases per transaction. */
export const MAX_TOKEN_LEGS_PER_TRANSACTION = 3

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export type SessionLegInput = {
  readonly kind: AssetKindV4
  readonly mintOrAssetId: PublicKey
  /** Merkle tree — required for Compressed legs, must be absent otherwise. */
  readonly tree?: PublicKey | null
  /** Declared proof size — required for Compressed legs (1..=32). */
  readonly proofSize?: number | null
  /** Metaplex Core collection (Core legs; PublicKey.default when none). */
  readonly collection?: PublicKey | null
  /** pNFT authorization rule set, when the mint has one. */
  readonly ruleSet?: PublicKey | null
}

export type BuildSessionPlanInput = {
  readonly programId?: PublicKey
  readonly maker: PublicKey
  readonly taker: PublicKey
  readonly nonce: bigint | number
  /** Raw immutable canonical Trade Authority commitment bytes. */
  readonly tradeCommitment: Uint8Array
  readonly makerLegs: readonly SessionLegInput[]
  readonly takerLegs: readonly SessionLegInput[]
  readonly makerSol: bigint | number
  readonly takerSol: bigint | number
  /** i64 seconds; 0 (default) = no expiry. */
  readonly expiresAt?: bigint | number
  /** Defaults to RELEASE_REIMBURSEMENT_LAMPORTS * total_slots (program minimum). */
  readonly crankBondLamports?: bigint | number
  /** Runtime cap override; defaults to LAUNCH_MAX_SLOTS_PER_SIDE. */
  readonly launchCaps?: { readonly maxSlotsPerSide: number }
  /** fee_treasury for commit_trade_v4 (config.fee_treasury). */
  readonly feeTreasury: PublicKey
  /** Payer baked into post-commit release instructions (defaults to taker). */
  readonly releasePayer?: PublicKey
  /**
   * Optional display names keyed by mint/asset-id base58, used in the
   * user-facing copy of each group. Missing entries fall back to a shortened
   * address ("AbCd…WxYz").
   */
  readonly assetLabels?: Record<string, string>
}

// ---------------------------------------------------------------------------
// Small local helpers (mirrors of the frozen rail account contract)
// ---------------------------------------------------------------------------

const textEncoder = new TextEncoder()

function utf8(value: string): Uint8Array {
  return textEncoder.encode(value)
}

function toMeta(key: PublicKey, role: AccountRole): AccountMeta {
  return { address: kitAddress(key.toBase58()), role }
}

function toWritable(key: PublicKey): AccountMeta {
  return toMeta(key, AccountRole.WRITABLE)
}

function toReadonly(key: PublicKey): AccountMeta {
  return toMeta(key, AccountRole.READONLY)
}

/** ATA for any owner (session PDA owners are off-curve by construction). */
export function deriveSessionAta(mint: PublicKey, owner: PublicKey, tokenProgram: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBytes(), tokenProgram.toBytes(), mint.toBytes()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0]
}

function deriveMetadataPda(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [utf8('metadata'), TOKEN_METADATA_PROGRAM_ID.toBytes(), mint.toBytes()],
    TOKEN_METADATA_PROGRAM_ID,
  )[0]
}

function deriveMasterEditionPda(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [utf8('metadata'), TOKEN_METADATA_PROGRAM_ID.toBytes(), mint.toBytes(), utf8('edition')],
    TOKEN_METADATA_PROGRAM_ID,
  )[0]
}

function deriveTokenRecordPda(mint: PublicKey, tokenAccount: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [utf8('metadata'), TOKEN_METADATA_PROGRAM_ID.toBytes(), mint.toBytes(), utf8('token_record'), tokenAccount.toBytes()],
    TOKEN_METADATA_PROGRAM_ID,
  )[0]
}

export function deriveTreeAuthority(merkleTree: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([merkleTree.toBytes()], BUBBLEGUM_PROGRAM_ID)[0]
}

/**
 * pNFT 13-slot order (+ optional [auth_rules_program, auth_rules]) — mirror of
 * appendProgrammableRailAccounts in the frozen rail account contract.
 */
function buildProgrammableRemainingAccounts(args: {
  readonly mint: PublicKey
  readonly sourceToken: PublicKey
  readonly destinationToken: PublicKey
  readonly ruleSet?: PublicKey | null
}): AccountMeta[] {
  const metadata = deriveMetadataPda(args.mint)
  const edition = deriveMasterEditionPda(args.mint)
  const ownerRecord = deriveTokenRecordPda(args.mint, args.sourceToken)
  const destinationRecord = deriveTokenRecordPda(args.mint, args.destinationToken)
  const authorityRecord = ownerRecord

  const remaining: AccountMeta[] = [
    toReadonly(args.mint),
    toWritable(metadata),
    toReadonly(edition),
    toWritable(args.sourceToken),
    toWritable(args.destinationToken),
    toWritable(ownerRecord),
    toWritable(destinationRecord),
    toWritable(authorityRecord),
    toReadonly(TOKEN_METADATA_PROGRAM_ID),
    toReadonly(SYSVAR_INSTRUCTIONS_PUBKEY),
    toReadonly(TOKEN_PROGRAM_ID),
    toReadonly(ASSOCIATED_TOKEN_PROGRAM_ID),
    toReadonly(SystemProgram.programId),
  ]
  if (args.ruleSet) {
    remaining.push(toReadonly(TOKEN_AUTH_RULES_PROGRAM_ID))
    remaining.push(toReadonly(args.ruleSet))
  }
  return remaining
}

/**
 * Core order used by the v2 rails: [asset(w), collection|default,
 * system_program, core_program]. NOTE: the ABI doc's §Per-kind prose lists
 * "(asset, optional collection, mpl-core program, system_program)" but also
 * declares the existing rails the single source of truth; the rails order
 * (system before core program) is used here.
 */
function buildCoreRemainingAccounts(asset: PublicKey, collection: PublicKey | null | undefined): AccountMeta[] {
  return [
    toWritable(asset),
    toReadonly(collection ?? PublicKey.default),
    toReadonly(SystemProgram.programId),
    toReadonly(CORE_PROGRAM_ID),
  ]
}

/**
 * Compressed fixed prefix + proof nodes: [tree_authority, merkle_tree,
 * bubblegum_program, log_wrapper, compression_program, system_program,
 * proof_node_0..proof_node_{proof_size-1}].
 */
function buildCompressedRemainingAccounts(tree: PublicKey, proof: readonly PublicKey[]): AccountMeta[] {
  return [
    toWritable(deriveTreeAuthority(tree)),
    toWritable(tree),
    toReadonly(BUBBLEGUM_PROGRAM_ID),
    toReadonly(SPL_NOOP_PROGRAM_ID),
    toReadonly(SPL_ACCOUNT_COMPRESSION_PROGRAM_ID),
    toReadonly(SystemProgram.programId),
    ...proof.map((node) => toReadonly(node)),
  ]
}

function isPackableTokenKind(kind: AssetKindV4): boolean {
  return kind === AssetKindV4.Spl || kind === AssetKindV4.Token2022
}

// ---------------------------------------------------------------------------
// Serialized-size probe for create/append/finalize packing
// ---------------------------------------------------------------------------

const MAX_TRANSACTION_BYTES = 1232
/** Margin for compute-budget prepends and wallet quirks. */
const TRANSACTION_SIZE_MARGIN = 80

function shortVecLength(value: number): number {
  let remaining = Math.max(0, value)
  let length = 1
  while (remaining >= 0x80) {
    remaining >>= 7
    length += 1
  }
  return length
}

type InstructionSizeProbe = {
  readonly accountCount: number
  readonly dataLength: number
}

/**
 * Conservative single-signer size estimate for the create/append/finalize
 * transaction: 6 static keys (maker, taker, session, config, system program,
 * escrow program).
 */
function estimateCreateTransactionBytes(instructions: readonly InstructionSizeProbe[]): number {
  const staticKeys = 6
  let size = 64 // 1 signature
  size += 1 // signature shortvec
  size += 3 // message header
  size += shortVecLength(staticKeys) + staticKeys * 32
  size += 32 // recent blockhash
  size += shortVecLength(instructions.length)
  for (const ix of instructions) {
    size += 1 + shortVecLength(ix.accountCount) + ix.accountCount
    size += shortVecLength(ix.dataLength) + ix.dataLength
  }
  return size
}

const CREATE_IX_PROBE: InstructionSizeProbe = { accountCount: 5, dataLength: 8 + 8 + 1 + 1 + 8 + 8 + 8 + 8 + 32 }
const FINALIZE_IX_PROBE: InstructionSizeProbe = { accountCount: 2, dataLength: 8 }

function appendIxProbe(specCount: number): InstructionSizeProbe {
  return { accountCount: 2, dataLength: 8 + 4 + specCount * SLOT_SPEC_V4_ENCODED_LENGTH }
}

function fitsCreateTransaction(instructions: readonly InstructionSizeProbe[]): boolean {
  return estimateCreateTransactionBytes(instructions) + TRANSACTION_SIZE_MARGIN <= MAX_TRANSACTION_BYTES
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function toSlotSpec(side: (typeof SlotSide)[keyof typeof SlotSide], leg: SessionLegInput): SlotSpecV4 {
  const isCompressed = leg.kind === AssetKindV4.Compressed
  if (isCompressed) {
    if (!leg.tree || leg.tree.equals(PublicKey.default)) {
      throw new Error(`Compressed leg ${leg.mintOrAssetId.toBase58()} requires a non-zero merkle tree`)
    }
    const proofSize = leg.proofSize ?? 0
    if (!Number.isInteger(proofSize) || proofSize < 1 || proofSize > MAX_SESSION_CNFT_PROOF_SIZE) {
      throw new Error(`Compressed leg ${leg.mintOrAssetId.toBase58()} proofSize must be 1..=${MAX_SESSION_CNFT_PROOF_SIZE}`)
    }
    return { side, kind: leg.kind, mintOrAssetId: leg.mintOrAssetId, tree: leg.tree, proofSize }
  }
  if (leg.kind === AssetKindV4.Core) {
    if (leg.tree && !leg.tree.equals(PublicKey.default)) throw new Error('Core collection must use the collection field')
    return { side, kind: leg.kind, mintOrAssetId: leg.mintOrAssetId, tree: leg.collection ?? PublicKey.default, proofSize: 0 }
  }
  if (leg.tree && !leg.tree.equals(PublicKey.default)) {
    throw new Error(`Non-compressed leg ${leg.mintOrAssetId.toBase58()} must not declare a merkle tree`)
  }
  if (leg.kind !== AssetKindV4.Spl && leg.kind !== AssetKindV4.Programmable && leg.kind !== AssetKindV4.Token2022) {
    throw new Error(`Unknown asset kind ${String(leg.kind)}`)
  }
  return { side, kind: leg.kind, mintOrAssetId: leg.mintOrAssetId, tree: PublicKey.default, proofSize: 0 }
}

function validatePlanInput(input: BuildSessionPlanInput): void {
  if (input.tradeCommitment.length !== 32 || input.tradeCommitment.every((byte) => byte === 0)) {
    throw new Error('Trade Authority sessions require a non-zero 32-byte commitment')
  }
  const maxPerSide = Math.min(input.launchCaps?.maxSlotsPerSide ?? LAUNCH_MAX_SLOTS_PER_SIDE, HARD_MAX_SLOTS_PER_SIDE)
  if (input.maker.equals(input.taker)) {
    throw new Error('Session maker and taker must differ')
  }
  if (input.makerLegs.length > maxPerSide || input.takerLegs.length > maxPerSide) {
    throw new Error(`Session slots per side capped at ${maxPerSide}`)
  }
  const makerSol = BigInt(input.makerSol)
  const takerSol = BigInt(input.takerSol)
  if (input.makerLegs.length === 0 && makerSol <= 0n) {
    throw new Error('Maker side must contribute at least one asset or SOL')
  }
  if (input.takerLegs.length === 0 && takerSol <= 0n) {
    throw new Error('Taker side must contribute at least one asset or SOL')
  }
  const seen = new Set<string>()
  for (const leg of [...input.makerLegs, ...input.takerLegs]) {
    const key = leg.mintOrAssetId.toBase58()
    if (seen.has(key)) {
      throw new Error(`Duplicate asset in manifest: ${key}`)
    }
    seen.add(key)
  }
}

// ---------------------------------------------------------------------------
// User-facing copy — plain-language explanation of each signature
// ---------------------------------------------------------------------------

function shortenAddress(key: PublicKey): string {
  const base58 = key.toBase58()
  return `${base58.slice(0, 4)}…${base58.slice(-4)}`
}

/** Display name for an asset: caller-provided label, else shortened mint. */
function assetDisplayLabel(mintOrAssetId: PublicKey, assetLabels?: Record<string, string>): string {
  const label = assetLabels?.[mintOrAssetId.toBase58()]?.trim()
  return label ? label : shortenAddress(mintOrAssetId)
}

const CNFT_ALONE_REASON = 'Compressed NFTs carry a large ownership proof, so this one always travels alone.'
const SIZE_LIMIT_REASON = "Each NFT needs its own transaction because of Solana's size limit."

/** Permissionless close still requires a payer signature, not a service signer. */
function closeUserFacing(signerRole: SessionSignerRole): SessionUserFacing {
  const base = 'Closes the finished on-chain trade record and returns its storage deposit to the maker. No assets move in this step'
  return {
    title: 'Close the trade record',
    detail: signerRole === 'crank'
      ? `${base}. The transaction payer signs; if you are paying, approve this cleanup in your wallet.`
      : `${base}.`,
  }
}

// ---------------------------------------------------------------------------
// Per-slot asset-movement group builder (deposit / release / withdraw)
// ---------------------------------------------------------------------------

type MovementOp = 'deposit' | 'release' | 'withdraw'

type MovementContext = {
  readonly programId: PublicKey
  readonly sessionPda: PublicKey
  readonly maker: PublicKey
  readonly taker: PublicKey
  /** Wallet paying for release/withdraw instructions (anyone post-commit). */
  readonly payer: PublicKey
  /** Optional mint-base58 -> display-name map for user-facing copy. */
  readonly assetLabels?: Record<string, string>
}

type PlannedSlot = {
  readonly slotIndex: number
  readonly spec: SlotSpecV4
  readonly leg: SessionLegInput
}

function sideWallet(ctx: MovementContext, spec: SlotSpecV4): PublicKey {
  return spec.side === SlotSide.Maker ? ctx.maker : ctx.taker
}

function counterpartyWallet(ctx: MovementContext, spec: SlotSpecV4): PublicKey {
  return spec.side === SlotSide.Maker ? ctx.taker : ctx.maker
}

/** Token source/destination owners for one movement. */
function movementEndpoints(op: MovementOp, ctx: MovementContext, spec: SlotSpecV4): { source: PublicKey; destination: PublicKey } {
  if (op === 'deposit') {
    return { source: sideWallet(ctx, spec), destination: ctx.sessionPda }
  }
  if (op === 'release') {
    return { source: ctx.sessionPda, destination: counterpartyWallet(ctx, spec) }
  }
  return { source: ctx.sessionPda, destination: sideWallet(ctx, spec) }
}

function buildMovementInstruction(
  op: MovementOp,
  ctx: MovementContext,
  slot: PlannedSlot,
  tokenProgram: PublicKey,
  remainingAccounts: readonly AccountMeta[],
  cnftArgs: SessionCnftProofInput | null,
): Instruction {
  const common = {
    programAddress: ctx.programId,
    tokenProgram,
    slotIndex: slot.slotIndex,
    cnftArgs,
    remainingAccounts,
  }
  if (op === 'deposit') {
    return getDepositAssetV4Instruction({
      ...common,
      depositor: sideWallet(ctx, slot.spec),
      session: ctx.sessionPda,
    })
  }
  if (op === 'release') {
    return getReleaseAssetV4Instruction({
      ...common,
      payer: ctx.payer,
      session: ctx.sessionPda,
      maker: ctx.maker,
      taker: ctx.taker,
    })
  }
  return getWithdrawAssetV4Instruction({
    ...common,
    payer: ctx.payer,
    session: ctx.sessionPda,
    depositor: sideWallet(ctx, slot.spec),
  })
}

function movementSignerRole(op: MovementOp, spec: SlotSpecV4): SessionSignerRole {
  if (op === 'deposit') {
    return spec.side === SlotSide.Maker ? 'maker' : 'taker'
  }
  // Historical role label: any permissionless payer can sign; no crank service is required.
  return 'crank'
}

function movementPhase(op: MovementOp, spec: SlotSpecV4): SessionTxGroup['phase'] {
  if (op === 'deposit') {
    return spec.side === SlotSide.Maker ? 'makerDeposit' : 'takerDeposit'
  }
  return op
}

/**
 * Plain-language copy for one movement group. `positionBySlotIndex` /
 * `runTotal` number the assets within the whole movement run (e.g. deposit
 * "3 of 8" on an 8-asset side).
 */
function movementUserFacing(args: {
  readonly op: MovementOp
  readonly groupSlots: readonly PlannedSlot[]
  readonly positionBySlotIndex: ReadonlyMap<number, number>
  readonly runTotal: number
  readonly assetLabels?: Record<string, string>
}): SessionUserFacing {
  const { op, groupSlots, positionBySlotIndex, runTotal, assetLabels } = args
  const count = groupSlots.length
  const first = positionBySlotIndex.get(groupSlots[0].slotIndex) ?? 1
  const last = positionBySlotIndex.get(groupSlots[count - 1].slotIndex) ?? first
  const isCompressed = groupSlots[0].spec.kind === AssetKindV4.Compressed
  const singleLabel = assetDisplayLabel(groupSlots[0].spec.mintOrAssetId, assetLabels)

  if (op === 'deposit') {
    if (count === 1) {
      return {
        title: `Deposit ${singleLabel} (${first} of ${runTotal})`,
        detail: `Moves this one NFT into the neutral trade vault. Until the trade is committed, only you can get it back. ${isCompressed ? CNFT_ALONE_REASON : SIZE_LIMIT_REASON}`,
      }
    }
    return {
      title: `Deposit ${count} NFTs (${first}-${last} of ${runTotal})`,
      detail: `Moves these ${count} NFTs into the neutral trade vault in one transaction — simple token transfers are small enough to share one under Solana's size limit. Until the trade is committed, only you can get them back.`,
    }
  }

  if (op === 'release') {
    if (count === 1) {
      return {
        title: `Deliver ${singleLabel} to its new owner`,
        detail: `Pays this NFT out of the trade vault to the trader receiving it. Runs after the commit with fixed recipients. The transaction payer signs; if you are paying, approve this delivery in your wallet.${isCompressed ? ` ${CNFT_ALONE_REASON}` : ''}`,
      }
    }
    return {
      title: `Deliver ${count} NFTs to their new owners`,
      detail: `Pays these ${count} NFTs out of the trade vault to the traders receiving them. Runs after the commit with fixed recipients. The transaction payer signs; if you are paying, approve this delivery in your wallet.`,
    }
  }

  // withdraw
  if (count === 1) {
    return {
      title: `Get ${singleLabel} back`,
      detail: `Returns this NFT from the trade vault to the wallet that deposited it. Nothing swaps — cancelling always sends every asset back where it came from. ${isCompressed ? CNFT_ALONE_REASON : SIZE_LIMIT_REASON}`,
    }
  }
  return {
    title: `Get ${count} NFTs back`,
    detail: `Returns these ${count} NFTs from the trade vault to the wallets that deposited them. Nothing swaps — cancelling always sends every asset back where it came from.`,
  }
}

/** Build one slot's instruction + ATA flags (non-compressed kinds). */
function buildTokenMovement(
  op: MovementOp,
  ctx: MovementContext,
  slot: PlannedSlot,
): { instruction: Instruction; ataCreations: SessionAtaCreation[] } {
  const { spec, leg } = slot
  const { source, destination } = movementEndpoints(op, ctx, spec)
  const ataCreations: SessionAtaCreation[] = []

  switch (spec.kind) {
    case AssetKindV4.Spl: {
      const sourceAta = deriveSessionAta(spec.mintOrAssetId, source, TOKEN_PROGRAM_ID)
      const destinationAta = deriveSessionAta(spec.mintOrAssetId, destination, TOKEN_PROGRAM_ID)
      ataCreations.push({ mint: spec.mintOrAssetId, owner: destination, ata: destinationAta, tokenProgram: TOKEN_PROGRAM_ID })
      return {
        instruction: buildMovementInstruction(op, ctx, slot, TOKEN_PROGRAM_ID, [toWritable(sourceAta), toWritable(destinationAta)], null),
        ataCreations,
      }
    }
    case AssetKindV4.Token2022: {
      // Program-side layout (docs/program.md): the named token_program
      // account is ALWAYS the SPL Token program (Anchor Program<Token> check);
      // the Token-2022 program travels in remaining accounts with the mint.
      const sourceAta = deriveSessionAta(spec.mintOrAssetId, source, TOKEN_2022_PROGRAM_ID)
      const destinationAta = deriveSessionAta(spec.mintOrAssetId, destination, TOKEN_2022_PROGRAM_ID)
      ataCreations.push({ mint: spec.mintOrAssetId, owner: destination, ata: destinationAta, tokenProgram: TOKEN_2022_PROGRAM_ID })
      const remaining = [
        toReadonly(spec.mintOrAssetId),
        toWritable(sourceAta),
        toWritable(destinationAta),
        toReadonly(TOKEN_2022_PROGRAM_ID),
      ]
      return {
        instruction: buildMovementInstruction(op, ctx, slot, TOKEN_PROGRAM_ID, remaining, null),
        ataCreations,
      }
    }
    case AssetKindV4.Programmable: {
      const sourceAta = deriveSessionAta(spec.mintOrAssetId, source, TOKEN_PROGRAM_ID)
      const destinationAta = deriveSessionAta(spec.mintOrAssetId, destination, TOKEN_PROGRAM_ID)
      ataCreations.push({ mint: spec.mintOrAssetId, owner: destination, ata: destinationAta, tokenProgram: TOKEN_PROGRAM_ID })
      const remaining = buildProgrammableRemainingAccounts({
        mint: spec.mintOrAssetId,
        sourceToken: sourceAta,
        destinationToken: destinationAta,
        ruleSet: leg.ruleSet ?? null,
      })
      return {
        instruction: buildMovementInstruction(op, ctx, slot, TOKEN_PROGRAM_ID, remaining, null),
        ataCreations,
      }
    }
    case AssetKindV4.Core: {
      const remaining = buildCoreRemainingAccounts(spec.mintOrAssetId, leg.collection ?? null)
      return {
        instruction: buildMovementInstruction(op, ctx, slot, TOKEN_PROGRAM_ID, remaining, null),
        ataCreations,
      }
    }
    default:
      throw new Error(`buildTokenMovement: unsupported kind ${String(spec.kind)}`)
  }
}

/**
 * Fail closed when an SPL / Token-2022 / pNFT transfer instruction does not
 * contain the exact ATA the planner derived from destination owner + slot mint
 * + token program. The on-chain program remains the security boundary; this
 * catches client-construction drift (including the mainnet canary's wrong-mint
 * destination class) before a wallet is asked to sign.
 */
export function assertCanonicalSessionAtaBindings(
  group: SessionTxGroup,
  instructions: readonly Instruction[] = group.instructions,
): void {
  const uniqueCreations = [...new Map(
    group.ataCreations.map((creation) => [creation.ata.toBase58(), creation]),
  ).values()]

  for (const creation of uniqueCreations) {
    const expectedAta = deriveSessionAta(creation.mint, creation.owner, creation.tokenProgram)
    if (!expectedAta.equals(creation.ata)) {
      throw new Error(
        `SESSION_DESTINATION_ATA_MISMATCH: ATA(${creation.owner.toBase58()}, ` +
        `${creation.mint.toBase58()}, ${creation.tokenProgram.toBase58()}) was not selected`,
      )
    }
    const destinationIsInTransfer = instructions.some((instruction) =>
      instruction.accounts?.some((account) => account.address === creation.ata.toBase58()),
    )
    if (!destinationIsInTransfer) {
      throw new Error(
        `SESSION_DESTINATION_ATA_MISMATCH: transfer does not contain destination ` +
        `${creation.ata.toBase58()} for mint ${creation.mint.toBase58()}`,
      )
    }
  }
}

function buildCompressedMovementGroup(
  op: MovementOp,
  ctx: MovementContext,
  slot: PlannedSlot,
  labelPrefix: string,
  userFacing: SessionUserFacing,
): SessionTxGroup {
  const { spec } = slot
  const expectedLeafOwner = op === 'deposit' ? sideWallet(ctx, spec) : ctx.sessionPda
  const buildWithFreshProof = (proof: SessionCnftProofInput): readonly Instruction[] => {
    if (proof.proof.length < spec.proofSize) {
      throw new Error(
        `Slot ${slot.slotIndex}: fresh proof has ${proof.proof.length} nodes, slot declares ${spec.proofSize}`,
      )
    }
    const trimmedProof = proof.proof.slice(0, spec.proofSize)
    const remaining = buildCompressedRemainingAccounts(spec.tree, trimmedProof)
    const cnftArgs: SessionCnftProofInput = { ...proof, proof: trimmedProof }
    return [buildMovementInstruction(op, ctx, slot, TOKEN_PROGRAM_ID, remaining, cnftArgs)]
  }
  return {
    label: `${labelPrefix}:cnft:slot-${slot.slotIndex}`,
    phase: movementPhase(op, spec),
    signerRole: movementSignerRole(op, spec),
    userFacing,
    slotIndexes: [slot.slotIndex],
    instructions: [],
    ataCreations: [],
    needsFreshCnftProof: {
      slotIndex: slot.slotIndex,
      assetId: spec.mintOrAssetId,
      tree: spec.tree,
      proofSize: spec.proofSize,
      expectedLeafOwner,
    },
    buildWithFreshProof,
  }
}

/**
 * Groups for a run of slots on one movement op, preserving slot order:
 * SPL/T22 legs pack up to MAX_TOKEN_LEGS_PER_TRANSACTION per group; pNFT and
 * cNFT legs always get their own transaction; Core legs ride alone too (they
 * are single-CPI but keep 1:1 for conservative account-lock budgeting).
 */
function buildMovementGroups(
  op: MovementOp,
  ctx: MovementContext,
  slots: readonly PlannedSlot[],
  labelPrefix: string,
): SessionTxGroup[] {
  const groups: SessionTxGroup[] = []
  let tokenPack: { slots: PlannedSlot[]; instructions: Instruction[]; ataCreations: SessionAtaCreation[] } | null = null

  // 1-based position of each slot within this movement run, for "n of total"
  // copy (a deposit run is exactly one side's slots).
  const positionBySlotIndex = new Map<number, number>(slots.map((slot, index) => [slot.slotIndex, index + 1]))
  const runTotal = slots.length
  const copyFor = (groupSlots: readonly PlannedSlot[]): SessionUserFacing =>
    movementUserFacing({ op, groupSlots, positionBySlotIndex, runTotal, assetLabels: ctx.assetLabels })

  const flushTokenPack = (): void => {
    if (!tokenPack) return
    const packed = tokenPack
    tokenPack = null
    const indexes = packed.slots.map((slot) => slot.slotIndex)
    groups.push({
      label: `${labelPrefix}:token:slots-${indexes.join('-')}`,
      phase: movementPhase(op, packed.slots[0].spec),
      signerRole: movementSignerRole(op, packed.slots[0].spec),
      userFacing: copyFor(packed.slots),
      slotIndexes: indexes,
      instructions: packed.instructions,
      ataCreations: packed.ataCreations,
    })
  }

  for (const slot of slots) {
    const kind = slot.spec.kind
    if (kind === AssetKindV4.Compressed) {
      flushTokenPack()
      groups.push(buildCompressedMovementGroup(op, ctx, slot, labelPrefix, copyFor([slot])))
      continue
    }
    const { instruction, ataCreations } = buildTokenMovement(op, ctx, slot)
    if (isPackableTokenKind(kind)) {
      if (!tokenPack) {
        tokenPack = { slots: [], instructions: [], ataCreations: [] }
      }
      tokenPack.slots.push(slot)
      tokenPack.instructions.push(instruction)
      tokenPack.ataCreations.push(...ataCreations)
      if (tokenPack.slots.length >= MAX_TOKEN_LEGS_PER_TRANSACTION) {
        flushTokenPack()
      }
      continue
    }
    // pNFT / Core: own transaction.
    flushTokenPack()
    groups.push({
      label: `${labelPrefix}:${kind === AssetKindV4.Programmable ? 'pnft' : 'core'}:slot-${slot.slotIndex}`,
      phase: movementPhase(op, slot.spec),
      signerRole: movementSignerRole(op, slot.spec),
      userFacing: copyFor([slot]),
      slotIndexes: [slot.slotIndex],
      instructions: [instruction],
      ataCreations,
    })
  }
  flushTokenPack()
  return groups
}

// ---------------------------------------------------------------------------
// create + append + finalize packing
// ---------------------------------------------------------------------------

const SETUP_DETAIL = 'Creates the on-chain trade sheet listing exactly what each side gives and receives. Nothing moves yet.'

/** Copy for one create-phase group, numbered "step i of n" when split. */
function createGroupUserFacing(
  group: Omit<SessionTxGroup, 'userFacing'>,
  index: number,
  total: number,
): SessionUserFacing {
  if (total === 1) {
    return { title: 'Set up the trade', detail: SETUP_DETAIL }
  }
  const part = ` (step ${index + 1} of ${total})`
  const stage = group.createStage
  if (stage?.includesCreate) {
    return {
      title: `Set up the trade${part}`,
      detail: `${SETUP_DETAIL} This trade lists too many assets for one transaction, so the list continues in the next step.`,
    }
  }
  if (stage?.includesFinalize) {
    if (group.slotIndexes.length === 0) {
      return {
        title: `Lock in the trade list${part}`,
        detail: 'Locks the completed trade sheet so it can never change. Nothing has moved yet.',
      }
    }
    return {
      title: `List the last assets and lock the trade sheet${part}`,
      detail: 'Adds the final batch of assets to the trade sheet and locks it so it can never change. Nothing moves yet.',
    }
  }
  return {
    title: `List more trade assets${part}`,
    detail: 'Adds the next batch of assets to the on-chain trade sheet. Nothing moves yet.',
  }
}

function buildCreateGroups(args: {
  readonly programId: PublicKey
  readonly maker: PublicKey
  readonly taker: PublicKey
  readonly sessionPda: PublicKey
  readonly config: PublicKey
  readonly nonce: bigint
  readonly specs: readonly SlotSpecV4[]
  readonly makerSol: bigint
  readonly takerSol: bigint
  readonly expiresAt: bigint
  readonly crankBondLamports: bigint
  readonly makerSlotCount: number
  readonly takerSlotCount: number
  readonly tradeCommitment: Uint8Array
}): SessionTxGroup[] {
  const createIx = getCreateSessionV4Instruction({
    programAddress: args.programId,
    maker: args.maker,
    taker: args.taker,
    session: args.sessionPda,
    config: args.config,
    nonce: args.nonce,
    makerSlotCount: args.makerSlotCount,
    takerSlotCount: args.takerSlotCount,
    makerSolAmount: args.makerSol,
    takerSolAmount: args.takerSol,
    expiresAt: args.expiresAt,
    crankBondLamports: args.crankBondLamports,
    tradeCommitment: args.tradeCommitment,
  })
  const appendIx = (specs: readonly SlotSpecV4[]): Instruction =>
    getAppendSlotsV4Instruction({ programAddress: args.programId, maker: args.maker, session: args.sessionPda, specs })
  const finalizeIx = getFinalizeManifestV4Instruction({
    programAddress: args.programId,
    maker: args.maker,
    session: args.sessionPda,
  })

  const totalSpecs = args.specs.length

  // Single-transaction fast path: create (+ append + finalize) fits.
  const singleProbe: InstructionSizeProbe[] = totalSpecs === 0
    ? [CREATE_IX_PROBE, FINALIZE_IX_PROBE]
    : [CREATE_IX_PROBE, appendIxProbe(totalSpecs), FINALIZE_IX_PROBE]
  if (fitsCreateTransaction(singleProbe)) {
    const instructions = totalSpecs === 0 ? [createIx, finalizeIx] : [createIx, appendIx(args.specs), finalizeIx]
    return [{
      label: 'create:session',
      phase: 'create',
      signerRole: 'maker',
      userFacing: { title: 'Set up the trade', detail: SETUP_DETAIL },
      slotIndexes: args.specs.map((_, index) => index),
      instructions,
      ataCreations: [],
      createStage: { includesCreate: true, includesFinalize: true, appendedThroughSlotIndex: totalSpecs - 1 },
    }]
  }

  // Split path: create + as many specs as fit, then append chunks, finalize
  // riding the last chunk when it fits. User-facing copy is stamped at the
  // end, once the number of steps is known.
  const groups: Array<Omit<SessionTxGroup, 'userFacing'>> = []
  let cursor = 0

  const maxSpecsThatFit = (base: readonly InstructionSizeProbe[]): number => {
    let count = 0
    while (cursor + count < totalSpecs && fitsCreateTransaction([...base, appendIxProbe(count + 1)])) {
      count += 1
    }
    return count
  }

  const firstChunk = maxSpecsThatFit([CREATE_IX_PROBE])
  {
    const chunk = args.specs.slice(cursor, cursor + firstChunk)
    const instructions = chunk.length > 0 ? [createIx, appendIx(chunk)] : [createIx]
    groups.push({
      label: 'create:session',
      phase: 'create',
      signerRole: 'maker',
      slotIndexes: chunk.map((_, index) => cursor + index),
      instructions,
      ataCreations: [],
      createStage: { includesCreate: true, includesFinalize: false, appendedThroughSlotIndex: cursor + chunk.length - 1 },
    })
    cursor += chunk.length
  }

  while (cursor < totalSpecs) {
    const chunkSize = Math.max(1, maxSpecsThatFit([]))
    const chunk = args.specs.slice(cursor, cursor + chunkSize)
    const isLastChunk = cursor + chunk.length >= totalSpecs
    const finalizeFits = isLastChunk && fitsCreateTransaction([appendIxProbe(chunk.length), FINALIZE_IX_PROBE])
    groups.push({
      label: `create:append-slots-${cursor}-${cursor + chunk.length - 1}`,
      phase: 'create',
      signerRole: 'maker',
      slotIndexes: chunk.map((_, index) => cursor + index),
      instructions: finalizeFits ? [appendIx(chunk), finalizeIx] : [appendIx(chunk)],
      ataCreations: [],
      createStage: {
        includesCreate: false,
        includesFinalize: finalizeFits,
        appendedThroughSlotIndex: cursor + chunk.length - 1,
      },
    })
    cursor += chunk.length
  }

  const finalizeEmitted = groups.some((group) => group.createStage?.includesFinalize)
  if (!finalizeEmitted) {
    groups.push({
      label: 'create:finalize-manifest',
      phase: 'create',
      signerRole: 'maker',
      slotIndexes: [],
      instructions: [finalizeIx],
      ataCreations: [],
      createStage: { includesCreate: false, includesFinalize: true, appendedThroughSlotIndex: totalSpecs - 1 },
    })
  }
  return groups.map((group, index) => ({
    ...group,
    userFacing: createGroupUserFacing(group, index, groups.length),
  }))
}

// ---------------------------------------------------------------------------
// Public planner API
// ---------------------------------------------------------------------------

/**
 * Full happy-path plan: [create(+append+finalize)] -> maker deposits ->
 * start_accept -> taker deposits -> commit -> releases. Pure data; the sender
 * injects fresh cNFT proofs and prepends flagged ATA creations.
 */
export function buildSessionPlan(input: BuildSessionPlanInput): SessionTxPlan {
  validatePlanInput(input)
  const programId = input.programId ?? DEFAULT_PROGRAM_ID
  const nonce = BigInt(input.nonce)
  const [sessionPda, bump] = deriveSessionPda(programId, input.maker, input.taker, nonce)
  const [config] = deriveConfigPda(programId)

  const makerSpecs = input.makerLegs.map((leg) => toSlotSpec(SlotSide.Maker, leg))
  const takerSpecs = input.takerLegs.map((leg) => toSlotSpec(SlotSide.Taker, leg))
  const specs = [...makerSpecs, ...takerSpecs]
  const totalSlots = specs.length
  const crankBondLamports = input.crankBondLamports !== undefined
    ? BigInt(input.crankBondLamports)
    : RELEASE_REIMBURSEMENT_LAMPORTS * BigInt(totalSlots)

  const releasePayer = input.releasePayer ?? input.taker
  const ctx: MovementContext = {
    programId,
    sessionPda,
    maker: input.maker,
    taker: input.taker,
    payer: releasePayer,
    assetLabels: input.assetLabels,
  }

  const plannedSlots: PlannedSlot[] = specs.map((spec, slotIndex) => ({
    slotIndex,
    spec,
    leg: slotIndex < input.makerLegs.length ? input.makerLegs[slotIndex] : input.takerLegs[slotIndex - input.makerLegs.length],
  }))
  const makerSlots = plannedSlots.filter((slot) => slot.spec.side === SlotSide.Maker)
  const takerSlots = plannedSlots.filter((slot) => slot.spec.side === SlotSide.Taker)

  const groups: SessionTxGroup[] = []

  groups.push(...buildCreateGroups({
    programId,
    maker: input.maker,
    taker: input.taker,
    sessionPda,
    config,
    nonce,
    specs,
    makerSol: BigInt(input.makerSol),
    takerSol: BigInt(input.takerSol),
    expiresAt: BigInt(input.expiresAt ?? 0),
    crankBondLamports,
    makerSlotCount: makerSpecs.length,
    takerSlotCount: takerSpecs.length,
    tradeCommitment: input.tradeCommitment,
  }))

  groups.push(...buildMovementGroups('deposit', ctx, makerSlots, 'maker-deposit'))

  groups.push({
    label: 'start-accept',
    phase: 'startAccept',
    signerRole: 'taker',
    userFacing: {
      title: "Confirm you're taking this offer",
      detail: 'Records your intent to take this trade on-chain. Nothing moves yet — your deposits start next.',
    },
    slotIndexes: [],
    instructions: [getStartAcceptV4Instruction({ programAddress: programId, taker: input.taker, session: sessionPda })],
    ataCreations: [],
  })

  groups.push(...buildMovementGroups('deposit', ctx, takerSlots, 'taker-deposit'))

  groups.push({
    label: 'commit-trade',
    phase: 'commit',
    signerRole: 'taker',
    userFacing: {
      title: 'Commit the trade — final step',
      detail: 'Settlement makes each recipient’s escrow entitlement final and settles SOL and fees. NFTs may then be withdrawn one at a time; anyone can submit a release to its fixed recipient.',
    },
    slotIndexes: [],
    instructions: [getCommitTradeV4Instruction({
      programAddress: programId,
      taker: input.taker,
      maker: input.maker,
      session: sessionPda,
      config,
      feeTreasury: input.feeTreasury,
      remainingAccounts: plannedSlots.filter(slot => slot.spec.kind === AssetKindV4.Core).flatMap(slot => [
        toReadonly(slot.spec.mintOrAssetId),
        toReadonly(slot.spec.tree.equals(PublicKey.default) ? CORE_PROGRAM_ID : slot.spec.tree),
      ]),
    })],
    ataCreations: [],
  })

  groups.push(...buildMovementGroups('release', ctx, plannedSlots, 'release'))

  groups.push({
    label: 'close-session',
    phase: 'close',
    signerRole: 'crank',
    userFacing: closeUserFacing('crank'),
    slotIndexes: [],
    instructions: [getCloseSessionV4Instruction({
      programAddress: programId,
      payer: releasePayer,
      session: sessionPda,
      maker: input.maker,
      taker: input.taker,
    })],
    ataCreations: [],
  })

  return {
    programId,
    sessionPda,
    bump,
    maker: input.maker,
    taker: input.taker,
    nonce,
    makerSlotCount: makerSpecs.length,
    takerSlotCount: takerSpecs.length,
    groups,
  }
}

/** Per-asset construction material. Core collection is never read from here. */
export type SessionLegMetadata = {
  readonly ruleSet?: PublicKey | null
  readonly collection?: PublicKey | null
  readonly source?: 'authenticated_oracle'
  readonly oracleSequence?: string
  readonly observedSlot?: string
}

function slotToLeg(slot: AssetSlotV4, legMeta?: ReadonlyMap<string, SessionLegMetadata>): SessionLegInput {
  const meta = legMeta?.get(slot.mintOrAssetId.toBase58())
  if (slot.kind === AssetKindV4.Programmable
    && (meta?.source !== 'authenticated_oracle' || !Object.hasOwn(meta, 'ruleSet')
      || !/^\d+$/.test(meta.oracleSequence ?? '') || !/^\d+$/.test(meta.observedSlot ?? ''))) {
    throw new Error(`PNFT_AUTHORITATIVE_RELEASE_METADATA_REQUIRED:${slot.mintOrAssetId.toBase58()}`)
  }
  return {
    kind: slot.kind,
    mintOrAssetId: slot.mintOrAssetId,
    tree: slot.kind === AssetKindV4.Compressed ? slot.tree : null,
    proofSize: slot.kind === AssetKindV4.Compressed ? slot.proofSize : null,
    ruleSet: slot.kind === AssetKindV4.Programmable ? meta!.ruleSet ?? null : null,
    // Core collection/no-collection is immutable in the slot.tree field.
    collection: slot.kind === AssetKindV4.Core
      ? (slot.tree.equals(PublicKey.default) ? null : slot.tree)
      : null,
  }
}

/**
 * Reconstruct only the unfinished deterministic release tail for a session
 * that is already irrevocably Committed. Released slots are intentionally
 * omitted. Caller-validated blocked Core legs remain pending; no close is
 * planned while any are omitted. Incomplete/invalid manifests fail closed.
 * Otherwise close remains last and succeeds only after every release completes.
 * The historical signerRole=crank label means permissionless payer, not a service.
 */
export function buildCommittedRecoveryPlan(args: {
  readonly programId: PublicKey
  readonly sessionPda: PublicKey
  readonly state: TradeSessionState
  readonly payer: PublicKey
  /** Authenticated omission-only Core hints, keyed by original global slot index.
   * Callers validate identity/policy/freshness; hints never change custody or beneficiary. */
  readonly releaseBlockedSlotIndexes?: readonly number[]
  readonly legMeta?: ReadonlyMap<string, SessionLegMetadata>
  readonly assetLabels?: Record<string, string>
}): SessionTxPlan {
  if (args.state.phase !== SessionPhase.Committed) {
    throw new Error('Committed-session recovery requires Committed phase')
  }
  const { state } = args
  const declaredTotal = state.makerSlotCount + state.takerSlotCount
  if (state.slots.length !== declaredTotal || state.filledSlotCount !== declaredTotal
    || state.slots.some((slot, index) =>
      slot.side !== (index < state.makerSlotCount ? SlotSide.Maker : SlotSide.Taker)
      || (slot.status !== SlotStatus.Deposited && slot.status !== SlotStatus.Released))) {
    throw new Error('Committed session manifest incomplete or invalid; refresh authoritative state before recovery')
  }
  const ctx: MovementContext = {
    programId: args.programId,
    sessionPda: args.sessionPda,
    maker: args.state.maker,
    taker: args.state.taker,
    payer: args.payer,
    assetLabels: args.assetLabels,
  }
  const hasBlockedRelease = args.state.slots.some((slot, slotIndex) =>
    slot.status === SlotStatus.Deposited && slot.kind === AssetKindV4.Core
      && args.releaseBlockedSlotIndexes?.includes(slotIndex))
  const depositedSlots: PlannedSlot[] = args.state.slots
    .map((slot, slotIndex) => ({ slot, slotIndex }))
    .filter(({ slot, slotIndex }) => slot.status === SlotStatus.Deposited
      && !(slot.kind === AssetKindV4.Core && args.releaseBlockedSlotIndexes?.includes(slotIndex)))
    .map(({ slot, slotIndex }) => ({
      slotIndex,
      spec: {
        side: slot.side,
        kind: slot.kind,
        mintOrAssetId: slot.mintOrAssetId,
        tree: slot.tree,
        proofSize: slot.proofSize,
      },
      leg: slotToLeg(slot, args.legMeta),
    }))
  const groups = [
    ...buildMovementGroups('release', ctx, depositedSlots, 'resume-release'),
    ...(!hasBlockedRelease ? [buildCloseGroup({
      programId: args.programId,
      sessionPda: args.sessionPda,
      maker: args.state.maker,
      taker: args.state.taker,
      payer: args.payer,
    })] : []),
  ]
  return {
    programId: args.programId,
    sessionPda: args.sessionPda,
    bump: args.state.bump,
    maker: args.state.maker,
    taker: args.state.taker,
    nonce: args.state.nonce,
    makerSlotCount: args.state.makerSlotCount,
    takerSlotCount: args.state.takerSlotCount,
    groups,
  }
}

/**
 * Build only one participant's pending incoming deliveries from authoritative
 * Committed state. The connected wallet is merely the transaction payer: the
 * recipient is always derived from immutable maker/taker + slot side.
 * Released slots and the counterparty's incoming slots are never included.
 */
export function buildParticipantClaimPlan(args: {
  readonly programId: PublicKey
  readonly sessionPda: PublicKey
  readonly state: TradeSessionState
  readonly participant: PublicKey
  readonly payer?: PublicKey
  /** Omission-only liveness hint; never changes phase, custody or beneficiary. */
  readonly releaseBlockedSlotIndexes?: readonly number[]
  readonly legMeta?: ReadonlyMap<string, SessionLegMetadata>
  readonly assetLabels?: Record<string, string>
}): SessionTxPlan {
  if (args.state.phase !== SessionPhase.Committed) {
    throw new Error('Manual claim requires a Committed session')
  }
  const participant = args.participant.toBase58()
  const participants = { maker: args.state.maker.toBase58(), taker: args.state.taker.toBase58() }
  if (participant !== participants.maker && participant !== participants.taker) {
    throw new Error('Manual claim is available only to a session participant')
  }
  const ctx: MovementContext = {
    programId: args.programId,
    sessionPda: args.sessionPda,
    maker: args.state.maker,
    taker: args.state.taker,
    payer: args.payer ?? args.participant,
    assetLabels: args.assetLabels,
  }
  const incoming: PlannedSlot[] = args.state.slots
    .map((slot, slotIndex) => ({ slot, slotIndex }))
    .filter(({ slot, slotIndex }) => slot.status === SlotStatus.Deposited
      && !(slot.kind === AssetKindV4.Core && args.releaseBlockedSlotIndexes?.includes(slotIndex))
      && tradeAuthorityEntitlementBeneficiary(slot.side === SlotSide.Maker ? 'maker' : 'taker', participants) === participant)
    .map(({ slot, slotIndex }) => ({
      slotIndex,
      spec: {
        side: slot.side,
        kind: slot.kind,
        mintOrAssetId: slot.mintOrAssetId,
        tree: slot.tree,
        proofSize: slot.proofSize,
      },
      leg: slotToLeg(slot, args.legMeta),
    }))
  return {
    programId: args.programId,
    sessionPda: args.sessionPda,
    bump: args.state.bump,
    maker: args.state.maker,
    taker: args.state.taker,
    nonce: args.state.nonce,
    makerSlotCount: args.state.makerSlotCount,
    takerSlotCount: args.state.takerSlotCount,
    groups: buildMovementGroups('release', ctx, incoming, 'claim-release'),
  }
}

/**
 * Rebuild the full plan from a decoded on-chain session. Slot order within a
 * side is fixed at manifest time, so the group ordering matches what
 * buildSessionPlan produced originally — safe to resume by group index once
 * completed groups are skipped via on-chain slot statuses.
 */
export function buildSessionPlanFromState(args: {
  readonly programId: PublicKey
  readonly state: TradeSessionState
  readonly feeTreasury: PublicKey
  readonly releasePayer?: PublicKey
  /** Committed recovery only; caller-validated, omission-only Core global indexes. */
  readonly releaseBlockedSlotIndexes?: readonly number[]
  readonly legMeta?: ReadonlyMap<string, SessionLegMetadata>
  readonly launchCaps?: { readonly maxSlotsPerSide: number }
  /** Optional mint-base58 -> display-name map for user-facing copy. */
  readonly assetLabels?: Record<string, string>
}): SessionTxPlan {
  const { state } = args
  if (state.phase === SessionPhase.Committed) {
    const [sessionPda] = deriveSessionPda(args.programId, state.maker, state.taker, state.nonce)
    return buildCommittedRecoveryPlan({
      programId: args.programId,
      sessionPda,
      state,
      payer: args.releasePayer ?? state.taker,
      releaseBlockedSlotIndexes: args.releaseBlockedSlotIndexes,
      legMeta: args.legMeta,
      assetLabels: args.assetLabels,
    })
  }
  if (state.phase === SessionPhase.Cancelling) {
    const [sessionPda] = deriveSessionPda(args.programId, state.maker, state.taker, state.nonce)
    const canceller = args.releasePayer ?? state.taker
    return buildCancelPlan({programId:args.programId,sessionPda,state,canceller,
      cancellerRole:canceller.equals(state.maker) ? 'maker' : canceller.equals(state.taker) ? 'taker' : 'crank',
      legMeta:args.legMeta,assetLabels:args.assetLabels})
  }
  // A partially-appended Building manifest cannot be reconstructed from chain:
  // the not-yet-appended slots exist only in the maker's original plan. A plan
  // rebuilt from the partial slot list would re-declare smaller counts and its
  // resume mapping would re-send create_session_v4 into the existing account.
  const declaredTotal = state.makerSlotCount + state.takerSlotCount
  if (state.slots.length !== declaredTotal) {
    throw new Error(
      `Session manifest incomplete on-chain (${state.slots.length} of ${declaredTotal} slots appended); ` +
      'resume it with the original plan, or cancel and close the draft to recover the escrowed SOL',
    )
  }
  // Building observations deliberately describe never-held dispositions so a
  // missing asset cannot block draft cancellation. Resume only finalization;
  // a fresh MakerDepositing observation must authorize subsequent funding.
  if (state.phase === SessionPhase.Building) {
    if (state.filledSlotCount !== declaredTotal) throw new Error('Session manifest incomplete on-chain')
    const [sessionPda] = deriveSessionPda(args.programId, state.maker, state.taker, state.nonce)
    return {programId:args.programId,sessionPda,bump:state.bump,maker:state.maker,taker:state.taker,
      nonce:state.nonce,makerSlotCount:state.makerSlotCount,takerSlotCount:state.takerSlotCount,
      groups:[{label:'create:finalize-manifest',phase:'create',signerRole:'maker',slotIndexes:[],
        instructions:[getFinalizeManifestV4Instruction({programAddress:args.programId,maker:state.maker,session:sessionPda})],
        ataCreations:[],createStage:{includesCreate:false,includesFinalize:true,appendedThroughSlotIndex:declaredTotal-1},
        userFacing:{title:'Finalize the trade manifest',detail:'No assets move. Resume funding after fresh admission verification.'}}]}
  }
  const makerLegs = state.slots.filter((slot) => slot.side === SlotSide.Maker).map((slot) => slotToLeg(slot, args.legMeta))
  const takerLegs = state.slots.filter((slot) => slot.side === SlotSide.Taker).map((slot) => slotToLeg(slot, args.legMeta))
  return buildSessionPlan({
    programId: args.programId,
    maker: state.maker,
    taker: state.taker,
    nonce: state.nonce,
    tradeCommitment: state.tradeCommitment,
    makerLegs,
    takerLegs,
    makerSol: state.makerSolAmount,
    takerSol: state.takerSolAmount,
    expiresAt: state.expiresAt,
    crankBondLamports: state.crankBondLamports,
    feeTreasury: args.feeTreasury,
    releasePayer: args.releasePayer,
    launchCaps: args.launchCaps ?? { maxSlotsPerSide: HARD_MAX_SLOTS_PER_SIDE },
    assetLabels: args.assetLabels,
  })
}

/** cancel_session_v4 as a single group. */
export function buildCancelGroup(args: {
  readonly programId: PublicKey
  readonly sessionPda: PublicKey
  readonly canceller: PublicKey
  readonly signerRole: SessionSignerRole
}): SessionTxGroup {
  return {
    label: 'cancel-session',
    phase: 'cancel',
    signerRole: args.signerRole,
    userFacing: {
      title: 'Cancel the trade',
      detail: 'Stops this trade before it becomes final. Nothing swaps — the next steps return every deposited NFT to its original owner.',
    },
    slotIndexes: [],
    instructions: [getCancelSessionV4Instruction({
      programAddress: args.programId,
      canceller: args.canceller,
      session: args.sessionPda,
    })],
    ataCreations: [],
  }
}

/** Withdraw groups for every currently-Deposited slot (Cancelling / expired). */
export function buildWithdrawGroups(args: {
  readonly programId: PublicKey
  readonly sessionPda: PublicKey
  readonly state: TradeSessionState
  readonly payer: PublicKey
  readonly legMeta?: ReadonlyMap<string, SessionLegMetadata>
  /** Optional mint-base58 -> display-name map for user-facing copy. */
  readonly assetLabels?: Record<string, string>
}): SessionTxGroup[] {
  const ctx: MovementContext = {
    programId: args.programId,
    sessionPda: args.sessionPda,
    maker: args.state.maker,
    taker: args.state.taker,
    payer: args.payer,
    assetLabels: args.assetLabels,
  }
  const depositedSlots: PlannedSlot[] = args.state.slots
    .map((slot, slotIndex) => ({ slot, slotIndex }))
    .filter(({ slot }) => slot.status === SlotStatus.Deposited)
    .map(({ slot, slotIndex }) => ({
      slotIndex,
      spec: {
        side: slot.side,
        kind: slot.kind,
        mintOrAssetId: slot.mintOrAssetId,
        tree: slot.tree,
        proofSize: slot.proofSize,
      },
      leg: slotToLeg(slot, args.legMeta),
    }))
  return buildMovementGroups('withdraw', ctx, depositedSlots, 'withdraw')
}

/** close_session_v4 as a single group. */
export function buildCloseGroup(args: {
  readonly programId: PublicKey
  readonly sessionPda: PublicKey
  readonly maker: PublicKey
  readonly taker: PublicKey
  readonly payer: PublicKey
  readonly signerRole?: SessionSignerRole
}): SessionTxGroup {
  return {
    label: 'close-session',
    phase: 'close',
    signerRole: args.signerRole ?? 'crank',
    userFacing: closeUserFacing(args.signerRole ?? 'crank'),
    slotIndexes: [],
    instructions: [getCloseSessionV4Instruction({
      programAddress: args.programId,
      payer: args.payer,
      session: args.sessionPda,
      maker: args.maker,
      taker: args.taker,
    })],
    ataCreations: [],
  }
}

/**
 * Cancel-and-unwind plan: cancel (unless already Cancelling/expired-implicit),
 * withdraw every Deposited slot, then close.
 */
export function buildCancelPlan(args: {
  readonly programId: PublicKey
  readonly sessionPda: PublicKey
  readonly state: TradeSessionState
  readonly canceller: PublicKey
  readonly cancellerRole: SessionSignerRole
  readonly legMeta?: ReadonlyMap<string, SessionLegMetadata>
  /** Optional mint-base58 -> display-name map for user-facing copy. */
  readonly assetLabels?: Record<string, string>
}): SessionTxPlan {
  const groups: SessionTxGroup[] = []
  if (args.state.phase !== SessionPhase.Cancelling) {
    groups.push(buildCancelGroup({
      programId: args.programId,
      sessionPda: args.sessionPda,
      canceller: args.canceller,
      signerRole: args.cancellerRole,
    }))
  }
  groups.push(...buildWithdrawGroups({
    programId: args.programId,
    sessionPda: args.sessionPda,
    state: args.state,
    payer: args.canceller,
    legMeta: args.legMeta,
    assetLabels: args.assetLabels,
  }))
  groups.push(buildCloseGroup({
    programId: args.programId,
    sessionPda: args.sessionPda,
    maker: args.state.maker,
    taker: args.state.taker,
    payer: args.canceller,
    signerRole: args.cancellerRole,
  }))
  return {
    programId: args.programId,
    sessionPda: args.sessionPda,
    bump: args.state.bump,
    maker: args.state.maker,
    taker: args.state.taker,
    nonce: args.state.nonce,
    makerSlotCount: args.state.makerSlotCount,
    takerSlotCount: args.state.takerSlotCount,
    groups,
  }
}
