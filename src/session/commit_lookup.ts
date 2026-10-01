import {
  AddressLookupTableProgram,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js'
import type { AddressLookupTableAccount, Connection, TransactionInstruction } from '@solana/web3.js'

export const SESSION_PACKET_LIMIT = 1232
const MAX_COMMIT_LOOKUP_KEYS = 40 // 16 Core pairs + fixed non-signing commit accounts.
const EXTEND_CHUNK = 20

type CompileArgs = {
  readonly payer: PublicKey
  readonly recentBlockhash: string
  readonly instructions: readonly TransactionInstruction[]
  readonly lookupTables: readonly AddressLookupTableAccount[]
}

/** Actual wire serialization, not an account-count estimate. Never sign oversize packets. */
export function compileSessionTransaction(args: CompileArgs): VersionedTransaction {
  const message = new TransactionMessage({payerKey: args.payer, recentBlockhash: args.recentBlockhash, instructions: [...args.instructions]})
  const transaction = new VersionedTransaction(args.lookupTables.length
    ? message.compileToV0Message([...args.lookupTables]) : message.compileToLegacyMessage())
  if (transaction.serialize().length > SESSION_PACKET_LIMIT) throw new RangeError('SESSION_TRANSACTION_PACKET_LIMIT')
  return transaction
}

/** Immutable ordered instruction metas remain unchanged; only message keys are compressed. */
export function sessionCommitLookupAddresses(instructions: readonly TransactionInstruction[], payer: PublicKey): PublicKey[] {
  const excluded = new Set([payer.toBase58(), ...instructions.map(ix => ix.programId.toBase58()),
    ...instructions.flatMap(ix => ix.keys.filter(k => k.isSigner).map(k => k.pubkey.toBase58()))])
  return [...new Map(instructions.flatMap(ix => ix.keys).filter(k => !excluded.has(k.pubkey.toBase58()))
    .map(k => [k.pubkey.toBase58(), k.pubkey] as const)).values()]
}

export type PrepareSessionCommitLookupArgs = {
  readonly connection: Pick<Connection, 'getSlot' | 'getAddressLookupTable'>
  readonly payer: PublicKey
  readonly instructions: readonly TransactionInstruction[]
  readonly lookupTables?: readonly AddressLookupTableAccount[]
  /** Untrusted retry hint. Always reload and check chain contents before use. */
  readonly lookupTableAddress?: PublicKey
  /** Caller signs with the connected wallet and CONFIRMS each setup transaction. */
  readonly sendSetup: (instructions: TransactionInstruction[], label: string) => Promise<string>
  readonly onLookupTableCreated?: (address: PublicKey) => void
  /** Shared readiness budget including wallet time; defaults to 90s/500ms. Zero probes once. */
  readonly readiness?: {readonly timeoutMs?: number; readonly pollIntervalMs?: number}
}

/**
 * Prepare before taker funding, or before a resumed commit. The wallet pays for
 * and controls its table; no server signer, escrow mutation, or safety attestation.
 * Existing ALT entries cannot be rewritten. Authority may append/deactivate/close
 * using Solana's standard lifecycle; stale/inactive hints never authorize commit.
 * Freeze/custody are still read by the program in the eventual commit transaction.
 */
export async function prepareSessionCommitLookupTable(args: PrepareSessionCommitLookupArgs): Promise<AddressLookupTableAccount[]> {
  const timeoutMs = args.readiness?.timeoutMs ?? 90_000
  const pollIntervalMs = args.readiness?.pollIntervalMs ?? 500
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0 || timeoutMs > 90_000 ||
      !Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0 || pollIntervalMs > 90_000) {
    throw new Error('SESSION_COMMIT_LOOKUP_INVALID_READINESS')
  }
  const configured = [...(args.lookupTables ?? [])]
  const fits = (tables: readonly AddressLookupTableAccount[]) => {
    try {
      compileSessionTransaction({...args, lookupTables: tables, recentBlockhash: PublicKey.default.toBase58()})
      return true
    } catch (error) {
      if (error instanceof RangeError) return false
      throw error
    }
  }
  // One wall-clock budget for preliminary and finalized reads. Wallet interaction
  // consumes this budget too, but sends are awaited, never raced/aborted/retried.
  const deadline = Date.now() + timeoutMs
  const checkDeadline = () => {
    // Zero permits one immediate probe, but still bounds stalled RPCs.
    if (timeoutMs > 0 && Date.now() >= deadline) throw new Error('SESSION_COMMIT_LOOKUP_NOT_READY')
  }
  const withinDeadline = async <T>(request: () => Promise<T>): Promise<T> => {
    checkDeadline()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const result = await Promise.race([request(), new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('SESSION_COMMIT_LOOKUP_NOT_READY')), Math.max(0, deadline - Date.now()))
      })])
      // Resolved promises can beat an expired timer in the microtask queue.
      checkDeadline()
      return result
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }
  // Cache contents are only a sizing hint. Refetch every table actually used by
  // the message, preserving required keys but compiling with finalized indexes.
  const waitFinalized = async (requirements: {key: PublicKey; addresses: PublicKey[]}[]) => {
    for (;;) {
      const tables: AddressLookupTableAccount[] = []
      for (const required of requirements) {
        const table = (await withinDeadline(() => args.connection.getAddressLookupTable(required.key, {commitment: 'finalized'}))).value
        if (table && !table.isActive()) throw new Error('SESSION_COMMIT_LOOKUP_INACTIVE')
        const found = new Set(table?.state.addresses.map(k => k.toBase58()))
        if (table && table.key.equals(required.key) && required.addresses.every(k => found.has(k.toBase58()))) tables.push(table)
      }
      if (tables.length === requirements.length) {
        const slot = await withinDeadline(() => args.connection.getSlot('finalized'))
        if (tables.every(table => slot > table.state.lastExtendedSlot)) {
          if (!fits(tables)) throw new Error('SESSION_COMMIT_LOOKUP_PACKET_LIMIT')
          return tables
        }
      }
      const remaining = deadline - Date.now()
      if (remaining <= 0) throw new Error('SESSION_COMMIT_LOOKUP_NOT_READY')
      await new Promise(resolve => setTimeout(resolve, Math.min(pollIntervalMs, remaining)))
    }
  }
  if (fits(configured)) {
    const tx = compileSessionTransaction({...args, lookupTables: configured, recentBlockhash: PublicKey.default.toBase58()})
    const requirements = tx.message.addressTableLookups.map(used => {
      const table = configured.find(t => t.key.equals(used.accountKey))!
      return {key: table.key, addresses: [...used.writableIndexes, ...used.readonlyIndexes].map(i => table.state.addresses[i])}
    })
    return requirements.length ? waitFinalized(requirements) : []
  }
  const addresses = sessionCommitLookupAddresses(args.instructions, args.payer)
  if (addresses.length > MAX_COMMIT_LOOKUP_KEYS) throw new Error('SESSION_COMMIT_LOOKUP_KEY_LIMIT')

  let table = args.lookupTableAddress
    ? (await withinDeadline(() => args.connection.getAddressLookupTable(args.lookupTableAddress!, {commitment: 'confirmed'}))).value
    : null
  const includesAll = (value: AddressLookupTableAccount) => {
    const found = new Set(value.state.addresses.map(k => k.toBase58()))
    return addresses.every(k => found.has(k.toBase58()))
  }
  // Another wallet's populated active table is usable, but never extend it.
  if (table && (!table.isActive() || (!includesAll(table) && !table.state.authority?.equals(args.payer)))) table = null
  if (table) {
    const occupied = new Set(table.state.addresses.map(k => k.toBase58()))
    if (table.state.addresses.length + addresses.filter(k => !occupied.has(k.toBase58())).length > 256) table = null
  }
  let address: PublicKey
  let creation: TransactionInstruction[] = []
  if (table) address = table.key
  else {
    const recentSlot = await withinDeadline(() => args.connection.getSlot('finalized'))
    const [instruction, derived] = AddressLookupTableProgram.createLookupTable({authority: args.payer, payer: args.payer, recentSlot})
    address = derived
    // PDA = authority + recent slot, not session. Another attempt in the same
    // finalized slot may already have created it even if the cache write failed.
    table = (await withinDeadline(() => args.connection.getAddressLookupTable(address, {commitment: 'confirmed'}))).value
    if (table) {
      if (!table.isActive() || (!includesAll(table) && !table.state.authority?.equals(args.payer))) {
        throw new Error('SESSION_COMMIT_LOOKUP_SLOT_IN_USE_RETRY_NEXT_SLOT')
      }
    } else creation = [instruction]
  }
  const existing = new Set(table?.state.addresses.map(k => k.toBase58()) ?? [])
  const missing = addresses.filter(k => !existing.has(k.toBase58()))
  if ((table?.state.addresses.length ?? 0) + missing.length > 256) throw new Error('SESSION_COMMIT_LOOKUP_FULL_RETRY_NEXT_SLOT')
  for (let offset = 0; offset < missing.length; offset += EXTEND_CHUNK) {
    const extend = AddressLookupTableProgram.extendLookupTable({lookupTable: address, authority: args.payer, payer: args.payer, addresses: missing.slice(offset, offset + EXTEND_CHUNK)})
    checkDeadline()
    await args.sendSetup([...creation, extend], 'Prepare basket commit address table (wallet-paid rent; no assets move)')
    creation = []
    args.onLookupTableCreated?.(address)
    checkDeadline()
  }
  // A confirmed extension is not enough for v0 transport. Return only the
  // complete finalized table, so unused configured tables cannot leak through.
  const tables = await waitFinalized([{key: address, addresses}])
  args.onLookupTableCreated?.(address)
  return tables
}
