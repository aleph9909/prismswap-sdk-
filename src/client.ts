import bs58 from 'bs58'
import { ComputeBudgetProgram, PublicKey, VersionedTransaction, type Connection } from '@solana/web3.js'
import { createAssociatedTokenAccountIdempotentInstruction, getMint, getAccount, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from './internal/token.js'
import { byteFingerprint, CLUSTER_GENESIS_HASHES, readPrismSwapConfig, type PrismSwapConfig } from './config.js'
import { offerCommitment, offerPlanInput, validateOffer, type PrismSwapOffer, type PrismSwapCluster } from './offers.js'
import { memoryPendingStore, PrismSwapSubmissionError, type PendingTransaction, type PendingTransactionStore } from './pending.js'
import { toTransactionInstruction } from './internal/instruction-convert.js'
import {
  SessionPhase, SlotStatus, buildSessionPlan, buildSessionPlanFromState,
  buildCancelPlan, buildSessionFeeBreakdown, decodeTradeSession, deriveSessionPda,
  deriveSessionAta, compileSessionTransaction, assertCanonicalSessionAtaBindings,
  getFinalizeManifestV4Instruction,
  type TradeSessionState, type SessionTxPlan, type SessionTxGroup,
} from './session/index.js'

export type PrismSwapWallet = {
  readonly publicKey: PublicKey
  /** Sign only; broadcasting is owned by the SDK after persisting the signature. */
  signTransaction(transaction: VersionedTransaction): Promise<VersionedTransaction>
}
export type PrismSwapAction = 'create' | 'continue' | 'cancel' | 'claim'
export type SessionObservation = { readonly address: PublicKey; readonly slot: number; readonly state: TradeSessionState; readonly fingerprint: string; readonly authority: 'rpc' }
export type PreparedPrismSwapStep = {
  readonly offer: PrismSwapOffer
  readonly session: PublicKey
  readonly payer: PublicKey
  readonly group: SessionTxGroup
  readonly transaction: VersionedTransaction
  readonly blockhash: string
  readonly lastValidBlockHeight: number
  readonly observedSlot: number
  readonly fees: ReturnType<typeof buildSessionFeeBreakdown>
  readonly chainAuthority: 'rpc'
}
type PreparedGuard = { readonly message: string; readonly semantics: string; readonly state: string | null; readonly config: string; used: boolean }
const preparedGuards = new WeakMap<PreparedPrismSwapStep, PreparedGuard>()
const equalBytes = (a: Uint8Array,b: Uint8Array) => a.length === b.length && a.every((v,i) => b[i] === v)
function semanticFingerprint(step: PreparedPrismSwapStep): string {
  return JSON.stringify({offer:step.offer,session:step.session.toBase58(),payer:step.payer.toBase58(),group:step.group,fees:step.fees,blockhash:step.blockhash,lastValidBlockHeight:step.lastValidBlockHeight,observedSlot:step.observedSlot},(_k,v) => typeof v === 'bigint' ? v.toString() : v)
}

/** Reduce a packed token group to one unfinished leg, so partial deposits never replay. */
function oneLeg(group: SessionTxGroup, state: TradeSessionState, status: number): SessionTxGroup | null {
  const position = group.slotIndexes.findIndex(i => state.slots[i]?.status === status)
  if (position < 0) return null
  const index = group.slotIndexes[position]
  if (group.instructions.length !== group.slotIndexes.length) throw new Error('UNSUPPORTED_PACKED_GROUP')
  const mint = state.slots[index].mintOrAssetId
  const verb = group.phase === 'release' ? 'Deliver' : group.phase === 'withdraw' ? 'Return' : 'Deposit'
  return { ...group, label:group.label+':slot-'+index, slotIndexes: [index], instructions: [group.instructions[position]], ataCreations: group.ataCreations.filter(a => a.mint.equals(mint)), userFacing:{title:`${verb} collectible ${index+1}`,detail:group.phase==='release'?'Delivers this one collectible to its fixed recipient.':group.phase==='withdraw'?'Returns this one collectible to its original depositor.':'Moves this one collectible into the session vault.'} }
}
/** Select only what the present session phase permits. No wallet or network side effects. */
export function nextSessionGroup(plan: SessionTxPlan, state: TradeSessionState | null, actor: PublicKey, action: PrismSwapAction): SessionTxGroup | null {
  const maker = actor.equals(plan.maker), taker = actor.equals(plan.taker)
  if (!state) {
    if (action !== 'create' || !maker) throw new Error('SESSION_ABSENT_CREATE_REQUIRES_MAKER')
    return plan.groups[0] ?? null
  }
  if (state.phase === SessionPhase.Closed) return null
  if (state.phase === SessionPhase.Committed && action === 'cancel') throw new Error('COMMITTED_TRADE_CANNOT_BE_CANCELLED')
  if (action === 'claim' && (!maker && !taker || state.phase !== SessionPhase.Committed)) throw new Error('CLAIM_REQUIRES_COMMITTED_PARTICIPANT')
  if (state.phase === SessionPhase.Building) {
    if (!maker) return null
    if (state.filledSlotCount === state.makerSlotCount + state.takerSlotCount) {
      return { label:'finalize-manifest', phase:'create', signerRole:'maker', slotIndexes:[], ataCreations:[], instructions:[getFinalizeManifestV4Instruction({programAddress:plan.programId,maker:plan.maker,session:plan.sessionPda})], userFacing:{title:'Finalize the trade manifest',detail:'Records the remaining manifest approval. No assets move.'} }
    }
    return plan.groups.find(g => g.phase === 'create' && g.createStage && !g.createStage.includesCreate && g.createStage.appendedThroughSlotIndex >= state.filledSlotCount) ?? null
  }
  if (state.phase === SessionPhase.MakerDepositing) {
    if (!maker) return null
    for (const g of plan.groups.filter(g => g.phase === 'makerDeposit')) { const leg = oneLeg(g,state,SlotStatus.Empty); if (leg) return leg }
    return null
  }
  if (state.phase === SessionPhase.Open) return taker ? plan.groups.find(g => g.phase === 'startAccept') ?? null : null
  if (state.phase === SessionPhase.TakerDepositing) {
    if (!taker) return null
    for (const g of plan.groups.filter(g => g.phase === 'takerDeposit')) { const leg = oneLeg(g,state,SlotStatus.Empty); if (leg) return leg }
    return plan.groups.find(g => g.phase === 'commit') ?? null
  }
  if (state.phase === SessionPhase.Committed || state.phase === SessionPhase.Cancelling) {
    const phase = state.phase === SessionPhase.Committed ? 'release' : 'withdraw'
    for (const g of plan.groups.filter(g => g.phase === phase)) {
      const leg = oneLeg(g,state,SlotStatus.Deposited)
      if (leg && (action !== 'claim' || (leg.slotIndexes[0] < plan.makerSlotCount ? taker : maker))) return leg
    }
    if (action === 'claim' && state.slots.some(s => s.status === SlotStatus.Deposited)) return null
    return plan.groups.find(g => g.phase === 'close') ?? null
  }
  throw new Error('UNSUPPORTED_SESSION_PHASE')
}

export class PrismSwapClient {
  readonly programId: PublicKey
  readonly pendingStore: PendingTransactionStore
  private busy = false
  private readonly minSlots = new Map<string,number>()
  constructor(readonly options: { readonly connection: Connection; readonly programId: string | PublicKey; readonly cluster: PrismSwapCluster; readonly expectedGenesisHash?: string; readonly pendingStore?: PendingTransactionStore }) {
    this.programId = new PublicKey(options.programId)
    this.pendingStore = options.pendingStore ?? memoryPendingStore()
    if (options.cluster === 'localnet' && !options.expectedGenesisHash) throw new Error('LOCALNET_REQUIRES_GENESIS_HASH')
  }
  private get connection() { return this.options.connection }
  async assertDomain(): Promise<void> {
    const expected = this.options.cluster === 'localnet' ? this.options.expectedGenesisHash : CLUSTER_GENESIS_HASHES[this.options.cluster]
    if (await this.connection.getGenesisHash() !== expected) throw new Error('RPC_CLUSTER_MISMATCH')
    const program = await this.connection.getAccountInfo(this.programId,'confirmed')
    if (!program?.executable) throw new Error('PROGRAM_NOT_DEPLOYED')
  }
  async readSession(session: PublicKey): Promise<SessionObservation | null> {
    const response = await this.connection.getAccountInfoAndContext(session,{commitment:'confirmed',minContextSlot:this.minSlots.get(session.toBase58())})
    const info = response.value
    if (!info) return null
    if (!info.owner.equals(this.programId)) throw new Error('SESSION_OWNER_MISMATCH')
    const state = decodeTradeSession(Uint8Array.from(info.data))
    const [canonical,bump] = deriveSessionPda(this.programId,state.maker,state.taker,state.nonce)
    if (!canonical.equals(session) || state.bump !== bump || state.filledSlotCount !== state.slots.length || state.makerSlotCount > 32 || state.takerSlotCount > 32) throw new Error('NONCANONICAL_SESSION')
    this.minSlots.set(session.toBase58(),response.context.slot)
    return {address:session,slot:response.context.slot,state,fingerprint:byteFingerprint(info.data),authority:'rpc'}
  }
  private assertOffer(offer: PrismSwapOffer) {
    validateOffer(offer)
    if (offer.cluster !== this.options.cluster || offer.programId !== this.programId.toBase58()) throw new Error('OFFER_DOMAIN_MISMATCH')
  }
  private bindObservation(offer: PrismSwapOffer, state: TradeSessionState, config: PrismSwapConfig, payer: PublicKey) {
    const input = offerPlanInput(offer,config.feeTreasury,payer)
    const legs = [...input.makerLegs,...input.takerLegs]
    if (!state.maker.equals(input.maker) || !state.taker.equals(input.taker) || state.nonce !== BigInt(offer.nonce) || !equalBytes(state.tradeCommitment,offerCommitment(offer)) || state.makerSolAmount !== input.makerSol || state.takerSolAmount !== input.takerSol || state.expiresAt !== input.expiresAt || state.makerSlotCount !== input.makerLegs.length || state.takerSlotCount !== input.takerLegs.length) throw new Error('SESSION_TERMS_MISMATCH')
    state.slots.forEach((s,i) => { const leg=legs[i]; if (!leg || s.side !== (i < input.makerLegs.length ? 0 : 1) || s.kind !== leg.kind || !s.mintOrAssetId.equals(leg.mintOrAssetId) || !s.tree.equals(PublicKey.default) || s.proofSize !== 0) throw new Error('SESSION_MANIFEST_MISMATCH') })
  }
  /** Admission checks are only applied to forward actions; exits stay available. */
  private async checkCollectibles(offer: PrismSwapOffer, state: TradeSessionState | null, session: PublicKey, group: SessionTxGroup) {
    if (!['create','makerDeposit','takerDeposit','commit'].includes(group.phase)) return
    for (const asset of offer.assets) {
      if (asset.kind === 'sol') continue
      const program = asset.kind === 'token2022' ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID
      const mint = new PublicKey(asset.mint)
      const decoded = await getMint(this.connection,mint,'confirmed',program)
      if (decoded.decimals !== 0 || decoded.supply !== 1n || decoded.freezeAuthority || decoded.tlvData.length) throw new Error('DIRECT_RAIL_REQUIRES_UNFROZEN_EXTENSION_FREE_UNIT_COLLECTIBLE')
      if (group.phase === 'create' || group.phase === 'commit' || group.slotIndexes.some(i => state?.slots[i]?.mintOrAssetId.equals(mint))) {
        const owner = group.phase === 'commit' ? session : new PublicKey(asset.side === 'maker' ? offer.maker : offer.taker)
        const account = await getAccount(this.connection,deriveSessionAta(mint,owner,program),'confirmed',program)
        if (!account.owner.equals(owner) || !account.mint.equals(mint) || account.amount !== 1n || account.isFrozen || account.delegate || account.tlvData.length) throw new Error('COLLECTIBLE_CUSTODY_OR_TRANSFERABILITY_MISMATCH')
      }
    }
  }
  async prepareNext(offer: PrismSwapOffer, actor: PublicKey, action: PrismSwapAction = 'continue'): Promise<PreparedPrismSwapStep | null> {
    if (this.busy) throw new Error('WALLET_ACTION_IN_PROGRESS')
    const pending = await this.pendingStore.get()
    if (pending) throw new PrismSwapSubmissionError(pending)
    this.assertOffer(offer); await this.assertDomain()
    const config = await readPrismSwapConfig(this.connection,this.programId)
    const plan = buildSessionPlan(offerPlanInput(offer,config.feeTreasury,actor))
    const observed = await this.readSession(plan.sessionPda)
    if (observed) this.bindObservation(offer,observed.state,config,actor)
    const state = observed?.state ?? null
    const expired = Date.parse(offer.expiresAt) <= Date.now()
    let activePlan = plan
    if (action === 'cancel' || state?.phase === SessionPhase.Cancelling) {
      if (!state) throw new Error('CANNOT_CANCEL_MISSING_SESSION')
      if (state.phase === SessionPhase.Committed || state.phase === SessionPhase.Closed) throw new Error('COMMITTED_TRADE_CANNOT_BE_CANCELLED')
      activePlan = buildCancelPlan({programId:this.programId,sessionPda:plan.sessionPda,state,canceller:actor,cancellerRole:actor.equals(plan.maker)?'maker':actor.equals(plan.taker)?'taker':'crank'})
    } else if (state?.phase === SessionPhase.Committed) {
      activePlan = buildSessionPlanFromState({programId:this.programId,state,feeTreasury:config.feeTreasury,releasePayer:actor})
    } else if (expired) throw new Error('OFFER_EXPIRED_USE_CANCEL')
    let group: SessionTxGroup | null
    if (activePlan.groups[0]?.phase === 'cancel') group = activePlan.groups[0]
    else group = nextSessionGroup(activePlan,state,actor,action)
    if (!group) return null
    await this.checkCollectibles(offer,state,plan.sessionPda,group)
    assertCanonicalSessionAtaBindings(group)
    const instructions = [ComputeBudgetProgram.setComputeUnitLimit({units:400_000}), ...group.ataCreations.map(a => createAssociatedTokenAccountIdempotentInstruction(actor,a.ata,a.owner,a.mint,a.tokenProgram)), ...group.instructions.map(toTransactionInstruction)]
    const latest = await this.connection.getLatestBlockhash('confirmed')
    const transaction = compileSessionTransaction({payer:actor,recentBlockhash:latest.blockhash,instructions,lookupTables:[]})
    const signers = transaction.message.staticAccountKeys.slice(0,transaction.message.header.numRequiredSignatures)
    if (signers.length !== 1 || !signers[0].equals(actor)) throw new Error('UNEXPECTED_TRANSACTION_SIGNER')
    const simulation = await this.connection.simulateTransaction(transaction,{commitment:'confirmed',sigVerify:false,minContextSlot:observed?.slot})
    if (!simulation.value || simulation.value.err) throw new Error('SIMULATION_FAILED:'+JSON.stringify(simulation.value?.err ?? 'malformed result'))
    const input = offerPlanInput(offer,config.feeTreasury,actor)
    const rent = await this.connection.getMinimumBalanceForRentExemption(161+68*(input.makerLegs.length+input.takerLegs.length),'confirmed')
    const step: PreparedPrismSwapStep = {offer:structuredClone(offer),session:plan.sessionPda,payer:actor,group,transaction,...latest,observedSlot:observed?.slot ?? simulation.context.slot,fees:buildSessionFeeBreakdown({config,makerNftCount:input.makerLegs.length,takerNftCount:input.takerLegs.length,makerSolLamports:input.makerSol,takerSolLamports:input.takerSol,rentLamports:BigInt(rent)}),chainAuthority:'rpc'}
    preparedGuards.set(step,{message:byteFingerprint(transaction.message.serialize()),semantics:semanticFingerprint(step),state:observed?.fingerprint ?? null,config:config.fingerprint,used:false})
    return step
  }
  /** One explicit review, one wallet signature, one broadcast. Never signs or resends automatically. */
  async executeStep(step: PreparedPrismSwapStep, wallet: PrismSwapWallet, review: (step: PreparedPrismSwapStep) => Promise<boolean>): Promise<{signature:string;slot:number;authority:'rpc'}> {
    if (this.busy) throw new Error('WALLET_ACTION_IN_PROGRESS')
    this.busy = true
    try {
      const guard = preparedGuards.get(step)
      if (!guard || guard.used) throw new Error('STEP_UNKNOWN_OR_ALREADY_USED')
      guard.used = true
      if (!wallet.publicKey.equals(step.payer)) throw new Error('WALLET_CHANGED')
      const pending = await this.pendingStore.get(); if (pending) throw new PrismSwapSubmissionError(pending)
      if (await review(step) !== true) throw new Error('REVIEW_DECLINED')
      if (byteFingerprint(step.transaction.message.serialize()) !== guard.message || semanticFingerprint(step) !== guard.semantics) throw new Error('TRANSACTION_CHANGED_AFTER_REVIEW')
      await this.assertDomain()
      const fresh = await this.readSession(step.session)
      if ((fresh?.fingerprint ?? null) !== guard.state) throw new Error('SESSION_CHANGED_PREPARE_AGAIN')
      const config = await readPrismSwapConfig(this.connection,this.programId)
      if (config.fingerprint !== guard.config) throw new Error('FEES_CHANGED_PREPARE_AGAIN')
      if (await this.connection.getBlockHeight('confirmed') > step.lastValidBlockHeight) throw new Error('BLOCKHASH_EXPIRED_PREPARE_AGAIN')
      const signed = await wallet.signTransaction(VersionedTransaction.deserialize(step.transaction.serialize()))
      if (!wallet.publicKey.equals(step.payer) || byteFingerprint(signed.message.serialize()) !== guard.message) throw new Error('WALLET_CHANGED_TRANSACTION')
      const signatureBytes = signed.signatures[0]
      if (!signatureBytes || signatureBytes.every(b => b === 0)) throw new Error('WALLET_DID_NOT_SIGN')
      const signature = bs58.encode(signatureBytes)
      const receipt: PendingTransaction = {signature,session:step.session.toBase58(),programId:this.programId.toBase58(),cluster:this.options.cluster,group:step.group.label,blockhash:step.blockhash,lastValidBlockHeight:step.lastValidBlockHeight,createdAt:new Date().toISOString()}
      await this.pendingStore.set(receipt) // Failure here stops before broadcast.
      try {
        const returned = await this.connection.sendRawTransaction(signed.serialize(),{skipPreflight:false,maxRetries:0,minContextSlot:step.observedSlot})
        if (returned !== signature) throw new Error('RPC_SIGNATURE_MISMATCH')
        const result = await this.connection.confirmTransaction({signature,blockhash:step.blockhash,lastValidBlockHeight:step.lastValidBlockHeight},'confirmed')
        if (result.value.err) throw new Error('TRANSACTION_FAILED:'+JSON.stringify(result.value.err))
        this.minSlots.set(receipt.session,result.context.slot)
        await this.pendingStore.set(null)
        return {signature,slot:result.context.slot,authority:'rpc'}
      } catch (cause) { throw new PrismSwapSubmissionError(receipt,{cause}) }
    } finally { this.busy = false }
  }
  /** Read only. Unknown signatures keep blocking new signing, even after blockhash expiry. */
  async reconcilePending(): Promise<{status:'none'|'pending'|'confirmed'|'failed';receipt?:PendingTransaction;slot?:number}> {
    if (this.busy) throw new Error('WALLET_ACTION_IN_PROGRESS')
    const receipt = await this.pendingStore.get(); if (!receipt) return {status:'none'}
    if (receipt.cluster !== this.options.cluster || receipt.programId !== this.programId.toBase58()) throw new Error('PENDING_RECEIPT_DOMAIN_MISMATCH')
    await this.assertDomain()
    const result = (await this.connection.getSignatureStatuses([receipt.signature],{searchTransactionHistory:true})).value[0]
    if (!result || result.confirmationStatus === 'processed' || !result.confirmationStatus) return {status:'pending',receipt}
    this.minSlots.set(receipt.session,result.slot)
    await this.pendingStore.set(null)
    return {status:result.err?'failed':'confirmed',receipt,slot:result.slot}
  }
}
