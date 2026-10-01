import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PublicKey } from '@solana/web3.js'
import { AccountRole } from '@solana/kit'
import { getAssociatedTokenAddressSync } from '../src/internal/token.js'

import {
  AssetKindV4,
  assertCanonicalSessionAtaBindings,
  buildSessionPlan,
  buildCancelPlan,
  buildSessionPlanFromState,
  buildParticipantClaimPlan,
  decodeTradeSession,
  SessionPhase,
  SlotStatus,
  spaceFor,
  TRADE_SESSION_DISCRIMINATOR,
  SESSION_OFFSETS,
  SLOT_OFFSETS,
  SLOT_LEN,
  SlotSide,
} from '../src/session/index.js'
import { PROGRAM_ID, TOKEN_PROGRAM_ID } from '../src/internal/program-ids.js'
import { TOKEN_2022_PROGRAM_ID } from '../src/internal/token.js'

const pk = () => PublicKey.unique()
const commitment = () => new Uint8Array(32).fill(1)

function committedState(args: {
  maker: PublicKey
  taker: PublicKey
  slots: readonly {
    side: SlotSide
    kind: AssetKindV4
    status: SlotStatus
    identity: PublicKey
    tree?: PublicKey
    proofSize?: number
  }[]
}) {
  const bytes = new Uint8Array(spaceFor(args.slots.length))
  const view = new DataView(bytes.buffer)
  bytes.set(TRADE_SESSION_DISCRIMINATOR, 0)
  bytes.set(args.maker.toBytes(), SESSION_OFFSETS.maker)
  bytes.set(args.taker.toBytes(), SESSION_OFFSETS.taker)
  view.setUint8(SESSION_OFFSETS.phase, SessionPhase.Committed)
  view.setUint8(SESSION_OFFSETS.makerSlotCount, args.slots.filter((slot) => slot.side === SlotSide.Maker).length)
  view.setUint8(SESSION_OFFSETS.takerSlotCount, args.slots.filter((slot) => slot.side === SlotSide.Taker).length)
  view.setUint8(SESSION_OFFSETS.filledSlotCount, args.slots.length)
  view.setUint32(SESSION_OFFSETS.slotsVecLen, args.slots.length, true)
  args.slots.forEach((slot, index) => {
    const base = SESSION_OFFSETS.slots + index * SLOT_LEN
    view.setUint8(base + SLOT_OFFSETS.side, slot.side)
    view.setUint8(base + SLOT_OFFSETS.kind, slot.kind)
    view.setUint8(base + SLOT_OFFSETS.status, slot.status)
    bytes.set(slot.identity.toBytes(), base + SLOT_OFFSETS.mintOrAssetId)
    bytes.set((slot.tree ?? PublicKey.default).toBytes(), base + SLOT_OFFSETS.tree)
    view.setUint8(base + SLOT_OFFSETS.proofSize, slot.proofSize ?? 0)
  })
  return decodeTradeSession(bytes)
}

function legs(kinds: number[]) {
  return kinds.map((kind) => ({
    kind: kind as 0 | 1 | 2 | 3 | 4,
    mintOrAssetId: pk(),
    tree: kind === AssetKindV4.Compressed ? pk() : null,
    proofSize: kind === AssetKindV4.Compressed ? 10 : null,
    ruleSet: kind === AssetKindV4.Programmable ? pk() : null,
    collection: kind === AssetKindV4.Core ? pk() : null,
  }))
}

test('commit reads each Core asset and collection in manifest order without moving NFTs', () => {
  const makerLegs = legs([AssetKindV4.Core, AssetKindV4.Spl])
  const takerLegs = [{kind:AssetKindV4.Core, mintOrAssetId:pk(), collection:null}]
  const plan = buildSessionPlan({maker:pk(),taker:pk(),nonce:1n,tradeCommitment:commitment(),
    makerLegs,takerLegs,makerSol:0n,takerSol:0n,expiresAt:0,feeTreasury:pk()})
  const group = plan.groups.find(g => g.phase === 'commit')!
  assert.equal(group.instructions.length, 1, 'commit does not include releases')
  assert.deepEqual(group.instructions[0].accounts!.slice(6).map(a => [a.address,a.role]), [
    [makerLegs[0].mintOrAssetId.toBase58(),AccountRole.READONLY],
    [makerLegs[0].collection!.toBase58(),AccountRole.READONLY],
    [takerLegs[0].mintOrAssetId.toBase58(),AccountRole.READONLY],
    ['CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d',AccountRole.READONLY],
  ])
  assert.ok(!group.userFacing.detail.includes('legally'))
})

test('canonical Trade Authority program ID remains deployed identity', () => {
  assert.equal(PROGRAM_ID.toBase58(), '6RqZ2jo91veL5WdfTxTGqwoeAxR4KU747Sq6a5rv9r2G')
})

test('8v8 mixed plan: ordering, packing, cnft placeholders', () => {
  const maker = pk(); const taker = pk(); const feeTreasury = pk(); const programId = pk()
  const makerLegs = legs([0, 0, 3, 1, 2, 4, 0, 0]) // spl spl t22 pnft cnft core spl spl
  const takerLegs = legs([2, 0, 1, 0, 0, 0, 3, 4])
  const plan = buildSessionPlan({
    programId, maker, taker, nonce: 1n, tradeCommitment: commitment(),
    makerLegs, takerLegs, makerSol: 0n, takerSol: 5n, expiresAt: 0, feeTreasury,
  })

  const phases = plan.groups.map((g) => g.phase)
  // create groups first, then makerDeposit..., startAccept, takerDeposit..., commit, release..., close
  const order = ['create', 'makerDeposit', 'startAccept', 'takerDeposit', 'commit', 'release', 'close']
  let last = 0
  for (const phase of phases) {
    const rank = order.indexOf(phase)
    assert.ok(rank >= last, `phase ${phase} out of order`)
    last = rank
  }
  assert.equal(phases.some((phase) => String(phase) === 'atomicSettlement'), false)
  const commitIndex = phases.indexOf('commit')
  const releaseIndexes = phases
    .map((phase, index) => phase === 'release' ? index : -1)
    .filter((index) => index >= 0)
  assert.ok(releaseIndexes.length > 1, 'multi-slot settlement must use multiple release groups')
  assert.ok(releaseIndexes.every((index) => index > commitIndex))
  assert.ok(phases.lastIndexOf('close') > releaseIndexes.at(-1)!)

  // 16 slots -> create must split (create+append(16)+finalize exceeds 1232)
  const createGroups = plan.groups.filter((g) => g.phase === 'create')
  assert.ok(createGroups.length > 1, 'expected split create groups for 16 slots')
  assert.ok(createGroups[0].createStage?.includesCreate)
  assert.equal(createGroups.filter((g) => g.createStage?.includesFinalize).length, 1)
  // all 16 slot indexes appended exactly once
  const appended = createGroups.flatMap((g) => g.slotIndexes)
  assert.deepEqual([...appended].sort((a, b) => a - b), Array.from({ length: 16 }, (_, i) => i))

  // maker deposits: spl spl t22 packed (3), pnft alone, cnft placeholder alone, core alone, spl spl packed
  const makerDeposits = plan.groups.filter((g) => g.phase === 'makerDeposit')
  assert.deepEqual(makerDeposits.map((g) => g.slotIndexes), [[0, 1, 2], [3], [4], [5], [6, 7]])
  for (const g of makerDeposits) assert.equal(g.signerRole, 'maker')

  const cnftDeposit = makerDeposits[2]
  assert.ok(cnftDeposit.needsFreshCnftProof)
  assert.equal(cnftDeposit.instructions.length, 0)
  assert.equal(cnftDeposit.needsFreshCnftProof!.expectedLeafOwner.toBase58(), maker.toBase58())
  const built = cnftDeposit.buildWithFreshProof!({
    root: new Uint8Array(32), dataHash: new Uint8Array(32), creatorHash: new Uint8Array(32),
    nonce: 5n, index: 5, proof: Array.from({ length: 12 }, () => pk()),
  })
  assert.equal(built.length, 1)
  // deposit ix: depositor, session, token_program + 6 fixed + 10 proof (trimmed from 12)
  assert.equal(built[0].accounts!.length, 3 + 6 + 10)
  assert.equal(built[0].data!.byteLength, 8 + 1 + 1 + 108)

  // taker deposits: cnft(8) alone, spl(9) flushed by pnft(10), spl spl spl
  // packed (11-13), t22(14) flushed by core(15)
  const takerDeposits = plan.groups.filter((g) => g.phase === 'takerDeposit')
  assert.deepEqual(takerDeposits.map((g) => g.slotIndexes), [[8], [9], [10], [11, 12, 13], [14], [15]])
  for (const g of takerDeposits) assert.equal(g.signerRole, 'taker')

  // releases cover all 16 slots; cnft release expects session PDA leaf owner
  const releases = plan.groups.filter((g) => g.phase === 'release')
  assert.deepEqual(releases.flatMap((g) => g.slotIndexes).sort((a, b) => a - b), Array.from({ length: 16 }, (_, i) => i))
  const cnftRelease = releases.find((g) => g.needsFreshCnftProof)
  assert.equal(cnftRelease!.needsFreshCnftProof!.expectedLeafOwner.toBase58(), plan.sessionPda.toBase58())

  // ata creations flagged for spl deposits (destination = session pda)
  const splPack = makerDeposits[0]
  assert.equal(splPack.ataCreations.length, 3)
  assert.ok(splPack.ataCreations.every((c) => c.owner.equals(plan.sessionPda)))
})

test('every emitted group carries non-empty user-facing copy', () => {
  const maker = pk(); const taker = pk(); const feeTreasury = pk(); const programId = pk()
  const plan = buildSessionPlan({
    programId, maker, taker, nonce: 7n, tradeCommitment: commitment(),
    makerLegs: legs([0, 0, 3, 1, 2, 4, 0, 0]),
    takerLegs: legs([2, 0, 1, 0, 0, 0, 3, 4]),
    makerSol: 0n, takerSol: 5n, expiresAt: 0, feeTreasury,
  })
  for (const group of plan.groups) {
    assert.ok(group.userFacing, `${group.label} missing userFacing`)
    assert.ok(group.userFacing.title.trim().length > 0, `${group.label} empty title`)
    assert.ok(group.userFacing.detail.trim().length > 0, `${group.label} empty detail`)
  }

  // cNFT deposits explain why they travel alone.
  const cnftDeposits = plan.groups.filter((g) => g.needsFreshCnftProof && (g.phase === 'makerDeposit' || g.phase === 'takerDeposit'))
  assert.ok(cnftDeposits.length > 0)
  for (const g of cnftDeposits) {
    assert.match(g.userFacing.detail, /Compressed NFTs carry a large ownership proof, so this one always travels alone\./)
  }

  // Lifecycle copy landmarks.
  const commit = plan.groups.find((g) => g.phase === 'commit')!
  assert.equal(commit.userFacing.title, 'Commit the trade — final step')
  assert.match(commit.userFacing.detail, /withdrawn one at a time; anyone can submit a release to its fixed recipient/)
  const startAccept = plan.groups.find((g) => g.phase === 'startAccept')!
  assert.equal(startAccept.userFacing.title, "Confirm you're taking this offer")
  const close = plan.groups.find((g) => g.phase === 'close')!
  assert.match(close.userFacing.detail, /The transaction payer signs; if you are paying, approve this cleanup in your wallet\./)
  assert.doesNotMatch(close.userFacing.detail, /handled automatically/)
})

test('8-asset side produces correctly numbered deposit titles', () => {
  const maker = pk(); const taker = pk(); const feeTreasury = pk(); const programId = pk()

  // 8 pNFTs: every deposit rides alone -> "(1 of 8)" .. "(8 of 8)".
  const soloPlan = buildSessionPlan({
    programId, maker, taker, nonce: 11n, tradeCommitment: commitment(),
    makerLegs: legs([1, 1, 1, 1, 1, 1, 1, 1]), takerLegs: legs([0]),
    makerSol: 0n, takerSol: 0n, feeTreasury,
  })
  const soloDeposits = soloPlan.groups.filter((g) => g.phase === 'makerDeposit')
  assert.equal(soloDeposits.length, 8)
  soloDeposits.forEach((group, index) => {
    assert.match(group.userFacing.title, new RegExp(`^Deposit .+ \\(${index + 1} of 8\\)$`))
  })

  // 8 SPLs: packed 3+3+2 -> "(1-3 of 8)", "(4-6 of 8)", "(7-8 of 8)".
  const packedPlan = buildSessionPlan({
    programId: pk(), maker: pk(), taker: pk(), nonce: 12n, tradeCommitment: commitment(),
    makerLegs: legs([0, 0, 0, 0, 0, 0, 0, 0]), takerLegs: legs([0]),
    makerSol: 0n, takerSol: 0n, feeTreasury: pk(),
  })
  const packedDeposits = packedPlan.groups.filter((g) => g.phase === 'makerDeposit')
  assert.deepEqual(packedDeposits.map((g) => g.userFacing.title), [
    'Deposit 3 NFTs (1-3 of 8)',
    'Deposit 3 NFTs (4-6 of 8)',
    'Deposit 2 NFTs (7-8 of 8)',
  ])
})

test('deposit titles use assetLabels when provided, shortened mint otherwise', () => {
  const makerLegs = legs([1, 1])
  const named = makerLegs[0].mintOrAssetId
  const unnamed = makerLegs[1].mintOrAssetId
  const plan = buildSessionPlan({
    programId: pk(), maker: pk(), taker: pk(), nonce: 13n, tradeCommitment: commitment(),
    makerLegs, takerLegs: legs([0]),
    makerSol: 0n, takerSol: 0n, feeTreasury: pk(),
    assetLabels: { [named.toBase58()]: 'Mad Lad #42' },
  })
  const deposits = plan.groups.filter((g) => g.phase === 'makerDeposit')
  assert.equal(deposits[0].userFacing.title, 'Deposit Mad Lad #42 (1 of 2)')
  const b58 = unnamed.toBase58()
  assert.equal(deposits[1].userFacing.title, `Deposit ${b58.slice(0, 4)}…${b58.slice(-4)} (2 of 2)`)
})

test('cancel plan groups carry user-facing copy', () => {
  const maker = pk(); const taker = pk()
  const bytes = new Uint8Array(spaceFor(1))
  const view = new DataView(bytes.buffer)
  bytes.set(TRADE_SESSION_DISCRIMINATOR, 0)
  bytes.set(maker.toBytes(), SESSION_OFFSETS.maker)
  bytes.set(taker.toBytes(), SESSION_OFFSETS.taker)
  view.setUint8(SESSION_OFFSETS.phase, SessionPhase.MakerDepositing)
  view.setUint8(SESSION_OFFSETS.makerSlotCount, 1)
  view.setUint8(SESSION_OFFSETS.filledSlotCount, 1)
  view.setUint32(SESSION_OFFSETS.slotsVecLen, 1, true)
  const s0 = SESSION_OFFSETS.slots
  view.setUint8(s0, SlotSide.Maker); view.setUint8(s0 + 1, AssetKindV4.Spl); view.setUint8(s0 + 2, SlotStatus.Deposited)
  bytes.set(pk().toBytes(), s0 + 3)

  const plan = buildCancelPlan({
    programId: pk(), sessionPda: pk(), state: decodeTradeSession(bytes), canceller: maker, cancellerRole: 'maker',
  })
  for (const group of plan.groups) {
    assert.ok(group.userFacing.title.trim().length > 0, `${group.label} empty title`)
    assert.ok(group.userFacing.detail.trim().length > 0, `${group.label} empty detail`)
  }
  assert.equal(plan.groups[0].userFacing.title, 'Cancel the trade')
  assert.match(plan.groups[1].userFacing.title, /^Get .+ back$/)
})

test('small plan packs create+append+finalize into one group', () => {
  const plan = buildSessionPlan({
    programId: pk(), maker: pk(), taker: pk(), nonce: 2n, tradeCommitment: commitment(),
    makerLegs: legs([0]), takerLegs: legs([0]),
    makerSol: 0n, takerSol: 0n, feeTreasury: pk(),
  })
  const createGroups = plan.groups.filter((g) => g.phase === 'create')
  assert.equal(createGroups.length, 1)
  assert.equal(createGroups[0].instructions.length, 3)
  assert.ok(createGroups[0].createStage?.includesCreate)
  assert.ok(createGroups[0].createStage?.includesFinalize)
})

test('Token-2022 legs keep the SPL Token program in the named slot; T22 program travels in remaining accounts', () => {
  // Regression: the on-chain account is Anchor Program<Token> — passing the
  // Token-2022 program as the named token_program would fail every T22 leg.
  const plan = buildSessionPlan({
    programId: pk(), maker: pk(), taker: pk(), nonce: 21n, tradeCommitment: commitment(),
    makerLegs: legs([3]), takerLegs: legs([0]),
    makerSol: 0n, takerSol: 0n, feeTreasury: pk(),
  })
  const t22Deposit = plan.groups.find((g) => g.phase === 'makerDeposit')!
  const ix = t22Deposit.instructions[0]
  const keys = ix.accounts!.map((meta) => meta.address)
  // Named accounts: depositor, session, token_program (SPL Token).
  assert.equal(keys[2], TOKEN_PROGRAM_ID.toBase58())
  // Remaining: [mint, source, dest, token_2022_program].
  assert.equal(ix.accounts!.length, 3 + 4)
  assert.equal(keys[6], TOKEN_2022_PROGRAM_ID.toBase58())

  const t22Release = plan.groups.find((g) => g.phase === 'release')!
  const releaseKeys = t22Release.instructions[0].accounts!.map((meta) => meta.address)
  // Named accounts: payer, session, maker, taker, token_program (SPL Token).
  assert.equal(releaseKeys[4], TOKEN_PROGRAM_ID.toBase58())
  assert.equal(releaseKeys[8], TOKEN_2022_PROGRAM_ID.toBase58())
})

test('release uses actual recipient plus exact slot mint and rejects canary-class wrong-mint destinations', () => {
  const maker = pk(); const taker = pk(); const programId = pk(); const feeTreasury = pk()
  // Mainnet canary fixture identifiers. They are regression evidence only;
  // production behavior is entirely generic.
  const makerMint = new PublicKey('59McNvt241rKsnXoBbj9p63Q4WksRDdNVso7Da76f3Hp')
  const takerMint = new PublicKey('HuGV9EDnhHkfyExfG1pNxnChrhq9JQkqUZVHGR8DYRb4')
  const canaryWrongSourceAccount = new PublicKey('CPbDKXfqj3VAe556ExkwZntUVBwJU2dSpFPkWoVjA52X')
  const plan = buildSessionPlan({
    programId, maker, taker, nonce: 31n, tradeCommitment: commitment(),
    makerLegs: [{ kind: AssetKindV4.Spl, mintOrAssetId: makerMint }],
    takerLegs: [{ kind: AssetKindV4.Spl, mintOrAssetId: takerMint }],
    makerSol: 0n, takerSol: 0n, feeTreasury,
  })
  const takerRelease = plan.groups.find((group) =>
    group.phase === 'release' && group.slotIndexes.includes(1))!
  const takerReleaseInstruction = takerRelease.instructions.find((instruction) =>
    instruction.data?.[8] === 1)!
  const expectedAta = getAssociatedTokenAddressSync(takerMint, maker, true, TOKEN_PROGRAM_ID)
  const wrongMintAta = getAssociatedTokenAddressSync(makerMint, maker, true, TOKEN_PROGRAM_ID)
  const accounts = takerReleaseInstruction.accounts!

  assert.ok(takerRelease.ataCreations.some((creation) =>
    creation.owner.equals(maker)
    && creation.mint.equals(takerMint)
    && creation.tokenProgram.equals(TOKEN_PROGRAM_ID)
    && creation.ata.equals(expectedAta)))
  assert.ok(accounts.some((account) => account.address === expectedAta.toBase58()))
  assert.ok(!accounts.some((account) => account.address === wrongMintAta.toBase58()))
  assert.ok(!accounts.some((account) => account.address === canaryWrongSourceAccount.toBase58()))
  assertCanonicalSessionAtaBindings(takerRelease)

  const malformedInstruction = {
    ...takerReleaseInstruction,
    accounts: accounts.map((account) => account.address === expectedAta.toBase58()
      ? { address: wrongMintAta.toBase58(), role: AccountRole.WRITABLE }
      : account),
  }
  assert.throws(
    () => assertCanonicalSessionAtaBindings(
      {
        ...takerRelease,
        instructions: takerRelease.instructions.map((instruction) =>
          instruction === takerReleaseInstruction ? malformedInstruction : instruction),
      },
    ),
    /SESSION_DESTINATION_ATA_MISMATCH/,
  )
})

test('wrong slot and wrong recipient ATA reuse fail closed before signing', () => {
  const maker = pk(); const taker = pk(); const makerLegs = legs([0]); const takerLegs = legs([0, 0])
  const plan = buildSessionPlan({
    programId: pk(), maker, taker, nonce: 32n, tradeCommitment: commitment(),
    makerLegs, takerLegs, makerSol: 0n, takerSol: 0n, feeTreasury: pk(),
  })
  const group = plan.groups.find((entry) =>
    entry.phase === 'release' && entry.slotIndexes.includes(1) && entry.slotIndexes.includes(2))!
  const firstDestination = group.ataCreations[0].ata.toBase58()
  const secondDestination = group.ataCreations[1].ata.toBase58()
  const wrongRecipientAta = getAssociatedTokenAddressSync(
    takerLegs[0].mintOrAssetId,
    taker,
    true,
    TOKEN_PROGRAM_ID,
  ).toBase58()

  const rejectReplacement = (replacement: string): void => {
    const instructions = group.instructions.map((instruction) => ({
      ...instruction,
      accounts: instruction.accounts?.map((account) => account.address === secondDestination
        ? { ...account, address: replacement }
        : account),
    }))
    assert.throws(
      () => assertCanonicalSessionAtaBindings({ ...group, instructions }),
      /SESSION_DESTINATION_ATA_MISMATCH/,
    )
  }
  rejectReplacement(firstDestination)
  rejectReplacement(wrongRecipientAta)
})

test('buildSessionPlanFromState rejects a partially-appended Building manifest', () => {
  // Regression: a plan rebuilt from a partial slot list re-declares smaller
  // counts and its resume mapping re-sends create_session_v4 into the
  // existing account. The missing specs only exist in the maker's original
  // plan, so rebuilding must fail loudly instead.
  const maker = pk(); const taker = pk()
  const bytes = new Uint8Array(spaceFor(1))
  const view = new DataView(bytes.buffer)
  bytes.set(TRADE_SESSION_DISCRIMINATOR, 0)
  bytes.set(maker.toBytes(), SESSION_OFFSETS.maker)
  bytes.set(taker.toBytes(), SESSION_OFFSETS.taker)
  view.setUint8(SESSION_OFFSETS.phase, SessionPhase.Building)
  view.setUint8(SESSION_OFFSETS.makerSlotCount, 2) // declared 2, appended 1
  view.setUint8(SESSION_OFFSETS.takerSlotCount, 1)
  view.setUint8(SESSION_OFFSETS.filledSlotCount, 1)
  view.setUint32(SESSION_OFFSETS.slotsVecLen, 1, true)
  const s0 = SESSION_OFFSETS.slots
  view.setUint8(s0, SlotSide.Maker); view.setUint8(s0 + 1, AssetKindV4.Spl); view.setUint8(s0 + 2, SlotStatus.Empty)
  bytes.set(pk().toBytes(), s0 + 3)

  const state = decodeTradeSession(bytes)
  assert.throws(
    () => buildSessionPlanFromState({ programId: pk(), state, feeTreasury: pk() }),
    /manifest incomplete on-chain \(1 of 3 slots appended\)/,
  )
})

test('buildSessionPlanFromState rebuilds a complete manifest (accept flow)', () => {
  const maker = pk(); const taker = pk()
  const bytes = new Uint8Array(spaceFor(2))
  const view = new DataView(bytes.buffer)
  bytes.set(TRADE_SESSION_DISCRIMINATOR, 0)
  bytes.set(maker.toBytes(), SESSION_OFFSETS.maker)
  bytes.set(taker.toBytes(), SESSION_OFFSETS.taker)
  view.setBigUint64(SESSION_OFFSETS.nonce, 9n, true)
  view.setUint8(SESSION_OFFSETS.phase, SessionPhase.Open)
  view.setUint8(SESSION_OFFSETS.makerSlotCount, 1)
  view.setUint8(SESSION_OFFSETS.takerSlotCount, 1)
  view.setUint8(SESSION_OFFSETS.filledSlotCount, 2)
  view.setBigUint64(SESSION_OFFSETS.crankBondLamports, 20_000n, true)
  bytes.set(commitment(), SESSION_OFFSETS.tradeCommitment)
  view.setUint32(SESSION_OFFSETS.slotsVecLen, 2, true)
  const s0 = SESSION_OFFSETS.slots
  view.setUint8(s0, SlotSide.Maker); view.setUint8(s0 + 1, AssetKindV4.Spl); view.setUint8(s0 + 2, SlotStatus.Deposited)
  bytes.set(pk().toBytes(), s0 + 3)
  const s1 = s0 + SLOT_LEN
  view.setUint8(s1, SlotSide.Taker); view.setUint8(s1 + 1, AssetKindV4.Spl); view.setUint8(s1 + 2, SlotStatus.Empty)
  bytes.set(pk().toBytes(), s1 + 3)

  const state = decodeTradeSession(bytes)
  const plan = buildSessionPlanFromState({ programId: pk(), state, feeTreasury: pk() })
  assert.equal(plan.makerSlotCount, 1)
  assert.equal(plan.takerSlotCount, 1)
  assert.deepEqual(
    plan.groups.map((g) => g.phase),
    ['create', 'makerDeposit', 'startAccept', 'takerDeposit', 'commit', 'release', 'close'],
  )
})

test('already-Committed recovery emits only remaining releases then close', () => {
  const maker = pk(); const taker = pk(); const programId = pk(); const releasedMint = pk(); const remainingMint = pk()
  const bytes = new Uint8Array(spaceFor(2))
  const view = new DataView(bytes.buffer)
  bytes.set(TRADE_SESSION_DISCRIMINATOR, 0)
  bytes.set(maker.toBytes(), SESSION_OFFSETS.maker)
  bytes.set(taker.toBytes(), SESSION_OFFSETS.taker)
  view.setBigUint64(SESSION_OFFSETS.nonce, 77n, true)
  view.setUint8(SESSION_OFFSETS.phase, SessionPhase.Committed)
  view.setUint8(SESSION_OFFSETS.makerSlotCount, 1)
  view.setUint8(SESSION_OFFSETS.takerSlotCount, 1)
  view.setUint8(SESSION_OFFSETS.filledSlotCount, 2)
  bytes.set(commitment(), SESSION_OFFSETS.tradeCommitment)
  view.setUint32(SESSION_OFFSETS.slotsVecLen, 2, true)
  const s0 = SESSION_OFFSETS.slots
  view.setUint8(s0, SlotSide.Maker); view.setUint8(s0 + 1, AssetKindV4.Spl); view.setUint8(s0 + 2, SlotStatus.Released)
  bytes.set(releasedMint.toBytes(), s0 + 3)
  const s1 = s0 + SLOT_LEN
  view.setUint8(s1, SlotSide.Taker); view.setUint8(s1 + 1, AssetKindV4.Spl); view.setUint8(s1 + 2, SlotStatus.Deposited)
  bytes.set(remainingMint.toBytes(), s1 + 3)

  const plan = buildSessionPlanFromState({
    programId,
    state: decodeTradeSession(bytes),
    feeTreasury: pk(),
    releasePayer: pk(),
  })
  assert.deepEqual(plan.groups.map((group) => group.phase), ['release', 'close'])
  assert.deepEqual(plan.groups[0].slotIndexes, [1])
  assert.equal(plan.groups.some((group) => group.phase === 'commit'), false)
  assert.equal(plan.groups.some((group) => group.slotIndexes.includes(0)), false)
  const expectedDestination = getAssociatedTokenAddressSync(remainingMint, maker, true, TOKEN_PROGRAM_ID)
  assert.ok(plan.groups[0].instructions[0].accounts?.some((account) =>
    account.address === expectedDestination.toBase58()))
  assertCanonicalSessionAtaBindings(plan.groups[0])
})

test('participant manual claim includes only incoming Deposited slots and accepts an arbitrary payer', () => {
  const maker = pk(); const taker = pk(); const payer = pk(); const programId = pk(); const sessionPda = pk()
  const makerMint = pk(); const takerMint = pk()
  const bytes = new Uint8Array(spaceFor(3))
  const view = new DataView(bytes.buffer)
  bytes.set(TRADE_SESSION_DISCRIMINATOR, 0)
  bytes.set(maker.toBytes(), SESSION_OFFSETS.maker)
  bytes.set(taker.toBytes(), SESSION_OFFSETS.taker)
  view.setUint8(SESSION_OFFSETS.phase, SessionPhase.Committed)
  view.setUint8(SESSION_OFFSETS.makerSlotCount, 1)
  view.setUint8(SESSION_OFFSETS.takerSlotCount, 2)
  view.setUint8(SESSION_OFFSETS.filledSlotCount, 3)
  view.setUint32(SESSION_OFFSETS.slotsVecLen, 3, true)
  const statuses = [SlotStatus.Deposited, SlotStatus.Deposited, SlotStatus.Released]
  const sides = [SlotSide.Maker, SlotSide.Taker, SlotSide.Taker]
  const mints = [makerMint, takerMint, pk()]
  for (let index = 0; index < 3; index += 1) {
    const offset = SESSION_OFFSETS.slots + index * SLOT_LEN
    view.setUint8(offset, sides[index]); view.setUint8(offset + 1, AssetKindV4.Spl); view.setUint8(offset + 2, statuses[index])
    bytes.set(mints[index].toBytes(), offset + 3)
  }
  const plan = buildParticipantClaimPlan({
    programId, sessionPda, state: decodeTradeSession(bytes), participant: maker, payer,
  })
  assert.deepEqual(plan.groups.flatMap((group) => group.slotIndexes), [1])
  assert.equal(plan.groups.some((group) => group.slotIndexes.includes(2)), false)
  const accounts = plan.groups[0].instructions[0].accounts!
  assert.equal(accounts[0].address, payer.toBase58())
  assert.ok(accounts.some((account) => account.address === getAssociatedTokenAddressSync(takerMint, maker, true, TOKEN_PROGRAM_ID).toBase58()))
})

test('manual claim skips a blocked Core incoming leg and builds its healthy sibling independently', () => {
  const maker = pk(); const taker = pk(); const frozen = pk(); const healthy = pk()
  const state = committedState({ maker, taker, slots: [
    { side: SlotSide.Maker, kind: AssetKindV4.Core, status: SlotStatus.Deposited, identity: frozen },
    { side: SlotSide.Maker, kind: AssetKindV4.Core, status: SlotStatus.Deposited, identity: healthy },
  ] })
  const args = { programId: pk(), sessionPda: pk(), state, participant: taker, releaseBlockedSlotIndexes: [0] }
  const plan = buildParticipantClaimPlan(args)
  assert.deepEqual(plan.groups.flatMap(group => group.slotIndexes), [1])
  assert.ok(plan.groups.every(group => group.phase === 'release'))
  assert.ok(plan.groups.flatMap(group => group.instructions).every(ix => !ix.accounts?.some(account => account.address === frozen.toBase58())))
  assert.deepEqual(buildParticipantClaimPlan({ ...args, releaseBlockedSlotIndexes: [] }).groups.flatMap(group => group.slotIndexes), [0, 1])
})

test('manual Core claim reconstructs collection and no-collection from immutable slot state', () => {
  const maker = pk(); const taker = pk(); const payer = pk(); const sessionPda = pk()
  const collectedAsset = pk(); const uncollectedAsset = pk(); const releasedAsset = pk(); const collection = pk(); const wrongCollection = pk()
  const state = committedState({ maker, taker, slots: [
    { side: SlotSide.Maker, kind: AssetKindV4.Core, status: SlotStatus.Deposited, identity: collectedAsset, tree: collection },
    { side: SlotSide.Maker, kind: AssetKindV4.Core, status: SlotStatus.Deposited, identity: uncollectedAsset },
    { side: SlotSide.Maker, kind: AssetKindV4.Core, status: SlotStatus.Released, identity: releasedAsset, tree: pk() },
  ] })
  const plan = buildParticipantClaimPlan({
    programId: pk(), sessionPda, state, participant: taker, payer,
    // Caller metadata cannot substitute the immutable collection in slot.tree.
    legMeta: new Map([[collectedAsset.toBase58(), { collection: wrongCollection }]]),
  })
  assert.deepEqual(plan.groups.flatMap((group) => group.slotIndexes), [0, 1])
  const instructions = plan.groups.flatMap((group) => group.instructions)
  const collected = instructions.find((instruction) => instruction.data?.[8] === 0)!
  const uncollected = instructions.find((instruction) => instruction.data?.[8] === 1)!
  assert.equal(collected.accounts?.[5].address, collectedAsset.toBase58())
  assert.equal(collected.accounts?.[6].address, collection.toBase58())
  assert.equal(uncollected.accounts?.[5].address, uncollectedAsset.toBase58())
  assert.equal(uncollected.accounts?.[6].address, PublicKey.default.toBase58())
  assert.ok(!instructions.some((instruction) => instruction.accounts?.some((account) =>
    account.address === wrongCollection.toBase58() || account.address === releasedAsset.toBase58())))
})

test('manual pNFT claim requires authenticated Oracle reconstruction metadata', () => {
  const maker = pk(); const taker = pk(); const mint = pk(); const ruleSet = pk()
  const state = committedState({ maker, taker, slots: [
    { side: SlotSide.Maker, kind: AssetKindV4.Programmable, status: SlotStatus.Deposited, identity: mint },
  ] })
  const args = { programId: pk(), sessionPda: pk(), state, participant: taker, payer: pk() }
  assert.throws(() => buildParticipantClaimPlan(args), /PNFT_AUTHORITATIVE_RELEASE_METADATA_REQUIRED/)
  const legMeta = new Map([[mint.toBase58(), {
    source: 'authenticated_oracle' as const, oracleSequence: '5', observedSlot: '50', ruleSet,
  }]])
  const plan = buildParticipantClaimPlan({ ...args, legMeta })
  const accounts = plan.groups[0].instructions[0].accounts!.map((account) => account.address)
  assert.ok(accounts.includes(ruleSet.toBase58()))
  assert.equal(accounts[0], args.payer.toBase58())
})

for (const slotsPerSide of [1, 8]) {
  test(`${slotsPerSide}x${slotsPerSide} interrupted entitlement delivery resumes only pending slots`, () => {
    const maker = pk(); const taker = pk(); const slots = [
      ...Array.from({ length: slotsPerSide }, (_, index) => ({
        side: SlotSide.Maker, kind: AssetKindV4.Spl,
        status: index % 2 === 0 ? SlotStatus.Released : SlotStatus.Deposited,
        identity: pk(),
      })),
      ...Array.from({ length: slotsPerSide }, (_, index) => ({
        side: SlotSide.Taker, kind: AssetKindV4.Spl,
        status: index % 2 === 0 ? SlotStatus.Deposited : SlotStatus.Released,
        identity: pk(),
      })),
    ]
    const state = committedState({ maker, taker, slots })
    const makerClaim = buildParticipantClaimPlan({ programId: pk(), sessionPda: pk(), state, participant: maker, payer: pk() })
    const takerClaim = buildParticipantClaimPlan({ programId: pk(), sessionPda: pk(), state, participant: taker, payer: pk() })
    const expectedMaker = slots.map((slot, index) => ({ slot, index }))
      .filter(({ slot }) => slot.side === SlotSide.Taker && slot.status === SlotStatus.Deposited).map(({ index }) => index)
    const expectedTaker = slots.map((slot, index) => ({ slot, index }))
      .filter(({ slot }) => slot.side === SlotSide.Maker && slot.status === SlotStatus.Deposited).map(({ index }) => index)
    assert.deepEqual(makerClaim.groups.flatMap((group) => group.slotIndexes), expectedMaker)
    assert.deepEqual(takerClaim.groups.flatMap((group) => group.slotIndexes), expectedTaker)
    assert.ok([...makerClaim.groups, ...takerClaim.groups].every((group) => group.phase === 'release'))
  })
}

test('cancel plan withdraws only Deposited slots then closes', () => {
  const maker = pk(); const taker = pk(); const mintA = pk(); const mintB = pk()
  const bytes = new Uint8Array(spaceFor(2))
  const view = new DataView(bytes.buffer)
  bytes.set(TRADE_SESSION_DISCRIMINATOR, 0)
  bytes.set(maker.toBytes(), SESSION_OFFSETS.maker)
  bytes.set(taker.toBytes(), SESSION_OFFSETS.taker)
  view.setUint8(SESSION_OFFSETS.phase, SessionPhase.MakerDepositing)
  view.setUint8(SESSION_OFFSETS.makerSlotCount, 2)
  view.setUint8(SESSION_OFFSETS.filledSlotCount, 2)
  view.setUint32(SESSION_OFFSETS.slotsVecLen, 2, true)
  const s0 = SESSION_OFFSETS.slots
  view.setUint8(s0, SlotSide.Maker); view.setUint8(s0 + 1, AssetKindV4.Spl); view.setUint8(s0 + 2, SlotStatus.Deposited)
  bytes.set(mintA.toBytes(), s0 + 3)
  const s1 = s0 + SLOT_LEN
  view.setUint8(s1, SlotSide.Maker); view.setUint8(s1 + 1, AssetKindV4.Spl); view.setUint8(s1 + 2, SlotStatus.Empty)
  bytes.set(mintB.toBytes(), s1 + 3)

  const state = decodeTradeSession(bytes)
  const plan = buildCancelPlan({
    programId: pk(), sessionPda: pk(), state, canceller: maker, cancellerRole: 'maker',
  })
  assert.deepEqual(plan.groups.map((g) => g.phase), ['cancel', 'withdraw', 'close'])
  assert.deepEqual(plan.groups[1].slotIndexes, [0])
})
