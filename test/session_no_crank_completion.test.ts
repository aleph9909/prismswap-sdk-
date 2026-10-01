import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PublicKey } from '@solana/web3.js'
import { AccountRole } from '@solana/kit'
import {
  AssetKindV4, SessionPhase, SlotSide, SlotStatus,
  buildCommittedRecoveryPlan, buildParticipantClaimPlan, buildSessionPlanFromState,
  type TradeSessionState, type SessionTxPlan,
} from '../src/session/index.js'

const pk = () => PublicKey.unique()
function assertPayerOnly(plan: SessionTxPlan, payer: PublicKey) {
  for (const group of plan.groups) {
    assert.equal(group.signerRole, 'crank', 'permissionless payer role, not a service requirement')
    assert.ok(['release', 'close'].includes(group.phase), 'no funding/commit/cancel/refund in committed recovery')
    for (const ix of group.instructions) {
      assert.deepEqual(ix.accounts!.filter(meta => meta.role === AccountRole.WRITABLE_SIGNER || meta.role === AccountRole.READONLY_SIGNER)
        .map(meta => meta.address), [payer.toBase58()])
      assert.equal(ix.accounts![0].address, payer.toBase58())
      assert.equal(ix.accounts![2].address, plan.maker.toBase58())
      assert.equal(ix.accounts![3].address, plan.taker.toBase58())
    }
  }
}

for (const [makerCount, takerCount] of [[1, 1], [2, 1], [2, 2], [8, 8]]) {
  test(`Core ${makerCount}x${takerCount}: arbitrary payer delivers all immutable recipients without either participant signing`, () => {
    const args = fixture(makerCount, takerCount)
    assert.ok(!args.payer.equals(args.state.maker) && !args.payer.equals(args.state.taker))
    const plan = buildCommittedRecoveryPlan(args)
    assertPayerOnly(plan, args.payer)
    assert.deepEqual(indexes(plan), args.state.slots.map((_, i) => i))
    assert.equal(plan.groups[plan.groups.length - 1].phase, 'close')
    for (const group of plan.groups.filter(group => group.phase === 'release')) {
      assert.equal(group.instructions.length, 1, 'Core packing remains unchanged')
      const globalIndex = group.slotIndexes[0]
      const slot = args.state.slots[globalIndex]
      const ix = group.instructions[0]
      assert.equal(ix.data![8], globalIndex, 'wire slot index is global, never renumbered')
      const localIndex = globalIndex < makerCount ? globalIndex : globalIndex - makerCount
      assert.equal(globalIndex, localIndex + (slot.side === SlotSide.Maker ? 0 : makerCount))
      // Core's ABI has no caller-selectable recipient account: Rust derives it
      // from this wire index/side and the immutable named maker/taker accounts.
      const beneficiary = ix.accounts![slot.side === SlotSide.Maker ? 3 : 2].address
      assert.equal(beneficiary, (slot.side === SlotSide.Maker ? args.state.taker : args.state.maker).toBase58())
      assert.notEqual(beneficiary, args.payer.toBase58())
      assert.equal(ix.accounts![5].address, slot.mintOrAssetId.toBase58())
      assert.equal(ix.accounts![6].address, slot.tree.toBase58())
    }
    const partial = { ...args.state, slots: args.state.slots.map((slot, index) =>
      index % 2 === 0 ? { ...slot, status: SlotStatus.Released } : slot) }
    const resumed = buildCommittedRecoveryPlan({ ...args, state: partial })
    assertPayerOnly(resumed, args.payer)
    assert.deepEqual(indexes(resumed), args.state.slots.map((_, i) => i).filter(i => i % 2 !== 0))
    assert.deepEqual(resumed.groups.filter(g => g.phase === 'release').map(g => g.instructions[0].data![8]), indexes(resumed))
  })
}

test('all blocked is no work, not close; thaw resumes only still-deposited global slots', () => {
  const args = fixture()
  const blocked = [0, 3]
  const first = buildCommittedRecoveryPlan({ ...args, releaseBlockedSlotIndexes: blocked })
  assert.deepEqual(indexes(first), [1, 2])
  const state = { ...args.state, slots: args.state.slots.map((slot, i) => blocked.includes(i) ? slot : { ...slot, status: SlotStatus.Released }) }
  assert.deepEqual(buildCommittedRecoveryPlan({ ...args, state, releaseBlockedSlotIndexes: blocked }).groups, [])
  const thawed = buildCommittedRecoveryPlan({ ...args, state, releaseBlockedSlotIndexes: [] })
  assert.deepEqual(indexes(thawed), blocked)
  assertPayerOnly(thawed, args.payer)
  assert.deepEqual(thawed.groups.map(g => g.phase), ['release', 'release', 'close'])
})

test('all Released produces close only, even if obsolete blockers still list those slots', () => {
  const args = fixture()
  const state = { ...args.state, slots: args.state.slots.map(slot => ({ ...slot, status: SlotStatus.Released })) }
  const plan = buildCommittedRecoveryPlan({ ...args, state, releaseBlockedSlotIndexes: [0, 1, 2, 3] })
  assert.deepEqual(plan.groups.map(g => g.phase), ['close'])
  assertPayerOnly(plan, args.payer)
  assert.throws(() => buildCommittedRecoveryPlan({ ...args, state: { ...state, slots: state.slots.slice(1) } }), /committed.*manifest/i)
})

test('block hints only omit Core, ignore nonexistent indexes, and literal participant claim stays incoming-only', () => {
  const args = fixture()
  const state = { ...args.state, slots: args.state.slots.map((slot, i) => i === 0 ? { ...slot, kind: AssetKindV4.Spl, tree: PublicKey.default } : slot) }
  const plan = buildCommittedRecoveryPlan({ ...args, state, releaseBlockedSlotIndexes: [0, 99, -1] })
  assert.deepEqual(indexes(plan), [0, 1, 2, 3])
  assert.equal(plan.groups[plan.groups.length - 1].phase, 'close')
  assertPayerOnly(plan, args.payer)
  assert.equal(plan.groups[0].ataCreations[0].owner.toBase58(), state.taker.toBase58())
  assert.notEqual(plan.groups[0].ataCreations[0].owner.toBase58(), args.payer.toBase58())
  for (const [participant, incoming] of [[state.maker, [2, 3]], [state.taker, [0, 1]]] as const) {
    const claim = buildParticipantClaimPlan({ ...args, state, participant })
    assert.deepEqual(indexes(claim), incoming)
    assert.ok(claim.groups.every(g => g.phase === 'release'))
  }
})

test('state rebuilding forwards Core omission hints and defaults permissionless payer to taker', () => {
  const args = fixture()
  const plan = buildSessionPlanFromState({ programId: args.programId, state: args.state,
    feeTreasury: pk(), releaseBlockedSlotIndexes: [2] })
  assert.deepEqual(indexes(plan), [0, 1, 3])
  assert.ok(plan.groups.every(g => g.phase === 'release'))
  assertPayerOnly(plan, args.state.taker)
})

test('release and close copy explains payer wallet approval, never promises automatic unsigned delivery', () => {
  const args = fixture()
  const plans = [buildCommittedRecoveryPlan(args), buildCommittedRecoveryPlan({ ...args,
    state: { ...args.state, slots: args.state.slots.map(slot => ({ ...slot, kind: AssetKindV4.Spl, tree: PublicKey.default })) } })]
  for (const plan of plans) {
    for (const group of plan.groups) {
      assert.doesNotMatch(group.userFacing.detail, /automatically|no signature needed/i)
      assert.match(group.userFacing.detail, /payer.*(approval|sign)|wallet.*approval/i)
    }
  }
})

function fixture(makerSlotCount = 2, takerSlotCount = 2) {
  const state: TradeSessionState = {
    maker: pk(), taker: pk(), nonce: 42n, phase: SessionPhase.Committed,
    makerSlotCount, takerSlotCount, filledSlotCount: makerSlotCount + takerSlotCount,
    bump: 0, makerSolAmount: 0n, takerSolAmount: 0n, expiresAt: 0n,
    crankBondLamports: 0n, makerFeeEscrowed: 0n, tradeCommitment: new Uint8Array(32).fill(1),
    slots: Array.from({ length: makerSlotCount + takerSlotCount }, (_, index) => ({
      side: index < makerSlotCount ? SlotSide.Maker : SlotSide.Taker,
      kind: AssetKindV4.Core, status: SlotStatus.Deposited,
      mintOrAssetId: pk(), tree: pk(), proofSize: 0,
    })),
  }
  return { programId: pk(), sessionPda: pk(), payer: pk(), state }
}
const indexes = (plan: SessionTxPlan) => plan.groups.flatMap(group => group.slotIndexes)

for (const [name, mutate] of [
  ['missing slot', (state: TradeSessionState) => ({ ...state, slots: state.slots.slice(0, -1) })],
  ['incomplete filled count', (state: TradeSessionState) => ({ ...state, filledSlotCount: 3 })],
  ['wrong side at global index', (state: TradeSessionState) => ({ ...state, slots: state.slots.map((slot, i) => i === 2 ? { ...slot, side: SlotSide.Maker } : slot) })],
  ['empty required slot', (state: TradeSessionState) => ({ ...state, slots: state.slots.map((slot, i) => i === 2 ? { ...slot, status: SlotStatus.Empty } : slot) })],
  ['withdrawn required slot', (state: TradeSessionState) => ({ ...state, slots: state.slots.map((slot, i) => i === 2 ? { ...slot, status: SlotStatus.Withdrawn } : slot) })],
] as const) {
  test(`incomplete/invalid committed manifest fails closed: ${name}`, () => {
    const args = fixture()
    assert.throws(() => buildCommittedRecoveryPlan({ ...args, state: mutate(args.state) }), /committed.*manifest/i)
  })
}

test('pNFT committed recovery ignores Released metadata, binds active identities and never substitutes payer for beneficiary', () => {
  const args = fixture()
  const state = { ...args.state, slots: args.state.slots.map((slot, index) => ({ ...slot,
    kind: AssetKindV4.Programmable, tree: PublicKey.default,
    status: index % 2 === 0 ? SlotStatus.Released : SlotStatus.Deposited,
  })) }
  const liveMeta = { source: 'authenticated_oracle' as const, oracleSequence: '1', observedSlot: '1', ruleSet: null }
  const legMeta = new Map([1, 3].map(index => [state.slots[index].mintOrAssetId.toBase58(), liveMeta]))
  // Block hints are omission-only Core hints, not a bypass of pNFT metadata.
  const plan = buildCommittedRecoveryPlan({ ...args, state, legMeta, releaseBlockedSlotIndexes: [1, 3] })
  assert.deepEqual(indexes(plan), [1, 3])
  assertPayerOnly(plan, args.payer)
  for (const group of plan.groups.filter(group => group.phase === 'release')) {
    const index = group.slotIndexes[0]
    assert.equal(group.instructions[0].data![8], index)
    assert.equal(group.ataCreations[0].mint.toBase58(), state.slots[index].mintOrAssetId.toBase58())
    assert.equal(group.ataCreations[0].owner.toBase58(), (index < state.makerSlotCount ? state.taker : state.maker).toBase58())
    assert.notEqual(group.ataCreations[0].owner.toBase58(), args.payer.toBase58())
  }
  assert.throws(() => buildCommittedRecoveryPlan({ ...args, state }), /PNFT_AUTHORITATIVE/)
  for (const invalid of [
    { ruleSet: null },
    { source: 'authenticated_oracle' as const, oracleSequence: '1', observedSlot: '1' },
    { ...liveMeta, oracleSequence: '' }, { ...liveMeta, observedSlot: '' },
  ]) {
    const invalidMeta = new Map(legMeta)
    invalidMeta.set(state.slots[1].mintOrAssetId.toBase58(), invalid as typeof liveMeta)
    assert.throws(() => buildCommittedRecoveryPlan({ ...args, state, legMeta: invalidMeta }), /PNFT_AUTHORITATIVE/)
  }
  const wrongIdentity = new Map([[state.slots[0].mintOrAssetId.toBase58(), liveMeta]])
  assert.throws(() => buildCommittedRecoveryPlan({ ...args, state, legMeta: wrongIdentity }), /PNFT_AUTHORITATIVE/)
  const released = { ...state, slots: state.slots.map(slot => ({ ...slot, status: SlotStatus.Released })) }
  assert.deepEqual(buildCommittedRecoveryPlan({ ...args, state: released }).groups.map(group => group.phase), ['close'])
  assert.deepEqual(buildParticipantClaimPlan({ ...args, state: released, participant: state.taker }).groups, [], 'empty incoming plan does not authorize close')
  assert.throws(() => buildCommittedRecoveryPlan({ ...args, state: { ...released, filledSlotCount: 0 } }), /committed.*manifest/i)
  assert.throws(() => buildCommittedRecoveryPlan({ ...args, state: { ...released, slots: released.slots.slice(1) } }), /committed.*manifest/i)
})

for (const blockedIndex of [0, 2]) {
  test(`committed recovery omits frozen Core global ${blockedIndex}, delivers healthy slots on both sides, withholds close`, () => {
    const args = fixture()
    const plan = buildCommittedRecoveryPlan({ ...args, releaseBlockedSlotIndexes: [blockedIndex] })
    assert.deepEqual(indexes(plan), [0, 1, 2, 3].filter(index => index !== blockedIndex))
    assert.ok(plan.groups.every(group => group.phase === 'release'))
    assert.deepEqual(args.state.slots.map(slot => slot.status), Array(4).fill(SlotStatus.Deposited))
  })
}
