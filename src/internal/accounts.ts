import { PublicKey } from '@solana/web3.js'
import type { Buffer } from 'buffer'

const ACCOUNT_DISCRIMINATOR_SIZE = 8
const PUBLIC_KEY_LENGTH = 32

export type AccountDataView = {
  readonly bytes: Uint8Array
  readonly view: DataView
}

function toBytes(data: Uint8Array | Buffer): Uint8Array {
  if (data instanceof Uint8Array) {
    return data
  }
  return Uint8Array.from(data)
}

export function createAccountDataView(data: Uint8Array | Buffer): AccountDataView {
  const bytes = toBytes(data)
  return {
    bytes,
    view: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
  }
}

export function readPublicKey(bytes: Uint8Array, offset: number): PublicKey {
  return new PublicKey(bytes.subarray(offset, offset + PUBLIC_KEY_LENGTH))
}

export function skipDiscriminator(offset = 0): number {
  return offset + ACCOUNT_DISCRIMINATOR_SIZE
}

export function matchesAccountDiscriminator(
  data: Uint8Array | Buffer,
  discriminator: readonly number[] | Uint8Array,
): boolean {
  const bytes = toBytes(data)
  if (bytes.byteLength < ACCOUNT_DISCRIMINATOR_SIZE || discriminator.length !== ACCOUNT_DISCRIMINATOR_SIZE) {
    return false
  }
  for (let index = 0; index < ACCOUNT_DISCRIMINATOR_SIZE; index += 1) {
    if (bytes[index] !== discriminator[index]) {
      return false
    }
  }
  return true
}

export function readBigUInt64(view: DataView, offset: number): bigint {
  return view.getBigUint64(offset, true)
}

export function readBigInt64(view: DataView, offset: number): bigint {
  return view.getBigInt64(offset, true)
}

export function readUInt16(view: DataView, offset: number): number {
  return view.getUint16(offset, true)
}

export function readUInt8(view: DataView, offset: number): number {
  return view.getUint8(offset)
}

export const ACCOUNT_META = {
  ACCOUNT_DISCRIMINATOR_SIZE,
  PUBLIC_KEY_LENGTH,
} as const
