import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildSessionFeeBreakdown,
  computeSideFeeLamports,
  RELEASE_REIMBURSEMENT_LAMPORTS,
  spaceFor,
} from '../src/session/index.js'

const CONFIG = { nftFeeLamports: 1_000_000n, solFeeBps: 100 }

test('computeSideFeeLamports: known config, 8 NFTs + 2 SOL', () => {
  // 8 * 1_000_000 + floor(2_000_000_000 * 100 / 10_000) = 8_000_000 + 20_000_000
  assert.equal(computeSideFeeLamports(CONFIG, 8, 2_000_000_000n), 28_000_000n)
})

test('computeSideFeeLamports: floor rounding on odd lamports x odd bps', () => {
  // 999_999_999 * 33 = 32_999_999_967 -> floor(/10_000) = 3_299_999 (not 3_300_000)
  assert.equal(computeSideFeeLamports({ nftFeeLamports: 0n, solFeeBps: 33 }, 0, 999_999_999n), 3_299_999n)
  // 1_234_567 * 7 = 8_641_969 -> floor(/10_000) = 864
  assert.equal(computeSideFeeLamports({ nftFeeLamports: 0n, solFeeBps: 7 }, 0, 1_234_567n), 864n)
})

test('computeSideFeeLamports: zero-NFT and zero-SOL sides', () => {
  // SOL-only side: bps component alone.
  assert.equal(computeSideFeeLamports({ nftFeeLamports: 1_000_000n, solFeeBps: 250 }, 0, 5_000_000_000n), 125_000_000n)
  // NFT-only side: flat component alone.
  assert.equal(computeSideFeeLamports(CONFIG, 3, 0n), 3_000_000n)
  // Empty side: no fee.
  assert.equal(computeSideFeeLamports(CONFIG, 0, 0n), 0n)
})

test('computeSideFeeLamports rejects invalid inputs', () => {
  assert.throws(() => computeSideFeeLamports(CONFIG, -1, 0n))
  assert.throws(() => computeSideFeeLamports(CONFIG, 1.5, 0n))
  assert.throws(() => computeSideFeeLamports(CONFIG, 0, -1n))
  assert.throws(() => computeSideFeeLamports({ nftFeeLamports: 0n, solFeeBps: 10_001 }, 0, 0n))
})

test('buildSessionFeeBreakdown: sides, charge points, bond and rent defaults', () => {
  const breakdown = buildSessionFeeBreakdown({
    config: CONFIG,
    makerNftCount: 8,
    makerSolLamports: 0n,
    takerNftCount: 0,
    takerSolLamports: 2_000_000_000n,
  })

  assert.equal(breakdown.maker.role, 'maker')
  assert.equal(breakdown.maker.nftCount, 8)
  assert.equal(breakdown.maker.nftComponent, 8_000_000n)
  assert.equal(breakdown.maker.solComponent, 0n)
  assert.equal(breakdown.maker.totalFee, 8_000_000n)
  assert.equal(breakdown.maker.chargedAt, 'create_escrowed')
  assert.equal(breakdown.maker.refundedOnCancel, true)

  assert.equal(breakdown.taker.role, 'taker')
  assert.equal(breakdown.taker.nftCount, 0)
  assert.equal(breakdown.taker.nftComponent, 0n)
  assert.equal(breakdown.taker.solComponent, 20_000_000n)
  assert.equal(breakdown.taker.totalFee, 20_000_000n)
  assert.equal(breakdown.taker.chargedAt, 'commit')
  assert.equal(breakdown.taker.refundedOnCancel, false)

  // Side totals match the exact-mirror helper.
  assert.equal(breakdown.maker.totalFee, computeSideFeeLamports(CONFIG, 8, 0n))
  assert.equal(breakdown.taker.totalFee, computeSideFeeLamports(CONFIG, 0, 2_000_000_000n))

  // Default bond: program minimum RELEASE_REIMBURSEMENT_LAMPORTS * totalSlots.
  assert.equal(breakdown.crankBond.lamports, RELEASE_REIMBURSEMENT_LAMPORTS * 8n)
  assert.equal(breakdown.crankBond.refundPolicy, 'remainder_to_maker_at_close')

  // Rent line: spaceFor basis, lamports unknown until the caller supplies them.
  assert.equal(breakdown.rentDeposit.spaceBytes, spaceFor(8))
  assert.equal(breakdown.rentDeposit.lamports, null)
  assert.equal(breakdown.rentDeposit.refundPolicy, 'to_maker_at_close')

  assert.equal(breakdown.totalProtocolFeeIfCommitted, 28_000_000n)
})

test('buildSessionFeeBreakdown: explicit bond and resolved rent pass through', () => {
  const breakdown = buildSessionFeeBreakdown({
    config: CONFIG,
    makerNftCount: 1,
    makerSolLamports: 0,
    takerNftCount: 1,
    takerSolLamports: 0,
    crankBondLamports: 123_456n,
    rentLamports: 9_876_543n,
  })
  assert.equal(breakdown.crankBond.lamports, 123_456n)
  assert.equal(breakdown.rentDeposit.lamports, 9_876_543n)
  assert.equal(breakdown.rentDeposit.spaceBytes, spaceFor(2))
  assert.equal(breakdown.totalProtocolFeeIfCommitted, 2_000_000n)
})
