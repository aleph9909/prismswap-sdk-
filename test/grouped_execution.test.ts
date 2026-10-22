import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHash } from 'node:crypto'
import { Buffer } from 'buffer'
import bs58 from 'bs58'
import { Keypair, PublicKey, VersionedTransaction, type Connection } from '@solana/web3.js'
import { PrismSwapClient, nextSessionGroup, knownRemainingSessionTransactions } from '../src/client.js'
import { createOffer, offerPlanInput, offerCommitment } from '../src/offers.js'
import { memoryPendingStore, PrismSwapSubmissionError } from '../src/pending.js'
import { CLUSTER_GENESIS_HASHES } from '../src/config.js'
import { SessionPhase, SlotStatus, AssetKindV4, buildSessionPlan, buildSessionPlanFromState, buildCancelPlan, deriveSessionAta, type TradeSessionState, type SessionTxGroup } from '../src/session/index.js'
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '../src/internal/token.js'
import type { SigningMetric } from '../src/signing-metrics.js'

function fixture(count = 8) {
  const maker = Keypair.generate(), taker = Keypair.generate(), programId = PublicKey.unique(), feeTreasury = PublicKey.unique()
  const assets = (['maker','taker'] as const).flatMap(side => Array.from({length:count},(_,index) => ({side,index,kind:index%2?'token2022' as const:'spl' as const,mint:PublicKey.unique().toBase58(),amount:'1' as const})))
  const offer = createOffer({cluster:'devnet',programId:programId.toBase58(),maker:maker.publicKey.toBase58(),taker:taker.publicKey.toBase58(),nonce:'9',expiresAt:'2099-01-01T00:00:00Z',assets})
  const input = offerPlanInput(offer,feeTreasury,taker.publicKey), plan = buildSessionPlan(input)
  const state: TradeSessionState = {maker:maker.publicKey,taker:taker.publicKey,nonce:9n,phase:SessionPhase.MakerDepositing,makerSlotCount:count,takerSlotCount:count,bump:plan.bump,makerSolAmount:0n,takerSolAmount:0n,expiresAt:input.expiresAt!,crankBondLamports:BigInt(count*2)*10000n,makerFeeEscrowed:0n,filledSlotCount:count*2,tradeCommitment:offerCommitment(offer),slots:[...input.makerLegs,...input.takerLegs].map((leg,i)=>({side:i<count?0:1,kind:leg.kind,status:SlotStatus.Empty,mintOrAssetId:leg.mintOrAssetId,tree:PublicKey.default,proofSize:0}))}
  return {maker,taker,programId,feeTreasury,offer,plan,state}
}

test('three eligible transfers stay packed; a completed gap removes only its instruction and ATA', () => {
  const f=fixture(), group=nextSessionGroup(f.plan,f.state,f.maker.publicKey,'continue')!
  assert.deepEqual(group.slotIndexes,[0,1,2]); assert.equal(group.instructions.length,3)
  const state={...f.state,slots:f.state.slots.map((s,i)=>({...s,status:i===1?SlotStatus.Deposited:s.status}))}
  const partial=nextSessionGroup(f.plan,state,f.maker.publicKey,'continue')!
  assert.deepEqual(partial.slotIndexes,[0,2]); assert.equal(partial.instructions.length,2)
  assert.deepEqual(partial.instructions,[group.instructions[0],group.instructions[2]])
  assert.deepEqual(partial.ataCreations.map(a=>a.mint.toBase58()),[0,2].map(i=>state.slots[i].mintOrAssetId.toBase58()))
  assert.match(partial.userFacing.title,/2 collectibles/)
})

test('claim filters every slot of a cross-recipient group, including when its first slot belongs to the other party', () => {
  const f=fixture(1), state={...f.state,phase:SessionPhase.Committed,slots:f.state.slots.map(s=>({...s,status:SlotStatus.Deposited}))}
  const plan=buildSessionPlanFromState({programId:f.programId,state,feeTreasury:f.feeTreasury,releasePayer:f.maker.publicKey})
  assert.deepEqual(plan.groups[0].slotIndexes,[0,1])
  const maker=nextSessionGroup(plan,state,f.maker.publicKey,'claim')!
  assert.deepEqual(maker.slotIndexes,[1]); assert.equal(maker.instructions.length,1)
  assert.equal(maker.ataCreations[0].owner.toBase58(),f.maker.publicKey.toBase58())
  const taker=nextSessionGroup(plan,state,f.taker.publicKey,'claim')!
  assert.deepEqual(taker.slotIndexes,[0])
  assert.equal(knownRemainingSessionTransactions(plan,state,f.maker.publicKey,'claim',maker),1)
  const claimed={...state,slots:state.slots.map((s,i)=>({...s,status:i===1?SlotStatus.Released:s.status}))}
  assert.equal(nextSessionGroup(plan,claimed,f.maker.publicKey,'claim'),null,'outgoing custody prevents close')
})

test('returns preserve grouping and omit completed slots across both depositors', () => {
  const f=fixture(), state={...f.state,phase:SessionPhase.Cancelling,slots:f.state.slots.map((s,i)=>({...s,status:i===1?SlotStatus.Withdrawn:SlotStatus.Deposited}))}
  const plan=buildCancelPlan({programId:f.programId,sessionPda:f.plan.sessionPda,state,canceller:f.maker.publicKey,cancellerRole:'maker'})
  const group=nextSessionGroup(plan,state,f.maker.publicKey,'continue')!
  assert.equal(group.phase,'withdraw'); assert.deepEqual(group.slotIndexes,[0,2,3])
  assert.equal(group.instructions.length,3)
})

// In-memory instruction-driven RPC model; this is not validator certification.
function rpcFixture(count=8) {
  const f=fixture(count), metrics:SigningMetric[]=[], receipts:SessionTxGroup[]=[]
  let state:TradeSessionState|null=null, prepared:SessionTxGroup|undefined, uncertain=false, recovered=false
  let walletRequests=0, broadcasts=0
  const config=new Uint8Array(135);config.set([155,12,170,224,30,250,204,130]);config.set(f.feeTreasury.toBytes(),92)
  const account=(data:Uint8Array,owner=f.programId,executable=false)=>({data:Buffer.from(data),owner,executable,lamports:1000,rentEpoch:0})
  const bytes=()=>{
    if(!state)return null
    const b=new Uint8Array(161+68*state.slots.length),v=new DataView(b.buffer)
    b.set(createHash('sha256').update('account:TradeSession').digest().subarray(0,8));b.set(state.maker.toBytes(),8);b.set(state.taker.toBytes(),40)
    v.setBigUint64(72,state.nonce,true);v.setUint8(80,state.phase);v.setUint8(81,count);v.setUint8(82,count);v.setUint8(83,state.bump)
    v.setBigInt64(100,state.expiresAt,true);v.setBigUint64(108,state.crankBondLamports,true);v.setUint8(124,state.filledSlotCount);b.set(state.tradeCommitment,125);v.setUint32(157,state.slots.length,true)
    state.slots.forEach((s,i)=>{const o=161+68*i;v.setUint8(o,s.side);v.setUint8(o+1,s.kind);v.setUint8(o+2,s.status);b.set(s.mintOrAssetId.toBytes(),o+3);b.set(s.tree.toBytes(),o+35);v.setUint8(o+67,s.proofSize)})
    return b
  }
  const connection={
    async getGenesisHash(){return CLUSTER_GENESIS_HASHES.devnet},
    async getAccountInfo(key:PublicKey){
      if(key.equals(f.programId))return account(new Uint8Array(),f.programId,true)
      const mint=f.state.slots.find(s=>s.mintOrAssetId.equals(key))
      if(mint){const b=new Uint8Array(82);new DataView(b.buffer).setBigUint64(36,1n,true);b[45]=1;return account(b,mint.kind===AssetKindV4.Token2022?TOKEN_2022_PROGRAM_ID:TOKEN_PROGRAM_ID)}
      for(const slot of f.state.slots){const token=slot.kind===AssetKindV4.Token2022?TOKEN_2022_PROGRAM_ID:TOKEN_PROGRAM_ID
        for(const owner of [f.maker.publicKey,f.taker.publicKey,f.plan.sessionPda])if(key.equals(deriveSessionAta(slot.mintOrAssetId,owner,token))){const b=new Uint8Array(165);b.set(slot.mintOrAssetId.toBytes());b.set(owner.toBytes(),32);new DataView(b.buffer).setBigUint64(64,1n,true);b[108]=1;return account(b,token)}}
      return account(config)
    },
    async getAccountInfoAndContext(){const b=bytes();return {context:{slot:10+broadcasts},value:b?account(b):null}},
    async getLatestBlockhash(){return {blockhash:PublicKey.unique().toBase58(),lastValidBlockHeight:10000}},
    async simulateTransaction(){return {context:{slot:10+broadcasts},value:{err:null}}},
    async getMinimumBalanceForRentExemption(){return 1000},async getBlockHeight(){return 10},
    async sendRawTransaction(raw:Uint8Array){
      const tx=VersionedTransaction.deserialize(raw),g=prepared!;assert.ok(raw.length<=1232);broadcasts++;receipts.push(g)
      assert.equal(tx.signatures.length,1);assert.ok(tx.signatures[0].some(b=>b!==0))
      if(g.phase==='create'){
        state??={...f.state,phase:SessionPhase.Building,slots:[],filledSlotCount:0}
        const filled=g.createStage!.appendedThroughSlotIndex+1
        state={...state,slots:f.state.slots.slice(0,filled),filledSlotCount:filled,phase:g.createStage!.includesFinalize?SessionPhase.MakerDepositing:SessionPhase.Building}
      }else if(g.phase==='makerDeposit'||g.phase==='takerDeposit'||g.phase==='release'||g.phase==='withdraw'){
        const before=state!,expected=g.phase.endsWith('Deposit')?SlotStatus.Empty:SlotStatus.Deposited
        for(const i of g.slotIndexes)assert.equal(before.slots[i].status,expected,`replayed ${g.phase} ${i}`)
        state={...before,slots:before.slots.map((s,i)=>g.slotIndexes.includes(i)?{...s,status:g.phase==='release'?SlotStatus.Released:g.phase==='withdraw'?SlotStatus.Withdrawn:SlotStatus.Deposited}:s)}
        if(g.phase==='makerDeposit'&&state.slots.slice(0,count).every(s=>s.status===SlotStatus.Deposited))state={...state,phase:SessionPhase.Open}
      }else if(g.phase==='startAccept')state={...state!,phase:SessionPhase.TakerDepositing}
      else if(g.phase==='commit'){assert.ok(state!.slots.every(s=>s.status===SlotStatus.Deposited));state={...state!,phase:SessionPhase.Committed}}
      else if(g.phase==='cancel')state={...state!,phase:SessionPhase.Cancelling}
      else if(g.phase==='close'){assert.ok(state!.slots.every(s=>s.status!==SlotStatus.Deposited));state=null}
      if(uncertain){recovered=true;throw new Error('Lost response after applying transaction')}
      return bs58.encode(tx.signatures[0])
    },
    async confirmTransaction(){return {context:{slot:10+broadcasts},value:{err:null}}},
    async getSignatureStatuses(){return {value:[recovered?{confirmationStatus:'confirmed',slot:10+broadcasts,err:null}:null]}},
  } as unknown as Connection
  const store=memoryPendingStore()
  const client=()=>new PrismSwapClient({connection,programId:f.programId,cluster:'devnet',pendingStore:store,onSigningMetric:m=>metrics.push(m)})
  const step=async(c:PrismSwapClient,actor:Keypair,action:'create'|'continue'|'cancel'|'claim'='continue')=>{
    const s=await c.prepareNext(f.offer,actor.publicKey,action);if(!s)return null
    prepared=s.group
    await c.executeStep(s,{publicKey:actor.publicKey,async signTransaction(tx){walletRequests++;tx.sign([actor]);return tx}},async()=>true)
    return s
  }
  return {...f,client,step,metrics,receipts,store,state:()=>state,counts:()=>({walletRequests,broadcasts}),uncertain:(v:boolean)=>{uncertain=v}}
}

test('8x8 standard mixed SPL/Token-2022 executes in 17 transactions through the real client with safe reload',async()=>{
  const h=rpcFixture(),maker=h.client(),taker=h.client()
  const first=await h.step(maker,h.maker,'create');assert.equal(first!.signingPlan.knownRemainingTransactions,5)
  const makerCounts=[first!.signingPlan.knownRemainingTransactions]
  while(h.state()!.phase!==SessionPhase.Open)makerCounts.push((await h.step(maker,h.maker))!.signingPlan.knownRemainingTransactions)
  assert.deepEqual(makerCounts,[5,4,3,2,1])
  assert.equal(h.counts().walletRequests,5)
  const accept=await h.step(taker,h.taker);assert.equal(accept!.signingPlan.knownRemainingTransactions,12)
  const takerCounts=[accept!.signingPlan.knownRemainingTransactions,(await h.step(taker,h.taker))!.signingPlan.knownRemainingTransactions]
  let resumed=h.client(),deliveryReloaded=false
  while(h.state()){
    const next=await h.step(resumed,h.taker);takerCounts.push(next!.signingPlan.knownRemainingTransactions)
    if(next!.group.phase==='release'&&!deliveryReloaded){resumed=h.client();deliveryReloaded=true}
  }
  assert.equal(deliveryReloaded,true)
  assert.deepEqual(takerCounts,Array.from({length:12},(_,i)=>12-i))
  assert.deepEqual(h.counts(),{walletRequests:17,broadcasts:17})
  const deposits=h.receipts.filter(g=>g.phase==='makerDeposit'||g.phase==='takerDeposit')
  assert.deepEqual(deposits.map(g=>g.slotIndexes.length),[3,3,2,3,3,2])
  for(const phase of ['makerDeposit','takerDeposit','release']){
    const indexes=h.receipts.filter(g=>g.phase===phase).flatMap(g=>g.slotIndexes)
    assert.equal(new Set(indexes).size,indexes.length,'no replay after reload')
  }
  assert.equal(h.metrics.filter(m=>m.kind==='walletRequest').length,17)
  assert.equal(h.metrics.filter(m=>m.kind==='signed').length,17)
})

test('grouped cancellation resumes returns without replaying slots or requesting a commit',async()=>{
  const h=rpcFixture(),c=h.client();await h.step(c,h.maker,'create');await h.step(c,h.maker)
  await h.step(c,h.maker);await h.step(c,h.maker)
  const cancellation=await h.step(c,h.maker,'cancel');assert.equal(cancellation!.signingPlan.knownRemainingTransactions,4)
  await h.step(c,h.maker)
  const reloaded=h.client();while(h.state())await h.step(reloaded,h.maker)
  const returned=h.receipts.filter(g=>g.phase==='withdraw').flatMap(g=>g.slotIndexes)
  assert.deepEqual(returned,[0,1,2,3,4,5]);assert.equal(h.receipts.some(g=>g.phase==='commit'),false)
})

test('lost grouped deposit response blocks a new signature until reconciliation, then skips all deposited slots',async()=>{
  const h=rpcFixture(),c=h.client();await h.step(c,h.maker,'create');await h.step(c,h.maker)
  h.uncertain(true);await assert.rejects(h.step(c,h.maker),PrismSwapSubmissionError)
  const before=h.counts();await assert.rejects(h.step(h.client(),h.maker),PrismSwapSubmissionError);assert.deepEqual(h.counts(),before)
  assert.equal((await c.reconcilePending()).status,'confirmed');h.uncertain(false)
  const next=await h.step(h.client(),h.maker);assert.deepEqual(next!.group.slotIndexes,[3,4,5])
  assert.equal(h.metrics.filter(m=>m.kind==='uncertain').length,1)
})

test('review-bound signing counts cannot be changed to misrepresent the transaction',async()=>{
  const h=rpcFixture(),c=h.client(),step=(await c.prepareNext(h.offer,h.maker.publicKey,'create'))!
  await assert.rejects(c.executeStep(step,{publicKey:h.maker.publicKey,async signTransaction(){assert.fail('must not sign changed review')}},async reviewed=>{
    (reviewed.signingPlan as {knownRemainingTransactions:number}).knownRemainingTransactions=1
    return true
  }),/TRANSACTION_CHANGED_AFTER_REVIEW/)
  assert.equal(h.metrics.filter(m=>m.kind==='walletRequest').length,0)
})
