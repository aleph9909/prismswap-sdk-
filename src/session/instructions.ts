/**
 * TradeSession (escrow v4) instruction builders — platform-agnostic.
 *
 * ABI source of truth: docs/program.md §Instructions. Mirrors the
 * builder style of the historical escrow ABI: manual borsh
 * encoding, kit `Instruction` output ({ programAddress, accounts, data }),
 * no Anchor coders and no browser/DOM dependencies.
 *
 * Discriminators are Anchor globals: sha256("global:<snake_case_name>")[0..8].
 * Expected bytes (locked by test/abi.test.ts):
 *   create_session_v4     b3271bcbde51dfc9
 *   append_slots_v4       feff4d3242c388bc
 *   finalize_manifest_v4  fbf2f69e8af55234
 *   deposit_asset_v4      06b3cdfb1dbf76ad
 *   start_accept_v4       0912b0ebe0824fb4
 *   commit_trade_v4       e491fdf69d8129d4
 *   release_asset_v4      d4c559eef065a553
 *   cancel_session_v4     be981ff6f380fd24
 *   withdraw_asset_v4     9ac57b04208fadc4
 *   close_session_v4      5e059ccf3d1f5a06
 */

import { PublicKey, SystemProgram } from '@solana/web3.js'
import { sha256 } from '@noble/hashes/sha256'
import {
  AccountRole,
  address as kitAddress,
  type AccountMeta,
  type Address,
  type Instruction,
} from '@solana/kit'

import { PROGRAM_ID as DEFAULT_PROGRAM_ID, TOKEN_PROGRAM_ID } from '../internal/program-ids.js'
import type { CnftLeafArgsV4, SlotSpecV4 } from './types.js'

const textEncoder = new TextEncoder()

function utf8(value: string): Uint8Array {
  return textEncoder.encode(value)
}

/** Anchor instruction discriminator: sha256("global:<name>")[0..8]. */
export function anchorInstructionDiscriminator(name: string): Uint8Array {
  return sha256(utf8(`global:${name}`)).slice(0, 8)
}

export const CREATE_SESSION_V4_DISCRIMINATOR = anchorInstructionDiscriminator('create_session_v4')
export const APPEND_SLOTS_V4_DISCRIMINATOR = anchorInstructionDiscriminator('append_slots_v4')
export const FINALIZE_MANIFEST_V4_DISCRIMINATOR = anchorInstructionDiscriminator('finalize_manifest_v4')
export const DEPOSIT_ASSET_V4_DISCRIMINATOR = anchorInstructionDiscriminator('deposit_asset_v4')
export const START_ACCEPT_V4_DISCRIMINATOR = anchorInstructionDiscriminator('start_accept_v4')
export const COMMIT_TRADE_V4_DISCRIMINATOR = anchorInstructionDiscriminator('commit_trade_v4')
export const RELEASE_ASSET_V4_DISCRIMINATOR = anchorInstructionDiscriminator('release_asset_v4')
export const CANCEL_SESSION_V4_DISCRIMINATOR = anchorInstructionDiscriminator('cancel_session_v4')
export const WITHDRAW_ASSET_V4_DISCRIMINATOR = anchorInstructionDiscriminator('withdraw_asset_v4')
export const CLOSE_SESSION_V4_DISCRIMINATOR = anchorInstructionDiscriminator('close_session_v4')

// ---------------------------------------------------------------------------
// Shared plumbing (mirrors the historical escrow ABI)
// ---------------------------------------------------------------------------

export type AddressLike = PublicKey | Address<string>

function toAddress(value: AddressLike): Address<string> {
  if (typeof value === 'string') {
    return kitAddress(value)
  }
  return kitAddress(value.toBase58())
}

function toMeta(value: AddressLike, role: AccountRole): AccountMeta {
  return {
    address: toAddress(value),
    role,
  }
}

function createInstruction(
  programAddress: AddressLike,
  accounts: readonly AccountMeta[],
  data: Uint8Array,
): Instruction {
  return {
    programAddress: toAddress(programAddress),
    accounts,
    data,
  }
}

function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const result = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

function encodeU8(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 0xff) {
    throw new Error(`u8 out of range: ${value}`)
  }
  return new Uint8Array([value])
}

function encodeU32(value: number): Uint8Array {
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setUint32(0, value >>> 0, true)
  return bytes
}

function encodeU64(value: bigint | number): Uint8Array {
  const bigintValue = typeof value === 'bigint' ? value : BigInt(value)
  const buffer = new ArrayBuffer(8)
  new DataView(buffer).setBigUint64(0, bigintValue, true)
  return new Uint8Array(buffer)
}

function encodeI64(value: bigint | number): Uint8Array {
  const bigintValue = typeof value === 'bigint' ? value : BigInt(value)
  const buffer = new ArrayBuffer(8)
  new DataView(buffer).setBigInt64(0, bigintValue, true)
  return new Uint8Array(buffer)
}

/** borsh Option<T>: 0x00 = None, 0x01 + payload = Some. */
function encodeOption<T>(value: T | null, encoder: (v: T) => Uint8Array): Uint8Array {
  if (value === null) {
    return new Uint8Array([0])
  }
  return concatBytes([new Uint8Array([1]), encoder(value)])
}

// ---------------------------------------------------------------------------
// Arg-struct encoding — docs/program.md §Argument structs
// ---------------------------------------------------------------------------

/** SlotSpecV4: side(1) + kind(1) + mint_or_asset_id(32) + tree(32) + proof_size(1). */
export const SLOT_SPEC_V4_ENCODED_LENGTH = 67

export function encodeSlotSpecV4(spec: SlotSpecV4): Uint8Array {
  return concatBytes([
    encodeU8(spec.side),
    encodeU8(spec.kind),
    spec.mintOrAssetId.toBytes(),
    spec.tree.toBytes(),
    encodeU8(spec.proofSize),
  ])
}

/** borsh Vec<SlotSpecV4>: u32 LE length + elements. */
export function encodeVecSlotSpecV4(specs: readonly SlotSpecV4[]): Uint8Array {
  return concatBytes([encodeU32(specs.length), ...specs.map(encodeSlotSpecV4)])
}

/**
 * CnftLeafArgsV4: root(32) + data_hash(32) + creator_hash(32) + nonce(u64 LE)
 * + index(u32 LE). Field-identical to v3 CnftLeafArgs
 * (the historical escrow ABI encodeCnftLeafArgs).
 */
export const CNFT_LEAF_ARGS_V4_ENCODED_LENGTH = 32 + 32 + 32 + 8 + 4

export function encodeCnftLeafArgsV4(args: CnftLeafArgsV4): Uint8Array {
  if (args.root.length !== 32 || args.dataHash.length !== 32 || args.creatorHash.length !== 32) {
    throw new Error('CnftLeafArgsV4 hashes must be 32 bytes each')
  }
  return concatBytes([
    args.root,
    args.dataHash,
    args.creatorHash,
    encodeU64(args.nonce),
    encodeU32(args.index),
  ])
}

// ---------------------------------------------------------------------------
// Instruction builders
// ---------------------------------------------------------------------------

/**
 * 1. create_session_v4(nonce, maker_slot_count, taker_slot_count,
 *    maker_sol_amount, taker_sol_amount, expires_at, crank_bond_lamports,
 *    trade_commitment)
 * Accounts: maker(ws), taker, session(w), config, system_program.
 */
export function getCreateSessionV4Instruction(args: {
  readonly programAddress?: AddressLike
  readonly maker: AddressLike
  readonly taker: AddressLike
  readonly session: AddressLike
  readonly config: AddressLike
  readonly nonce: bigint | number
  readonly makerSlotCount: number
  readonly takerSlotCount: number
  readonly makerSolAmount: bigint | number
  readonly takerSolAmount: bigint | number
  /** i64 seconds; 0 = no expiry. */
  readonly expiresAt: bigint | number
  readonly crankBondLamports: bigint | number
  /** Raw canonical Trade Authority sha256 commitment bytes. */
  readonly tradeCommitment: Uint8Array
}): Instruction {
  const accounts: AccountMeta[] = [
    toMeta(args.maker, AccountRole.WRITABLE_SIGNER),
    toMeta(args.taker, AccountRole.READONLY),
    toMeta(args.session, AccountRole.WRITABLE),
    toMeta(args.config, AccountRole.READONLY),
    toMeta(SystemProgram.programId, AccountRole.READONLY),
  ]
  if (args.tradeCommitment.length !== 32 || args.tradeCommitment.every((byte) => byte === 0)) {
    throw new Error('create_session_v4 requires a non-zero 32-byte Trade Authority commitment')
  }
  const data = concatBytes([
    CREATE_SESSION_V4_DISCRIMINATOR,
    encodeU64(args.nonce),
    encodeU8(args.makerSlotCount),
    encodeU8(args.takerSlotCount),
    encodeU64(args.makerSolAmount),
    encodeU64(args.takerSolAmount),
    encodeI64(args.expiresAt),
    encodeU64(args.crankBondLamports),
    args.tradeCommitment,
  ])
  return createInstruction(args.programAddress ?? DEFAULT_PROGRAM_ID, accounts, data)
}

/**
 * 2. append_slots_v4(specs: Vec<SlotSpecV4>)
 * Accounts: maker(s), session(w). Phase Building only.
 */
export function getAppendSlotsV4Instruction(args: {
  readonly programAddress?: AddressLike
  readonly maker: AddressLike
  readonly session: AddressLike
  readonly specs: readonly SlotSpecV4[]
}): Instruction {
  const accounts: AccountMeta[] = [
    toMeta(args.maker, AccountRole.READONLY_SIGNER),
    toMeta(args.session, AccountRole.WRITABLE),
  ]
  const data = concatBytes([APPEND_SLOTS_V4_DISCRIMINATOR, encodeVecSlotSpecV4(args.specs)])
  return createInstruction(args.programAddress ?? DEFAULT_PROGRAM_ID, accounts, data)
}

/**
 * 3. finalize_manifest_v4()
 * Accounts: maker(s), session(w). Phase Building only.
 */
export function getFinalizeManifestV4Instruction(args: {
  readonly programAddress?: AddressLike
  readonly maker: AddressLike
  readonly session: AddressLike
}): Instruction {
  const accounts: AccountMeta[] = [
    toMeta(args.maker, AccountRole.READONLY_SIGNER),
    toMeta(args.session, AccountRole.WRITABLE),
  ]
  return createInstruction(args.programAddress ?? DEFAULT_PROGRAM_ID, accounts, FINALIZE_MANIFEST_V4_DISCRIMINATOR)
}

/**
 * 4. deposit_asset_v4(slot_index: u8, cnft_args: Option<CnftLeafArgsV4>)
 * Accounts: depositor(ws), session(w), token_program, remaining (per-kind).
 * `cnftArgs` is required iff the slot kind is Compressed.
 */
export function getDepositAssetV4Instruction(args: {
  readonly programAddress?: AddressLike
  readonly depositor: AddressLike
  readonly session: AddressLike
  /**
   * ALWAYS the SPL Token program (the on-chain account is Anchor
   * `Program<Token>`), even for Token-2022 legs — the Token-2022 program
   * travels in remaining accounts (docs/program.md §Per-kind layouts).
   * Only override for tests.
   */
  readonly tokenProgram?: AddressLike
  readonly slotIndex: number
  readonly cnftArgs: CnftLeafArgsV4 | null
  readonly remainingAccounts: readonly AccountMeta[]
}): Instruction {
  const accounts: AccountMeta[] = [
    toMeta(args.depositor, AccountRole.WRITABLE_SIGNER),
    toMeta(args.session, AccountRole.WRITABLE),
    toMeta(args.tokenProgram ?? TOKEN_PROGRAM_ID, AccountRole.READONLY),
    ...args.remainingAccounts,
  ]
  const data = concatBytes([
    DEPOSIT_ASSET_V4_DISCRIMINATOR,
    encodeU8(args.slotIndex),
    encodeOption(args.cnftArgs, encodeCnftLeafArgsV4),
  ])
  return createInstruction(args.programAddress ?? DEFAULT_PROGRAM_ID, accounts, data)
}

/**
 * 5. start_accept_v4()
 * Accounts: taker(s), session(w). Phase Open -> TakerDepositing.
 */
export function getStartAcceptV4Instruction(args: {
  readonly programAddress?: AddressLike
  readonly taker: AddressLike
  readonly session: AddressLike
}): Instruction {
  const accounts: AccountMeta[] = [
    toMeta(args.taker, AccountRole.READONLY_SIGNER),
    toMeta(args.session, AccountRole.WRITABLE),
  ]
  return createInstruction(args.programAddress ?? DEFAULT_PROGRAM_ID, accounts, START_ACCEPT_V4_DISCRIMINATOR)
}

/**
 * 6. commit_trade_v4()
 * Accounts: taker(ws), maker(w, = session.maker), session(w), config,
 * fee_treasury(w, = config.fee_treasury), system_program.
 */
export function getCommitTradeV4Instruction(args: {
  readonly programAddress?: AddressLike
  readonly taker: AddressLike
  readonly maker: AddressLike
  readonly session: AddressLike
  readonly config: AddressLike
  readonly feeTreasury: AddressLike
  /** Manifest-ordered Core asset + collection (or Core-program sentinel) pairs. */
  readonly remainingAccounts?: readonly AccountMeta[]
}): Instruction {
  const accounts: AccountMeta[] = [
    toMeta(args.taker, AccountRole.WRITABLE_SIGNER),
    toMeta(args.maker, AccountRole.WRITABLE),
    toMeta(args.session, AccountRole.WRITABLE),
    toMeta(args.config, AccountRole.READONLY),
    toMeta(args.feeTreasury, AccountRole.WRITABLE),
    toMeta(SystemProgram.programId, AccountRole.READONLY),
  ]
  accounts.push(...(args.remainingAccounts ?? []))
  return createInstruction(args.programAddress ?? DEFAULT_PROGRAM_ID, accounts, COMMIT_TRADE_V4_DISCRIMINATOR)
}

/**
 * 7. release_asset_v4(slot_index: u8, cnft_args: Option<CnftLeafArgsV4>)
 * Accounts: payer(ws, anyone), session(w), maker(w), taker(w), token_program,
 * remaining. Phase Committed; recipient enforced on-chain.
 */
export function getReleaseAssetV4Instruction(args: {
  readonly programAddress?: AddressLike
  readonly payer: AddressLike
  readonly session: AddressLike
  readonly maker: AddressLike
  readonly taker: AddressLike
  /** ALWAYS the SPL Token program, even for Token-2022 legs (see deposit). */
  readonly tokenProgram?: AddressLike
  readonly slotIndex: number
  readonly cnftArgs: CnftLeafArgsV4 | null
  readonly remainingAccounts: readonly AccountMeta[]
}): Instruction {
  const accounts: AccountMeta[] = [
    toMeta(args.payer, AccountRole.WRITABLE_SIGNER),
    toMeta(args.session, AccountRole.WRITABLE),
    toMeta(args.maker, AccountRole.WRITABLE),
    toMeta(args.taker, AccountRole.WRITABLE),
    toMeta(args.tokenProgram ?? TOKEN_PROGRAM_ID, AccountRole.READONLY),
    ...args.remainingAccounts,
  ]
  const data = concatBytes([
    RELEASE_ASSET_V4_DISCRIMINATOR,
    encodeU8(args.slotIndex),
    encodeOption(args.cnftArgs, encodeCnftLeafArgsV4),
  ])
  return createInstruction(args.programAddress ?? DEFAULT_PROGRAM_ID, accounts, data)
}

/**
 * 8. cancel_session_v4()
 * Accounts: canceller(s), session(w). Phase -> Cancelling.
 */
export function getCancelSessionV4Instruction(args: {
  readonly programAddress?: AddressLike
  readonly canceller: AddressLike
  readonly session: AddressLike
}): Instruction {
  const accounts: AccountMeta[] = [
    toMeta(args.canceller, AccountRole.READONLY_SIGNER),
    toMeta(args.session, AccountRole.WRITABLE),
  ]
  return createInstruction(args.programAddress ?? DEFAULT_PROGRAM_ID, accounts, CANCEL_SESSION_V4_DISCRIMINATOR)
}

/**
 * 9. withdraw_asset_v4(slot_index: u8, cnft_args: Option<CnftLeafArgsV4>)
 * Accounts: payer(ws), session(w), depositor(w, unchecked — validated to be
 * the slot side's wallet), token_program, remaining.
 */
export function getWithdrawAssetV4Instruction(args: {
  readonly programAddress?: AddressLike
  readonly payer: AddressLike
  readonly session: AddressLike
  readonly depositor: AddressLike
  /** ALWAYS the SPL Token program, even for Token-2022 legs (see deposit). */
  readonly tokenProgram?: AddressLike
  readonly slotIndex: number
  readonly cnftArgs: CnftLeafArgsV4 | null
  readonly remainingAccounts: readonly AccountMeta[]
}): Instruction {
  const accounts: AccountMeta[] = [
    toMeta(args.payer, AccountRole.WRITABLE_SIGNER),
    toMeta(args.session, AccountRole.WRITABLE),
    toMeta(args.depositor, AccountRole.WRITABLE),
    toMeta(args.tokenProgram ?? TOKEN_PROGRAM_ID, AccountRole.READONLY),
    ...args.remainingAccounts,
  ]
  const data = concatBytes([
    WITHDRAW_ASSET_V4_DISCRIMINATOR,
    encodeU8(args.slotIndex),
    encodeOption(args.cnftArgs, encodeCnftLeafArgsV4),
  ])
  return createInstruction(args.programAddress ?? DEFAULT_PROGRAM_ID, accounts, data)
}

/**
 * 10. close_session_v4()
 * Accounts: payer(s), session(w), maker(w, = session.maker),
 * taker(w, = session.taker). Remaining lamports -> maker.
 */
export function getCloseSessionV4Instruction(args: {
  readonly programAddress?: AddressLike
  readonly payer: AddressLike
  readonly session: AddressLike
  readonly maker: AddressLike
  readonly taker: AddressLike
}): Instruction {
  const accounts: AccountMeta[] = [
    toMeta(args.payer, AccountRole.READONLY_SIGNER),
    toMeta(args.session, AccountRole.WRITABLE),
    toMeta(args.maker, AccountRole.WRITABLE),
    toMeta(args.taker, AccountRole.WRITABLE),
  ]
  return createInstruction(args.programAddress ?? DEFAULT_PROGRAM_ID, accounts, CLOSE_SESSION_V4_DISCRIMINATOR)
}
