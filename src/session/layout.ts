/**
 * TradeSession (escrow v4) account layout + DataView decoder.
 *
 * Byte offsets are fixed by docs/program.md §Account layout — the
 * account deliberately has no Option fields so the browser can decode it with
 * a plain DataView (Anchor coders are not constructible in the frontend; see
 * the SDK account-data helpers).
 */

import { PublicKey } from '@solana/web3.js'
import { sha256 } from '@noble/hashes/sha256'

import {
  createAccountDataView,
  matchesAccountDiscriminator,
  readBigInt64,
  readBigUInt64,
  readPublicKey,
  readUInt8,
} from '../internal/accounts.js'
import type { AssetSlotV4, SessionPhase, SlotSide, SlotStatus, TradeSessionState } from './types.js'
import { AssetKindV4, SessionPhase as SessionPhaseValues, SlotSide as SlotSideValues, SlotStatus as SlotStatusValues } from './types.js'

const textEncoder = new TextEncoder()

/** Anchor account discriminator: sha256("account:<Name>")[0..8]. */
function anchorAccountDiscriminator(name: string): Uint8Array {
  return sha256(textEncoder.encode(`account:${name}`)).slice(0, 8)
}

/**
 * sha256("account:TradeSession")[0..8] = 2b146fbcb0948c45
 * (bytes [43, 20, 111, 188, 176, 148, 140, 69]).
 */
export const TRADE_SESSION_DISCRIMINATOR: Uint8Array = anchorAccountDiscriminator('TradeSession')

// ---------------------------------------------------------------------------
// Program constants — docs/program.md §Constants
// ---------------------------------------------------------------------------

export const SESSION_SEED = 'session'
export const HARD_MAX_SLOTS_PER_SIDE = 32
export const LAUNCH_MAX_SLOTS_PER_SIDE = 8
export const MAX_SESSION_CNFT_PROOF_SIZE = 32
export const RELEASE_REIMBURSEMENT_LAMPORTS = 10_000n

// ---------------------------------------------------------------------------
// Fixed offsets — docs/program.md §Account layout
// ---------------------------------------------------------------------------

export const SESSION_OFFSETS = {
  discriminator: 0,
  maker: 8,
  taker: 40,
  nonce: 72,
  phase: 80,
  makerSlotCount: 81,
  takerSlotCount: 82,
  bump: 83,
  makerSolAmount: 84,
  takerSolAmount: 92,
  expiresAt: 100,
  crankBondLamports: 108,
  makerFeeEscrowed: 116,
  filledSlotCount: 124,
  tradeCommitment: 125,
  /** @deprecated Historical name for the same frozen offset. */
  reserved: 125,
  /** borsh Vec<AssetSlotV4>: u32 length at 157, elements from 161. */
  slotsVecLen: 157,
  slots: 161,
} as const

/** Header bytes between the discriminator and the slots vec (8..157). */
export const SESSION_HEADER_LEN = 149

/** Encoded AssetSlotV4 length: side(1) + kind(1) + status(1) + mint(32) + tree(32) + proof_size(1). */
export const SLOT_LEN = 68

/** AssetSlotV4 intra-slot offsets. */
export const SLOT_OFFSETS = {
  side: 0,
  kind: 1,
  status: 2,
  mintOrAssetId: 3,
  tree: 35,
  proofSize: 67,
} as const

/**
 * Account space at init: 8 + 149 + 4 + 68 * total_slots.
 * spaceFor(16) = 1,249 (8v8); spaceFor(64) = 4,513 (32v32).
 */
export function spaceFor(totalSlots: number): number {
  if (!Number.isInteger(totalSlots) || totalSlots < 0) {
    throw new Error(`spaceFor: totalSlots must be a non-negative integer, got ${totalSlots}`)
  }
  return 8 + SESSION_HEADER_LEN + 4 + SLOT_LEN * totalSlots
}

/** Size-independent discriminator gate for getProgramAccounts scans. */
export function isTradeSessionAccount(data: Uint8Array): boolean {
  return matchesAccountDiscriminator(data, TRADE_SESSION_DISCRIMINATOR)
}

function decodePhase(value: number): SessionPhase {
  if (value < SessionPhaseValues.Building || value > SessionPhaseValues.Closed) {
    throw new Error(`TradeSession: invalid phase ${value}`)
  }
  return value as SessionPhase
}

function decodeSlotStatus(value: number): SlotStatus {
  if (value < SlotStatusValues.Empty || value > SlotStatusValues.Withdrawn) {
    throw new Error(`TradeSession: invalid slot status ${value}`)
  }
  return value as SlotStatus
}

function decodeSlotSide(value: number): SlotSide {
  if (value !== SlotSideValues.Maker && value !== SlotSideValues.Taker) {
    throw new Error(`TradeSession: invalid slot side ${value}`)
  }
  return value as SlotSide
}

function decodeAssetKind(value: number): AssetKindV4 {
  if (value < AssetKindV4.Spl || value > AssetKindV4.Core) {
    throw new Error(`TradeSession: invalid asset kind ${value}`)
  }
  return value as AssetKindV4
}

/**
 * Decode a raw TradeSession account with a DataView (never Anchor coders).
 * Throws on discriminator mismatch or malformed vectors — fail closed rather
 * than building plans from inconsistent state.
 */
export function decodeTradeSession(data: Uint8Array): TradeSessionState {
  const { bytes, view } = createAccountDataView(data)
  if (!matchesAccountDiscriminator(bytes, TRADE_SESSION_DISCRIMINATOR)) {
    throw new Error('TradeSession: account discriminator mismatch')
  }
  if (bytes.byteLength < SESSION_OFFSETS.slots) {
    throw new Error(`TradeSession: account too small (${bytes.byteLength} bytes)`)
  }

  const maker = readPublicKey(bytes, SESSION_OFFSETS.maker)
  const taker = readPublicKey(bytes, SESSION_OFFSETS.taker)
  const nonce = readBigUInt64(view, SESSION_OFFSETS.nonce)
  const phase = decodePhase(readUInt8(view, SESSION_OFFSETS.phase))
  const makerSlotCount = readUInt8(view, SESSION_OFFSETS.makerSlotCount)
  const takerSlotCount = readUInt8(view, SESSION_OFFSETS.takerSlotCount)
  const bump = readUInt8(view, SESSION_OFFSETS.bump)
  const makerSolAmount = readBigUInt64(view, SESSION_OFFSETS.makerSolAmount)
  const takerSolAmount = readBigUInt64(view, SESSION_OFFSETS.takerSolAmount)
  const expiresAt = readBigInt64(view, SESSION_OFFSETS.expiresAt)
  const crankBondLamports = readBigUInt64(view, SESSION_OFFSETS.crankBondLamports)
  const makerFeeEscrowed = readBigUInt64(view, SESSION_OFFSETS.makerFeeEscrowed)
  const filledSlotCount = readUInt8(view, SESSION_OFFSETS.filledSlotCount)
  const tradeCommitment = bytes.slice(SESSION_OFFSETS.tradeCommitment, SESSION_OFFSETS.tradeCommitment + 32)

  const slotsLen = view.getUint32(SESSION_OFFSETS.slotsVecLen, true)
  const declaredTotal = makerSlotCount + takerSlotCount
  if (slotsLen > HARD_MAX_SLOTS_PER_SIDE * 2 || slotsLen > declaredTotal) {
    throw new Error(`TradeSession: malformed slots vector length ${slotsLen} (declared ${declaredTotal})`)
  }
  const slotsEnd = SESSION_OFFSETS.slots + slotsLen * SLOT_LEN
  if (bytes.byteLength < slotsEnd) {
    throw new Error('TradeSession: slots vector overruns account data')
  }

  const slots: AssetSlotV4[] = []
  for (let index = 0; index < slotsLen; index += 1) {
    const base = SESSION_OFFSETS.slots + index * SLOT_LEN
    slots.push({
      side: decodeSlotSide(readUInt8(view, base + SLOT_OFFSETS.side)),
      kind: decodeAssetKind(readUInt8(view, base + SLOT_OFFSETS.kind)),
      status: decodeSlotStatus(readUInt8(view, base + SLOT_OFFSETS.status)),
      mintOrAssetId: readPublicKey(bytes, base + SLOT_OFFSETS.mintOrAssetId),
      tree: readPublicKey(bytes, base + SLOT_OFFSETS.tree),
      proofSize: readUInt8(view, base + SLOT_OFFSETS.proofSize),
    })
  }

  return {
    maker,
    taker,
    nonce,
    phase,
    makerSlotCount,
    takerSlotCount,
    bump,
    makerSolAmount,
    takerSolAmount,
    expiresAt,
    crankBondLamports,
    makerFeeEscrowed,
    filledSlotCount,
    tradeCommitment,
    slots,
  }
}

/** True when a compressed slot's `tree` is the all-zero placeholder. */
export function isZeroTree(tree: PublicKey): boolean {
  return tree.equals(PublicKey.default)
}
