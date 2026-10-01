/**
 * TradeSession (escrow v4) PDA derivation.
 *
 * PDA seeds: ["session", maker, taker, nonce_le_u64] — docs/program.md.
 */

import { PublicKey } from '@solana/web3.js'

import { writeBigUInt64LE } from '../internal/buffer-utils.js'
import { SESSION_SEED } from './layout.js'

const textEncoder = new TextEncoder()
const SESSION_SEED_BYTES = textEncoder.encode(SESSION_SEED)

function encodeNonceLe(nonce: bigint | number): Uint8Array {
  const bytes = new Uint8Array(8)
  writeBigUInt64LE(bytes, nonce)
  return bytes
}

/** Derive the TradeSession PDA for (maker, taker, nonce). */
export function deriveSessionPda(
  programId: PublicKey,
  maker: PublicKey,
  taker: PublicKey,
  nonce: bigint | number,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SESSION_SEED_BYTES, maker.toBytes(), taker.toBytes(), encodeNonceLe(nonce)],
    programId,
  )
}
