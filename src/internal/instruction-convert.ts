/**
 * Convert kit-style instructions (as returned by the legacy_escrow builders)
 * into @solana/web3.js TransactionInstruction objects.
 *
 * Role mapping matches the web app's inline conversions (browser instruction conversion): AccountRole.WRITABLE_SIGNER(3) => signer+writable,
 * READONLY_SIGNER(2) => signer, WRITABLE(1) => writable, READONLY(0) =>
 * neither.
 */
import { Buffer } from 'buffer'
import { PublicKey, TransactionInstruction } from '@solana/web3.js'
import { AccountRole, type ReadonlyUint8Array } from '@solana/kit'

/**
 * Structural shape of the kit instructions produced by the legacy_escrow
 * builders: { programAddress, accounts: [{ address, role }], data }.
 * `data` accepts kit's ReadonlyUint8Array so kit `Instruction` values are
 * assignable without casts.
 */
export type KitInstructionShape = {
  readonly programAddress: string
  readonly accounts?: readonly {
    readonly address: string
    readonly role: AccountRole
  }[]
  readonly data?: Uint8Array | ReadonlyUint8Array
}

export function toTransactionInstruction(ix: KitInstructionShape): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(ix.programAddress),
    keys: (ix.accounts ?? []).map((account) => ({
      pubkey: new PublicKey(account.address),
      isSigner: account.role === AccountRole.READONLY_SIGNER || account.role === AccountRole.WRITABLE_SIGNER,
      isWritable: account.role === AccountRole.WRITABLE || account.role === AccountRole.WRITABLE_SIGNER,
    })),
    data: Buffer.from((ix.data ?? new Uint8Array(0)) as Uint8Array),
  })
}
