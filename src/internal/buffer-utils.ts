/**
 * Write a BigInt as little-endian uint64 to a buffer
 */
export function writeBigUInt64LE(
  target: Uint8Array,
  value: bigint | number,
  offset = 0,
): void {
  const bigintValue = typeof value === 'bigint' ? value : BigInt(value)
  const buffer = new ArrayBuffer(8)
  new DataView(buffer).setBigUint64(0, bigintValue, true)
  target.set(new Uint8Array(buffer), offset)
}
