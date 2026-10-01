import { PublicKey, type Connection } from '@solana/web3.js'
import { sha256 } from '@noble/hashes/sha256'
import { deriveConfigPda } from './internal/pda.js'
export const PRISMSWAP_MAINNET_PROGRAM_ID = '6RqZ2jo91veL5WdfTxTGqwoeAxR4KU747Sq6a5rv9r2G'
export const PRISMSWAP_DEVNET_PROGRAM_ID = 'AyVtdNjHeyjz1Ko8yyMWCddgtEk6o3xS32dCWmXKDFyH'
export const CLUSTER_GENESIS_HASHES = {
  'mainnet-beta': '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
  devnet: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
  testnet: '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY',
} as const
export type PrismSwapConfig = { readonly address: PublicKey; readonly feeTreasury: PublicKey; readonly nftFeeLamports: bigint; readonly solFeeBps: number; readonly fingerprint: string }
export function byteFingerprint(bytes: Uint8Array): string { return Array.from(sha256(bytes), b => b.toString(16).padStart(2,'0')).join('') }
export async function readPrismSwapConfig(connection: Connection, programId: PublicKey): Promise<PrismSwapConfig> {
  const [address] = deriveConfigPda(programId)
  const info = await connection.getAccountInfo(address, 'confirmed')
  if (!info || !info.owner.equals(programId)) throw new Error('CONFIG_NOT_FOUND_OR_WRONG_OWNER')
  const bytes = Uint8Array.from(info.data)
  const discriminator = [155,12,170,224,30,250,204,130]
  // Anchor allocations on the reference deployments include five zero padding bytes.
  if (![135,140].includes(bytes.length) || bytes.slice(135).some(b => b !== 0) || discriminator.some((b,i) => bytes[i] !== b)) throw new Error('UNSUPPORTED_CONFIG_LAYOUT')
  const view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength)
  const solFeeBps = view.getUint16(132,true)
  if (solFeeBps > 10000) throw new Error('INVALID_FEE_CONFIG')
  return { address, feeTreasury: new PublicKey(bytes.slice(92,124)), nftFeeLamports: view.getBigUint64(124,true), solFeeBps, fingerprint: byteFingerprint(bytes) }
}
