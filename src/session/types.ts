/**
 * TradeSession (escrow v4) shared types — platform-agnostic.
 *
 * Single source of truth for the ABI: docs/program.md. Keep every
 * shape here in lockstep with that document; the Rust program and the worker
 * decoder implement the same bytes.
 *
 * NOTE: no TypeScript `enum`s in this module (const objects only) and no
 * imports of `../escrow/legacy_escrow` / `../escrow/rails`. The web app compiles
 * these sources under `erasableSyntaxOnly`, which rejects enum declarations,
 * so the session module must stay enum-free end to end.
 */

import type { PublicKey } from '@solana/web3.js'
import type { Instruction } from '@solana/kit'

/** SessionPhase (u8) — docs/program.md §Enums. */
export const SessionPhase = {
  Building: 0,
  MakerDepositing: 1,
  Open: 2,
  TakerDepositing: 3,
  Committed: 4,
  Cancelling: 5,
  Closed: 6,
} as const
export type SessionPhase = (typeof SessionPhase)[keyof typeof SessionPhase]

/** SlotStatus (u8) — docs/program.md §Enums. */
export const SlotStatus = {
  Empty: 0,
  Deposited: 1,
  Released: 2,
  Withdrawn: 3,
} as const
export type SlotStatus = (typeof SlotStatus)[keyof typeof SlotStatus]

/** AssetSlotV4.side (u8): 0 = maker leg, 1 = taker leg. */
export const SlotSide = {
  Maker: 0,
  Taker: 1,
} as const
export type SlotSide = (typeof SlotSide)[keyof typeof SlotSide]

/**
 * AssetKind (u8) — numerically identical to the existing escrow `AssetKind`
 * enum in `the historical escrow ABI` (Spl=0, Programmable=1,
 * Compressed=2, Token2022=3, Core=4). Re-declared as a const object because
 * the session module must be importable under `erasableSyntaxOnly`.
 */
export const AssetKindV4 = {
  Spl: 0,
  Programmable: 1,
  Compressed: 2,
  Token2022: 3,
  Core: 4,
} as const
export type AssetKindV4 = (typeof AssetKindV4)[keyof typeof AssetKindV4]

/** Decoded `AssetSlotV4` (68 bytes on-chain; see layout.ts). */
export type AssetSlotV4 = {
  readonly side: SlotSide
  readonly kind: AssetKindV4
  readonly status: SlotStatus
  readonly mintOrAssetId: PublicKey
  /** Merkle tree for compressed legs, exact collection for Core, zero otherwise. */
  readonly tree: PublicKey
  readonly proofSize: number
}

/** Decoded `TradeSession` account (see layout.ts for byte offsets). */
export type TradeSessionState = {
  readonly maker: PublicKey
  readonly taker: PublicKey
  readonly nonce: bigint
  readonly phase: SessionPhase
  readonly makerSlotCount: number
  readonly takerSlotCount: number
  readonly bump: number
  readonly makerSolAmount: bigint
  readonly takerSolAmount: bigint
  /** 0n = no expiry. */
  readonly expiresAt: bigint
  /** Remaining crank bond lamports. */
  readonly crankBondLamports: bigint
  readonly makerFeeEscrowed: bigint
  readonly filledSlotCount: number
  /** Immutable canonical Trade Authority commitment (raw sha256 bytes). */
  readonly tradeCommitment: Uint8Array
  readonly slots: readonly AssetSlotV4[]
}

/** Borsh arg struct `SlotSpecV4` (67 bytes encoded). */
export type SlotSpecV4 = {
  readonly side: SlotSide
  readonly kind: AssetKindV4
  readonly mintOrAssetId: PublicKey
  /** cNFT tree or Core collection; zero for uncollected Core/other kinds. */
  readonly tree: PublicKey
  readonly proofSize: number
}

/**
 * Borsh arg struct `CnftLeafArgsV4` (108 bytes encoded) — field-identical to
 * the v3 `CnftLeafArgs` in `the historical escrow ABI`.
 */
export type CnftLeafArgsV4 = {
  readonly root: Uint8Array
  readonly dataHash: Uint8Array
  readonly creatorHash: Uint8Array
  readonly nonce: bigint | number
  readonly index: number
}

/**
 * Fresh cNFT proof material injected by the caller immediately before a
 * compressed-leg transaction is signed (DAS getAsset/getAssetProof).
 */
export type SessionCnftProofInput = CnftLeafArgsV4 & {
  readonly proof: readonly PublicKey[]
}

export type SessionSignerRole = 'maker' | 'taker' | 'crank'

export type SessionPlanPhase =
  | 'create'
  | 'makerDeposit'
  | 'startAccept'
  | 'takerDeposit'
  | 'commit'
  | 'release'
  | 'cancel'
  | 'withdraw'
  | 'close'

/**
 * An associated token account the transaction sender must ensure exists
 * (idempotent create prepended in the same transaction) before the group's
 * instructions run. The program validates ATAs but never creates them.
 */
export type SessionAtaCreation = {
  readonly mint: PublicKey
  readonly owner: PublicKey
  readonly ata: PublicKey
  readonly tokenProgram: PublicKey
}

/** Fresh-proof requirement attached to compressed-leg groups. */
export type SessionCnftProofRequest = {
  readonly slotIndex: number
  readonly assetId: PublicKey
  readonly tree: PublicKey
  /** Slot-declared proof size; the submitted proof must be sliced to it. */
  readonly proofSize: number
  /** Current expected leaf owner (depositor wallet pre-custody, session PDA after). */
  readonly expectedLeafOwner: PublicKey
}

/**
 * Plain-language explanation of what ONE signature/transaction does, shown to
 * the user before and during signing. Populated by the planner for every
 * group it emits (a group is the unit of one signature/transaction).
 */
export type SessionUserFacing = {
  readonly title: string
  readonly detail: string
}

/** Progress bookkeeping for create-phase groups (used by resume logic). */
export type SessionCreateStage = {
  readonly includesCreate: boolean
  readonly includesFinalize: boolean
  /** Highest manifest slot index appended by this group, or -1 when none. */
  readonly appendedThroughSlotIndex: number
}

/**
 * One transaction worth of work. Pure data — no RPC. For compressed legs
 * `instructions` is empty and `buildWithFreshProof` must be invoked with a
 * fresh DAS proof to materialize the final instruction list right before
 * signing.
 */
export type SessionTxGroup = {
  readonly label: string
  readonly phase: SessionPlanPhase
  readonly signerRole: SessionSignerRole
  /** Human-readable copy explaining this signature to the user. */
  readonly userFacing: SessionUserFacing
  /** Manifest slot indexes this group settles (empty for lifecycle-only groups). */
  readonly slotIndexes: readonly number[]
  readonly instructions: readonly Instruction[]
  readonly ataCreations: readonly SessionAtaCreation[]
  readonly needsFreshCnftProof?: SessionCnftProofRequest
  readonly buildWithFreshProof?: (proof: SessionCnftProofInput) => readonly Instruction[]
  readonly createStage?: SessionCreateStage
}

/** Ordered transaction-group plan for one TradeSession. */
export type SessionTxPlan = {
  readonly programId: PublicKey
  readonly sessionPda: PublicKey
  readonly bump: number
  readonly maker: PublicKey
  readonly taker: PublicKey
  readonly nonce: bigint
  readonly makerSlotCount: number
  readonly takerSlotCount: number
  readonly groups: readonly SessionTxGroup[]
}
