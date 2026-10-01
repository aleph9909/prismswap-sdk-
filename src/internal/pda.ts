import { PublicKey } from '@solana/web3.js'
export function deriveConfigPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([new TextEncoder().encode('config')], programId)
}
