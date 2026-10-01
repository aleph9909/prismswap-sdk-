/**
 * TradeSession (escrow v4) fee math — platform-agnostic, pure functions.
 *
 * Exact TypeScript mirror of the on-chain formula in
 * `the on-chain fee implementation` (`compute_side_fee` + `bps`):
 *
 *   side_fee = nft_count * config.nft_fee_lamports
 *            + floor(sol_amount * config.sol_fee_bps / 10_000)
 *
 * Charging model (`the on-chain session implementation`):
 * - The MAKER's side fee is escrowed into the session at `create_session_v4`
 *   and refunded to the maker if the session is cancelled or closed
 *   uncommitted; it moves to the treasury only at `commit_trade_v4`.
 * - The TAKER's side fee is charged directly taker -> treasury at
 *   `commit_trade_v4` (never charged before commit).
 * - The maker also posts `crank_bond_lamports` at create (remainder refunded
 *   to the maker at close) and pays the session account rent (refunded to the
 *   maker when the account closes).
 *
 * All arithmetic is bigint (integer floor division), matching the u64 math on
 * chain. No TypeScript `enum`s, no browser/React imports (see types.ts).
 */

import { RELEASE_REIMBURSEMENT_LAMPORTS, spaceFor } from './layout.js'

/** Program bound on every bps field (utils.rs `validate_fee_config`). */
export const MAX_FEE_BPS = 10_000

/** The two Config fields the v4 side-fee formula reads. */
export type SessionFeeConfig = {
  readonly nftFeeLamports: bigint
  readonly solFeeBps: number
}

function validateFeeConfig(config: SessionFeeConfig): void {
  if (config.nftFeeLamports < 0n) {
    throw new Error('SessionFeeConfig.nftFeeLamports must be non-negative')
  }
  if (!Number.isInteger(config.solFeeBps) || config.solFeeBps < 0 || config.solFeeBps > MAX_FEE_BPS) {
    throw new Error(`SessionFeeConfig.solFeeBps must be an integer in 0..=${MAX_FEE_BPS}`)
  }
}

function validateNftCount(nftCount: number): void {
  if (!Number.isInteger(nftCount) || nftCount < 0) {
    throw new Error('nftCount must be a non-negative integer')
  }
}

/** floor(amount * bps / 10_000) — mirror of utils.rs `bps`. */
function bpsComponent(amount: bigint, bps: number): bigint {
  return (amount * BigInt(bps)) / 10_000n
}

/**
 * One side's protocol fee in lamports — exact mirror of the Rust
 * `compute_side_fee` (integer floor math, bigint throughout).
 */
export function computeSideFeeLamports(
  config: SessionFeeConfig,
  nftCount: number,
  solLamports: bigint,
): bigint {
  validateFeeConfig(config)
  validateNftCount(nftCount)
  if (solLamports < 0n) {
    throw new Error('solLamports must be non-negative')
  }
  return BigInt(nftCount) * config.nftFeeLamports + bpsComponent(solLamports, config.solFeeBps)
}

/** When a side's fee leaves that side's wallet. */
export type SessionFeeChargedAt = 'create_escrowed' | 'commit'

export type SessionSideFeeBreakdown = {
  readonly role: 'maker' | 'taker'
  readonly nftCount: number
  /** SOL this side contributes (fee basis for the bps component). */
  readonly solLamports: bigint
  /** nftCount * config.nftFeeLamports. */
  readonly nftComponent: bigint
  /** floor(solLamports * config.solFeeBps / 10_000). */
  readonly solComponent: bigint
  /** nftComponent + solComponent. */
  readonly totalFee: bigint
  readonly chargedAt: SessionFeeChargedAt
  /** True when the fee comes back if the trade never commits. */
  readonly refundedOnCancel: boolean
}

export type SessionFeeBreakdown = {
  /** Echo of the config inputs, for rendering the formula. */
  readonly config: SessionFeeConfig
  readonly maker: SessionSideFeeBreakdown
  readonly taker: SessionSideFeeBreakdown
  /** Refundable crank bond the maker posts at create. */
  readonly crankBond: {
    readonly lamports: bigint
    readonly refundPolicy: 'remainder_to_maker_at_close'
  }
  /** Session account rent the maker fronts at create. */
  readonly rentDeposit: {
    /** Session account size in bytes (spaceFor(totalSlots)) — rent basis. */
    readonly spaceBytes: number
    /**
     * Rent-exempt lamports for spaceBytes; null when the caller has not
     * resolved it yet (rent exemption needs an RPC call).
     */
    readonly lamports: bigint | null
    readonly refundPolicy: 'to_maker_at_close'
  }
  /** maker.totalFee + taker.totalFee — kept by the treasury only on commit. */
  readonly totalProtocolFeeIfCommitted: bigint
}

export type BuildSessionFeeBreakdownInput = {
  readonly config: SessionFeeConfig
  readonly makerNftCount: number
  readonly takerNftCount: number
  readonly makerSolLamports: bigint | number
  readonly takerSolLamports: bigint | number
  /**
   * Bond posted at create. Defaults to the program minimum
   * RELEASE_REIMBURSEMENT_LAMPORTS * (makerNftCount + takerNftCount),
   * matching the planner default.
   */
  readonly crankBondLamports?: bigint | number
  /**
   * Rent-exempt lamports for the session account
   * (getMinimumBalanceForRentExemption(spaceFor(totalSlots))). Optional —
   * pass null/omit when not resolved yet.
   */
  readonly rentLamports?: bigint | null
}

function sideBreakdown(
  role: 'maker' | 'taker',
  config: SessionFeeConfig,
  nftCount: number,
  solLamports: bigint,
): SessionSideFeeBreakdown {
  validateNftCount(nftCount)
  if (solLamports < 0n) {
    throw new Error(`${role} solLamports must be non-negative`)
  }
  const nftComponent = BigInt(nftCount) * config.nftFeeLamports
  const solComponent = bpsComponent(solLamports, config.solFeeBps)
  return {
    role,
    nftCount,
    solLamports,
    nftComponent,
    solComponent,
    totalFee: nftComponent + solComponent,
    // Maker fee is escrowed into the session at create and refunded when the
    // session cancels/closes uncommitted; taker fee only ever moves at commit.
    chargedAt: role === 'maker' ? 'create_escrowed' : 'commit',
    refundedOnCancel: role === 'maker',
  }
}

/**
 * Full user-facing fee breakdown for one session. Protocol fees are kept by
 * the treasury only when the trade commits; the crank bond remainder and the
 * account rent always return to the maker at close.
 */
export function buildSessionFeeBreakdown(input: BuildSessionFeeBreakdownInput): SessionFeeBreakdown {
  validateFeeConfig(input.config)
  const maker = sideBreakdown('maker', input.config, input.makerNftCount, BigInt(input.makerSolLamports))
  const taker = sideBreakdown('taker', input.config, input.takerNftCount, BigInt(input.takerSolLamports))
  const totalSlots = input.makerNftCount + input.takerNftCount
  const crankBondLamports = input.crankBondLamports !== undefined
    ? BigInt(input.crankBondLamports)
    : RELEASE_REIMBURSEMENT_LAMPORTS * BigInt(totalSlots)
  if (crankBondLamports < 0n) {
    throw new Error('crankBondLamports must be non-negative')
  }
  return {
    config: input.config,
    maker,
    taker,
    crankBond: {
      lamports: crankBondLamports,
      refundPolicy: 'remainder_to_maker_at_close',
    },
    rentDeposit: {
      spaceBytes: spaceFor(totalSlots),
      lamports: input.rentLamports ?? null,
      refundPolicy: 'to_maker_at_close',
    },
    totalProtocolFeeIfCommitted: maker.totalFee + taker.totalFee,
  }
}
