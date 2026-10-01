import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Buffer } from 'buffer'
import { Connection, Keypair, PublicKey, type AccountInfo } from '@solana/web3.js'
import { PrismSwapClient, nextSessionGroup } from '../src/client.js'
import { createOffer, offerPlanInput, offerCommitment } from '../src/offers.js'
import { memoryPendingStore, PrismSwapSubmissionError } from '../src/pending.js'
import { CLUSTER_GENESIS_HASHES, readPrismSwapConfig } from '../src/config.js'
import { SessionPhase, SlotStatus, AssetKindV4, buildSessionPlan, deriveSessionPda, TRADE_SESSION_DISCRIMINATOR, SESSION_OFFSETS, SLOT_LEN, type TradeSessionState } from '../src/session/index.js'
const programId = PublicKey.unique()
const maker = Keypair.generate(), taker = Keypair.generate()
const offer = () => createOffer({cluster:'devnet',programId:programId.toBase58(),maker:maker.publicKey.toBase58(),taker:taker.publicKey.toBase58(),nonce:'7',tradeId:'00000000-0000-4000-8000-000000000001',proposalId:'00000000-0000-4000-8000-000000000002',expiresAt:'2099-01-01T00:00:00Z',assets:[{side:'maker',index:0,kind:'sol',lamports:'10'},{side:'taker',index:0,kind:'sol',lamports:'20'}]})
const info = (data:Uint8Array,owner=programId):AccountInfo<Buffer> => ({data:Buffer.from(data),owner,lamports:1000,executable:false,rentEpoch:0})
function stateBytes(o=offer(),phase:number=SessionPhase.Open) {
  const data=new Uint8Array(161),v=new DataView(data.buffer)
  data.set(TRADE_SESSION_DISCRIMINATOR);data.set(maker.publicKey.toBytes(),8);data.set(taker.publicKey.toBytes(),40)
  v.setBigUint64(72,BigInt(o.nonce),true);v.setUint8(80,phase);v.setUint8(83,deriveSessionPda(programId,maker.publicKey,taker.publicKey,BigInt(o.nonce))[1])
  v.setBigUint64(84,10n,true);v.setBigUint64(92,20n,true);v.setBigInt64(100,BigInt(Date.parse(o.expiresAt)/1000),true);data.set(offerCommitment(o),125)
  return data
}
function harness() {
  let data:Uint8Array|null=null, sendFailure=false, simulationError:unknown=null, walletCalls=0, broadcasts=0
  const config=new Uint8Array(135);config.set([155,12,170,224,30,250,204,130]);config.set(PublicKey.unique().toBytes(),92)
  let pendingStatus:unknown=null
  const connection = {
    async getGenesisHash(){return CLUSTER_GENESIS_HASHES.devnet},
    async getAccountInfo(address:PublicKey){return address.equals(programId)?{...info(new Uint8Array()),executable:true}:info(config)},
    async getAccountInfoAndContext(){return {context:{slot:5},value:data?info(data):null}},
    async getLatestBlockhash(){return {blockhash:PublicKey.unique().toBase58(),lastValidBlockHeight:100}},
    async simulateTransaction(){return {context:{slot:5},value:{err:simulationError}}},
    async getMinimumBalanceForRentExemption(){return 1000}, async getBlockHeight(){return 10},
    async sendRawTransaction(bytes:Uint8Array){broadcasts++;if(sendFailure)throw new Error('transport interrupted');const {default:bs58}=await import('bs58');const {VersionedTransaction}=await import('@solana/web3.js');return bs58.encode(VersionedTransaction.deserialize(bytes).signatures[0])},
    async confirmTransaction(){return {context:{slot:8},value:{err:null}}},
    async getSignatureStatuses(){return {value:[pendingStatus]}},
  } as unknown as Connection
  const store=memoryPendingStore(),client=new PrismSwapClient({connection,programId,cluster:'devnet',pendingStore:store})
  const wallet={publicKey:maker.publicKey,async signTransaction(tx:import('@solana/web3.js').VersionedTransaction){walletCalls++;tx.sign([maker]);return tx}}
  return {client,connection,store,wallet,config,setData(v:Uint8Array|null){data=v},setSendFailure(v:boolean){sendFailure=v},setSimulationError(v:unknown){simulationError=v},setPendingStatus(v:unknown){pendingStatus=v},counts(){return {walletCalls,broadcasts}}}
}
test('config decoder matches the frozen Config offsets',async()=>{
  const h=harness();new DataView(h.config.buffer).setBigUint64(124,1234n,true);new DataView(h.config.buffer).setUint16(132,321,true)
  const c=await readPrismSwapConfig(h.connection,programId);assert.equal(c.nftFeeLamports,1234n);assert.equal(c.solFeeBps,321)
})
test('config accepts known zero allocation padding and rejects unknown fields',async()=>{
  const h=harness(),padded=new Uint8Array(140);padded.set(h.config)
  const c={async getAccountInfo(){return info(padded)}} as unknown as Connection
  assert.equal((await readPrismSwapConfig(c,programId)).solFeeBps,0)
  padded[139]=1;await assert.rejects(readPrismSwapConfig(c,programId),/UNSUPPORTED_CONFIG_LAYOUT/)
})
test('create requires explicit maker action; RPC account absence never implies a completed trade',async()=>{
  const h=harness();await assert.rejects(h.client.prepareNext(offer(),maker.publicKey),/CREATE_REQUIRES_MAKER/)
  await assert.rejects(h.client.prepareNext(offer(),taker.publicKey,'create'),/CREATE_REQUIRES_MAKER/)
  const step=await h.client.prepareNext(offer(),maker.publicKey,'create');assert.equal(step?.group.phase,'create');assert.deepEqual(h.counts(),{walletCalls:0,broadcasts:0})
})
test('simulation failure prevents a wallet signature',async()=>{
  const h=harness();h.setSimulationError({InstructionError:[0,'Custom']});await assert.rejects(h.client.prepareNext(offer(),maker.publicKey,'create'),/SIMULATION_FAILED/);assert.equal(h.counts().walletCalls,0)
})
test('successful explicit review signs and broadcasts exactly once',async()=>{
  const h=harness(),step=(await h.client.prepareNext(offer(),maker.publicKey,'create'))!
  const result=await h.client.executeStep(step,h.wallet,async()=>true);assert.equal(result.authority,'rpc');assert.equal(result.slot,8);assert.deepEqual(h.counts(),{walletCalls:1,broadcasts:1});assert.equal(await h.store.get(),null)
  await assert.rejects(h.client.executeStep(step,h.wallet,async()=>true),/ALREADY_USED/)
})
test('declined review and review mutations stop before signing',async()=>{
  const h=harness(),step=(await h.client.prepareNext(offer(),maker.publicKey,'create'))!
  await assert.rejects(h.client.executeStep(step,h.wallet,async()=>false),/REVIEW_DECLINED/)
  const another=(await h.client.prepareNext(offer(),maker.publicKey,'create'))!
  await assert.rejects(h.client.executeStep(another,h.wallet,async s=>{(s.group as {label:string}).label='misleading';return true}),/CHANGED_AFTER_REVIEW/)
  assert.equal(h.counts().walletCalls,0)
})
test('fees and state are re-read after review',async()=>{
  const h=harness(),step=(await h.client.prepareNext(offer(),maker.publicKey,'create'))!
  await assert.rejects(h.client.executeStep(step,h.wallet,async()=>{h.setData(stateBytes());return true}),/SESSION_CHANGED/)
  h.setData(null);const another=(await h.client.prepareNext(offer(),maker.publicKey,'create'))!
  await assert.rejects(h.client.executeStep(another,h.wallet,async()=>{h.config[124]=1;return true}),/FEES_CHANGED/);assert.equal(h.counts().walletCalls,0)
})
test('uncertain broadcast persists the known signature and blocks all new signing until checked',async()=>{
  const h=harness(),step=(await h.client.prepareNext(offer(),maker.publicKey,'create'))!;h.setSendFailure(true)
  await assert.rejects(h.client.executeStep(step,h.wallet,async()=>true),e=>e instanceof PrismSwapSubmissionError && e.pending.signature.length>60)
  assert.ok(await h.store.get());await assert.rejects(h.client.prepareNext(offer(),maker.publicKey,'create'),PrismSwapSubmissionError)
  assert.equal((await h.client.reconcilePending()).status,'pending');assert.ok(await h.store.get());assert.equal(h.counts().broadcasts,1)
  h.setPendingStatus({confirmationStatus:'confirmed',slot:8,err:null});assert.equal((await h.client.reconcilePending()).status,'confirmed');assert.equal(await h.store.get(),null)
})
test('wrong RPC cluster, malformed account, and wrong terms fail closed',async()=>{
  const h=harness();h.connection.getGenesisHash=async()=>CLUSTER_GENESIS_HASHES['mainnet-beta'];await assert.rejects(h.client.prepareNext(offer(),maker.publicKey,'create'),/CLUSTER_MISMATCH/)
  h.connection.getGenesisHash=async()=>CLUSTER_GENESIS_HASHES.devnet;h.setData(new Uint8Array(161));await assert.rejects(h.client.prepareNext(offer(),taker.publicKey),/discriminator/)
  const changed=stateBytes();changed[125]^=1;h.setData(changed);await assert.rejects(h.client.prepareNext(offer(),taker.publicKey),/TERMS_MISMATCH/)
})
test('maker waits once funded; taker accepts; committed cannot cancel',async()=>{
  const h=harness();h.setData(stateBytes());assert.equal(await h.client.prepareNext(offer(),maker.publicKey),null)
  assert.equal((await h.client.prepareNext(offer(),taker.publicKey))?.group.phase,'startAccept')
  h.setData(stateBytes(offer(),SessionPhase.Committed));await assert.rejects(h.client.prepareNext(offer(),maker.publicKey,'cancel'),/CANNOT_BE_CANCELLED/)
})
test('partial packed deposits select only the unfinished token',()=>{
  const o=offer(),mint1=PublicKey.unique(),mint2=PublicKey.unique();const p=buildSessionPlan({...offerPlanInput(o,PublicKey.unique(),maker.publicKey),makerLegs:[{kind:AssetKindV4.Spl,mintOrAssetId:mint1},{kind:AssetKindV4.Spl,mintOrAssetId:mint2}]})
  const state={phase:SessionPhase.MakerDepositing,slots:[{status:SlotStatus.Deposited,mintOrAssetId:mint1},{status:SlotStatus.Empty,mintOrAssetId:mint2}]} as unknown as TradeSessionState
  const g=nextSessionGroup(p,state,maker.publicKey,'continue')!;assert.deepEqual(g.slotIndexes,[1]);assert.equal(g.instructions.length,1);assert.equal(g.ataCreations.length,1);assert.equal(g.ataCreations[0].mint.toBase58(),mint2.toBase58())
})
test('offer validation rejects non-unit tokens, duplicate mints, empty sides, advanced rails, and mismatched participants',()=>{
  const o=offer(),mint=PublicKey.unique().toBase58()
  assert.throws(()=>createOffer({...o,taker:o.maker}),/PARTICIPANTS/)
  assert.throws(()=>createOffer({...o,assets:[{side:'maker',index:0,kind:'spl',mint,amount:'2'},o.assets[1]]}),/UNIT_COLLECTIBLE/)
  assert.throws(()=>createOffer({...o,assets:[{side:'maker',index:0,kind:'spl',mint,amount:'1'},{side:'taker',index:0,kind:'spl',mint,amount:'1'}]}),/DUPLICATE_ASSET|UNIQUE_MINT/)
  assert.throws(()=>createOffer({...o,assets:[o.assets[0]]}),/BOTH_SIDES/)
})
