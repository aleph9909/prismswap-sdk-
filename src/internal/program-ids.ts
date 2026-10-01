/**
 * Program IDs for the escrow_v2 client (platform-agnostic).
 *
 * Port of the reference public program identities without import.meta/env reads and
 * without the @metaplex-foundation/mpl-token-metadata dependency. All ids are
 * hardcoded to their canonical mainnet values; callers that need a different
 * program id (e.g. a devnet deployment) pass it explicitly via
 * `resolveProgramId` or the per-instruction `programAddress` argument.
 */
import { PublicKey } from '@solana/web3.js'

export { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from './token.js'

/** Canonical mainnet PrismSwap escrow program id. */
export const CANONICAL_MAINNET_PROGRAM_ID = '6RqZ2jo91veL5WdfTxTGqwoeAxR4KU747Sq6a5rv9r2G'

export const TOKEN_METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s')
export const TOKEN_AUTH_RULES_PROGRAM_ID = new PublicKey('auth9SigNpDKz4sJJ1DfCTuZrZNSAgh9sFD3rboVmgg')
export const CORE_PROGRAM_ID = new PublicKey('CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d')
export const SPL_NOOP_PROGRAM_ID = new PublicKey('noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV')
export const BUBBLEGUM_PROGRAM_ID = new PublicKey('BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY')
export const SPL_ACCOUNT_COMPRESSION_PROGRAM_ID = new PublicKey('cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK')
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')

/** PublicKey form of the canonical mainnet program id. */
export const PROGRAM_ID = new PublicKey(CANONICAL_MAINNET_PROGRAM_ID)

/**
 * Resolve the escrow program id. Validates that `override` (when provided) is
 * a well-formed base58 32-byte public key; falls back to the canonical
 * mainnet id when omitted.
 */
export function resolveProgramId(override?: string): PublicKey {
  if (override === undefined || override === null) {
    return PROGRAM_ID
  }
  const trimmed = override.trim()
  if (trimmed.length === 0) {
    return PROGRAM_ID
  }
  try {
    return new PublicKey(trimmed)
  } catch {
    throw new Error(`Invalid program id override: ${override}. Expected a base58-encoded public key.`)
  }
}
