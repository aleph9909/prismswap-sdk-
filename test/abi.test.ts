import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sha256 } from '@noble/hashes/sha256'
import { PublicKey } from '@solana/web3.js'

import {
  AssetKindV4,
  CNFT_LEAF_ARGS_V4_ENCODED_LENGTH,
  CREATE_SESSION_V4_DISCRIMINATOR,
  DEPOSIT_ASSET_V4_DISCRIMINATOR,
  SESSION_OFFSETS,
  SLOT_LEN,
  SLOT_SPEC_V4_ENCODED_LENGTH,
  SessionPhase,
  SlotSide,
  SlotStatus,
  TRADE_SESSION_DISCRIMINATOR,
  decodeTradeSession,
  deriveSessionPda,
  encodeSlotSpecV4,
  getCreateSessionV4Instruction,
  getCommitTradeV4Instruction,
  getDepositAssetV4Instruction,
  spaceFor,
} from '../src/session/index.js'

const utf8 = (value: string) => new TextEncoder().encode(value)
const toHex = (bytes: Uint8Array) => Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')

test('create_session_v4 discriminator = sha256("global:create_session_v4")[0..8]', () => {
  const expected = sha256(utf8('global:create_session_v4')).slice(0, 8)
  assert.deepEqual(Array.from(CREATE_SESSION_V4_DISCRIMINATOR), Array.from(expected))
  // Locked bytes for the v4 ABI.
  assert.equal(toHex(CREATE_SESSION_V4_DISCRIMINATOR), 'b3271bcbde51dfc9')
})

test('TradeSession account discriminator = sha256("account:TradeSession")[0..8]', () => {
  const expected = sha256(utf8('account:TradeSession')).slice(0, 8)
  assert.deepEqual(Array.from(TRADE_SESSION_DISCRIMINATOR), Array.from(expected))
  assert.equal(toHex(TRADE_SESSION_DISCRIMINATOR), '2b146fbcb0948c45')
})

test('create_session_v4 data length and arg encoding for known args', () => {
  const ix = getCreateSessionV4Instruction({
    maker: PublicKey.unique(),
    taker: PublicKey.unique(),
    session: PublicKey.unique(),
    config: PublicKey.unique(),
    nonce: 42n,
    makerSlotCount: 8,
    takerSlotCount: 8,
    makerSolAmount: 123n,
    takerSolAmount: 456n,
    expiresAt: -1n,
    crankBondLamports: 160_000n,
    tradeCommitment: new Uint8Array(32).fill(0xab),
  })
  const data = ix.data!
  // Existing 50-byte prefix + immutable 32-byte Trade Authority commitment.
  assert.equal(data.byteLength, 82)
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  assert.equal(view.getBigUint64(8, true), 42n)
  assert.equal(view.getUint8(16), 8)
  assert.equal(view.getUint8(17), 8)
  assert.equal(view.getBigUint64(18, true), 123n)
  assert.equal(view.getBigUint64(26, true), 456n)
  assert.equal(view.getBigInt64(34, true), -1n)
  assert.equal(view.getBigUint64(42, true), 160_000n)
  assert.deepEqual(Array.from(data.slice(50)), Array(32).fill(0xab))
  assert.equal(ix.accounts?.length, 5)
})

test('standalone commit_trade_v4 keeps the deployed six-account ABI', () => {
  const ix = getCommitTradeV4Instruction({
    taker: PublicKey.unique(),
    maker: PublicKey.unique(),
    session: PublicKey.unique(),
    config: PublicKey.unique(),
    feeTreasury: PublicKey.unique(),
  })
  assert.equal(ix.accounts?.length, 6)
  assert.equal(ix.accounts?.some((account) =>
    account.address === 'Sysvar1nstructions1111111111111111111111111'), false)
})

test('SlotSpecV4 encodes to exactly 67 bytes', () => {
  const encoded = encodeSlotSpecV4({
    side: SlotSide.Taker,
    kind: AssetKindV4.Compressed,
    mintOrAssetId: PublicKey.unique(),
    tree: PublicKey.unique(),
    proofSize: 17,
  })
  assert.equal(SLOT_SPEC_V4_ENCODED_LENGTH, 67)
  assert.equal(encoded.byteLength, 67)
  assert.equal(encoded[0], SlotSide.Taker)
  assert.equal(encoded[1], AssetKindV4.Compressed)
  assert.equal(encoded[66], 17)
})

test('spaceFor matches the ABI doc worked examples', () => {
  assert.equal(spaceFor(16), 1249) // 8v8
  assert.equal(spaceFor(64), 4513) // 32v32
  assert.equal(spaceFor(0), 8 + 149 + 4)
})

test('deposit_asset_v4 Option<CnftLeafArgsV4> encoding (None and Some)', () => {
  const base = {
    depositor: PublicKey.unique(),
    session: PublicKey.unique(),
    slotIndex: 3,
    remainingAccounts: [],
  }
  const none = getDepositAssetV4Instruction({ ...base, cnftArgs: null })
  assert.equal(none.data!.byteLength, 8 + 1 + 1)
  assert.equal(none.data![8], 3)
  assert.equal(none.data![9], 0x00)
  assert.equal(toHex(DEPOSIT_ASSET_V4_DISCRIMINATOR), '06b3cdfb1dbf76ad')

  const some = getDepositAssetV4Instruction({
    ...base,
    cnftArgs: {
      root: new Uint8Array(32).fill(1),
      dataHash: new Uint8Array(32).fill(2),
      creatorHash: new Uint8Array(32).fill(3),
      nonce: 99n,
      index: 99,
    },
  })
  assert.equal(CNFT_LEAF_ARGS_V4_ENCODED_LENGTH, 108)
  assert.equal(some.data!.byteLength, 8 + 1 + 1 + 108)
  assert.equal(some.data![9], 0x01)
  const view = new DataView(some.data!.buffer, some.data!.byteOffset, some.data!.byteLength)
  assert.equal(view.getBigUint64(10 + 96, true), 99n)
  assert.equal(view.getUint32(10 + 104, true), 99)
})

test('decodeTradeSession round-trips a synthetic account at the fixed offsets', () => {
  const maker = PublicKey.unique()
  const taker = PublicKey.unique()
  const mint = PublicKey.unique()
  const tree = PublicKey.unique()

  const bytes = new Uint8Array(spaceFor(2))
  const view = new DataView(bytes.buffer)
  bytes.set(TRADE_SESSION_DISCRIMINATOR, 0)
  bytes.set(maker.toBytes(), SESSION_OFFSETS.maker)
  bytes.set(taker.toBytes(), SESSION_OFFSETS.taker)
  view.setBigUint64(SESSION_OFFSETS.nonce, 7n, true)
  view.setUint8(SESSION_OFFSETS.phase, SessionPhase.TakerDepositing)
  view.setUint8(SESSION_OFFSETS.makerSlotCount, 1)
  view.setUint8(SESSION_OFFSETS.takerSlotCount, 1)
  view.setUint8(SESSION_OFFSETS.bump, 254)
  view.setBigUint64(SESSION_OFFSETS.makerSolAmount, 1_000n, true)
  view.setBigUint64(SESSION_OFFSETS.takerSolAmount, 2_000n, true)
  view.setBigInt64(SESSION_OFFSETS.expiresAt, 0n, true)
  view.setBigUint64(SESSION_OFFSETS.crankBondLamports, 20_000n, true)
  view.setBigUint64(SESSION_OFFSETS.makerFeeEscrowed, 5_000n, true)
  view.setUint8(SESSION_OFFSETS.filledSlotCount, 2)
  view.setUint32(SESSION_OFFSETS.slotsVecLen, 2, true)

  const slot0 = SESSION_OFFSETS.slots
  view.setUint8(slot0, SlotSide.Maker)
  view.setUint8(slot0 + 1, AssetKindV4.Spl)
  view.setUint8(slot0 + 2, SlotStatus.Deposited)
  bytes.set(mint.toBytes(), slot0 + 3)
  // tree stays all-zero for non-compressed
  view.setUint8(slot0 + 67, 0)

  const slot1 = slot0 + SLOT_LEN
  view.setUint8(slot1, SlotSide.Taker)
  view.setUint8(slot1 + 1, AssetKindV4.Compressed)
  view.setUint8(slot1 + 2, SlotStatus.Empty)
  bytes.set(mint.toBytes(), slot1 + 3)
  bytes.set(tree.toBytes(), slot1 + 35)
  view.setUint8(slot1 + 67, 12)

  const state = decodeTradeSession(bytes)
  assert.equal(state.maker.toBase58(), maker.toBase58())
  assert.equal(state.taker.toBase58(), taker.toBase58())
  assert.equal(state.nonce, 7n)
  assert.equal(state.phase, SessionPhase.TakerDepositing)
  assert.equal(state.makerSlotCount, 1)
  assert.equal(state.takerSlotCount, 1)
  assert.equal(state.bump, 254)
  assert.equal(state.makerSolAmount, 1_000n)
  assert.equal(state.takerSolAmount, 2_000n)
  assert.equal(state.expiresAt, 0n)
  assert.equal(state.crankBondLamports, 20_000n)
  assert.equal(state.makerFeeEscrowed, 5_000n)
  assert.equal(state.filledSlotCount, 2)
  assert.equal(state.slots.length, 2)
  assert.equal(state.slots[0].kind, AssetKindV4.Spl)
  assert.equal(state.slots[0].status, SlotStatus.Deposited)
  assert.equal(state.slots[1].kind, AssetKindV4.Compressed)
  assert.equal(state.slots[1].tree.toBase58(), tree.toBase58())
  assert.equal(state.slots[1].proofSize, 12)
})

test('deriveSessionPda uses ["session", maker, taker, nonce_le_u64]', () => {
  const programId = PublicKey.unique()
  const maker = PublicKey.unique()
  const taker = PublicKey.unique()
  const nonce = 0x0102030405060708n
  const [pda, bump] = deriveSessionPda(programId, maker, taker, nonce)
  const nonceLe = new Uint8Array(8)
  new DataView(nonceLe.buffer).setBigUint64(0, nonce, true)
  const [expected, expectedBump] = PublicKey.findProgramAddressSync(
    [utf8('session'), maker.toBytes(), taker.toBytes(), nonceLe],
    programId,
  )
  assert.equal(pda.toBase58(), expected.toBase58())
  assert.equal(bump, expectedBump)
})
