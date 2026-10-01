import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AddressLookupTableAccount, AddressLookupTableInstruction, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js'
import { AssetKindV4, buildSessionPlan } from '../src/session/index.js'
import * as session from '../src/session/index.js'

function lookup(f: ReturnType<typeof fixture>, addresses = session.sessionCommitLookupAddresses(f.instructions, f.payer), address = key(), lastExtendedSlot = 100) {
 return new AddressLookupTableAccount({key:address,state:{deactivationSlot:0xffffffffffffffffn,lastExtendedSlot,lastExtendedSlotStartIndex:0,authority:f.payer,addresses}})
}

test('confirmed cached table waits for finalized presence, complete coverage and a later finalized bank', async () => {
 const f=fixture(), confirmed=lookup(f)
 const incomplete=lookup(f,confirmed.state.addresses.slice(0,20),confirmed.key)
 const finalized=lookup(f,[...confirmed.state.addresses].reverse(),confirmed.key)
 let reads=0,slots=0
 const tables=await session.prepareSessionCommitLookupTable({...f,lookupTableAddress:confirmed.key,
  connection:{getAddressLookupTable:async(_address,config)=>{
   if(config?.commitment!=='finalized') return {context:{slot:101},value:confirmed}
   reads++;return {context:{slot:101},value:reads===1?null:reads===2?incomplete:finalized}
  },getSlot:async(commitment)=>{assert.equal(commitment,'finalized');return ++slots===1?100:101}},
  sendSetup:async()=>{throw new Error('cached complete table must not create or extend')},
 })
 assert.ok(reads>=4,'must not accept confirmed, absent, partial, or same-slot finalized state')
 assert.equal(tables[0],finalized,'return the actual finalized account, not its confirmed/cache ordering')
 const tx=session.compileSessionTransaction({...f,lookupTables:tables,recentBlockhash:key().toBase58()})
 const resolved=tx.message.getAccountKeys({addressLookupTableAccounts:[finalized]})
 assert.deepEqual(Array.from(tx.message.compiledInstructions[0].accountKeyIndexes,i=>resolved.get(i)!.toBase58()),f.instructions[0].keys.map(k=>k.pubkey.toBase58()))
})

test('configured v0 tables cannot bypass finalized reload and use actual address order', async () => {
 const f=fixture(), cached=lookup(f), finalized=lookup(f,[...cached.state.addresses].reverse(),cached.key)
 const unused=lookup(f,[])
 let reads=0
 const tables=await session.prepareSessionCommitLookupTable({...f,lookupTables:[cached,cached,unused],
  connection:{getSlot:async c=>{assert.equal(c,'finalized');return 101},getAddressLookupTable:async(address,config)=>{
   assert.equal(config?.commitment,'finalized');assert.ok(address.equals(cached.key));reads++
   return {context:{slot:101},value:finalized}
  }},sendSetup:async()=>{throw new Error('no setup for configured table')},
 })
 assert.equal(reads,1,'deduplicate used table; do not fetch unused tables')
 assert.deepEqual(tables,[finalized])
 const tx=session.compileSessionTransaction({...f,lookupTables:tables,recentBlockhash:key().toBase58()})
 const resolved=tx.message.getAccountKeys({addressLookupTableAccounts:[finalized]})
 assert.deepEqual(Array.from(tx.message.compiledInstructions[0].accountKeyIndexes,i=>resolved.get(i)!.toBase58()),f.instructions[0].keys.map(k=>k.pubkey.toBase58()))
})

test('finalized absence times out deterministically within the caller readiness budget', async () => {
 const f=fixture(),cached=lookup(f)
 let reads=0
 await assert.rejects(session.prepareSessionCommitLookupTable({...f,lookupTableAddress:cached.key,
  readiness:{timeoutMs:0,pollIntervalMs:1},
  connection:{getSlot:async()=>101,getAddressLookupTable:async(_address,config)=>{
   if(config?.commitment==='finalized'){reads++;return {context:{slot:101},value:null}}
   return {context:{slot:101},value:cached}
  }},sendSetup:async()=>{throw new Error('must not recreate confirmed table')},
 }),{message:'SESSION_COMMIT_LOOKUP_NOT_READY'})
 assert.equal(reads,1,'zero budget performs exactly one finalized readiness check')
})

test('readiness deadline also bounds slow finalized RPCs', async () => {
 const f=fixture(),cached=lookup(f)
 await assert.rejects(session.prepareSessionCommitLookupTable({...f,lookupTables:[cached],readiness:{timeoutMs:1,pollIntervalMs:1},
  connection:{getSlot:async()=>101,getAddressLookupTable:async()=>{
   await new Promise(resolve=>setTimeout(resolve,25));return {context:{slot:101},value:cached}
  }},sendSetup:async()=>{throw new Error('unexpected setup')},
 }),{message:'SESSION_COMMIT_LOOKUP_NOT_READY'})
})

for (const stalled of ['cached confirmed', 'creation slot', 'derived confirmed']) {
 test(`readiness bounds stalled preliminary ${stalled} RPC`, async () => {
  const f=fixture(),cached=lookup(f)
  let reached=false
  const stall=()=>{reached=true;return new Promise<never>(()=>{})}
  let guard: ReturnType<typeof setTimeout> | undefined
  try {
   await assert.rejects(Promise.race([
    session.prepareSessionCommitLookupTable({...f,
     lookupTableAddress:stalled==='cached confirmed'?cached.key:undefined,
     readiness:{timeoutMs:100,pollIntervalMs:1},
     connection:{getSlot:async()=>stalled==='creation slot'?stall():101,
      getAddressLookupTable:async()=>stall()},
     sendSetup:async()=>{throw new Error('unexpected setup')},
    }),
    new Promise<never>((_resolve,reject)=>{guard=setTimeout(()=>reject(new Error('TEST_OUTER_GUARD')),400)}),
   ]),{message:'SESSION_COMMIT_LOOKUP_NOT_READY'})
   assert.ok(reached,'must reach the targeted stalled preliminary RPC')
  } finally {clearTimeout(guard)}
 })
}

test('preliminary RPC time is not reset before finalized readiness', async t => {
 const f=fixture(),cached=lookup(f)
 let now=0
 t.mock.method(Date,'now',()=>now)
 await assert.rejects(session.prepareSessionCommitLookupTable({...f,lookupTableAddress:cached.key,readiness:{timeoutMs:10},
  connection:{getSlot:async()=>{now=10;return 101},getAddressLookupTable:async(_address,config)=>{
   if(config?.commitment==='confirmed') now=8
   return {context:{slot:101},value:cached}
  }},sendSetup:async()=>{throw new Error('unexpected setup')},
 }),{message:'SESSION_COMMIT_LOOKUP_NOT_READY'})
})

test('resolved preliminary RPC at deadline cannot start wallet setup', async t => {
 const f=fixture()
 let now=0,setups=0
 t.mock.method(Date,'now',()=>now)
 await assert.rejects(session.prepareSessionCommitLookupTable({...f,readiness:{timeoutMs:10},
  connection:{getSlot:async()=>{now=10;return 101},getAddressLookupTable:async()=>{throw new Error('expired read reached next RPC')}},
  sendSetup:async()=>{setups++;return 'setup'},
 }),{message:'SESSION_COMMIT_LOOKUP_NOT_READY'})
 assert.equal(setups,0)
})

test('invalid readiness budgets fail closed before RPC or setup', async () => {
 const f=fixture(),cached=lookup(f)
 for(const readiness of [{timeoutMs:Infinity},{timeoutMs:NaN},{timeoutMs:-1},{timeoutMs:90_001},{pollIntervalMs:0},{pollIntervalMs:Infinity},{pollIntervalMs:-1}]) {
  await assert.rejects(session.prepareSessionCommitLookupTable({...f,lookupTables:[cached],readiness,
   connection:{getSlot:async()=>{throw new Error('invalid options reached RPC')},getAddressLookupTable:async()=>{throw new Error('invalid options reached RPC')}},
   sendSetup:async()=>{throw new Error('unexpected setup')},
  }),{message:'SESSION_COMMIT_LOOKUP_INVALID_READINESS'})
 }
})

test('configured finalized coverage, activity and warmup failures never fall back to cache', async () => {
 const f=fixture(),cached=lookup(f)
 const partial=lookup(f,cached.state.addresses.slice(0,20),cached.key)
 const inactive=lookup(f,cached.state.addresses,cached.key);inactive.state.deactivationSlot=101n
 for(const [value,slot,error] of [[null,101,'SESSION_COMMIT_LOOKUP_NOT_READY'],[partial,101,'SESSION_COMMIT_LOOKUP_NOT_READY'],[cached,100,'SESSION_COMMIT_LOOKUP_NOT_READY'],[inactive,101,'SESSION_COMMIT_LOOKUP_INACTIVE']] as const) {
  await assert.rejects(session.prepareSessionCommitLookupTable({...f,lookupTables:[cached],readiness:{timeoutMs:0},
   connection:{getSlot:async c=>{assert.equal(c,'finalized');return slot},getAddressLookupTable:async(_address,config)=>{
    assert.equal(config?.commitment,'finalized');return {context:{slot},value}
   }},sendSetup:async()=>{throw new Error('must not create on readiness failure')},
  }),{message:error})
 }
})

test('default readiness budget accommodates 60 seconds of finalization lag and ends at 90 seconds', async t => {
 const f=fixture(),cached=lookup(f)
 let now=0,reads=0
 t.mock.method(Date,'now',()=>now)
 await assert.rejects(session.prepareSessionCommitLookupTable({...f,lookupTables:[cached],readiness:{pollIntervalMs:1},
  connection:{getSlot:async()=>101,getAddressLookupTable:async()=>{
   reads++;now=reads===1?60_000:90_000;return {context:{slot:101},value:null}
  }},sendSetup:async()=>{throw new Error('unexpected setup')},
 }),{message:'SESSION_COMMIT_LOOKUP_NOT_READY'})
 assert.equal(reads,2,'must continue past 60s but stop at the default 90s budget')
})

test('ready response arriving at the deadline cannot turn timeout into success', async t => {
 const f=fixture(),cached=lookup(f)
 let now=0
 t.mock.method(Date,'now',()=>now)
 await assert.rejects(session.prepareSessionCommitLookupTable({...f,lookupTables:[cached],readiness:{timeoutMs:10},
  connection:{getSlot:async()=>{now=10;return 101},getAddressLookupTable:async()=>({context:{slot:101},value:cached})},
  sendSetup:async()=>{throw new Error('unexpected setup')},
 }),{message:'SESSION_COMMIT_LOOKUP_NOT_READY'})
})

const key = () => PublicKey.unique()
function fixture(count = 8, sharedCollection = false) {
  const maker = key(), payer = key(), collection = key()
  const leg = () => ({ kind: AssetKindV4.Core, mintOrAssetId: key(), collection: sharedCollection ? collection : key() })
  const plan = buildSessionPlan({ maker, taker: payer, nonce: 1n, tradeCommitment: new Uint8Array(32).fill(1), makerLegs: Array.from({length: count}, leg), takerLegs: Array.from({length: count}, leg), makerSol: 0n, takerSol: 0n, expiresAt: 0, feeTreasury: key() })
  const group = plan.groups.find(g => g.phase === 'commit')!
  const instructions = group.instructions.map(ix => new TransactionInstruction({programId: new PublicKey(ix.programAddress), data: Buffer.from(ix.data!), keys: ix.accounts!.map(a => ({pubkey:new PublicKey(a.address),isSigner:!!(a.role&2),isWritable:!!(a.role&1)}))}))
  return {payer,instructions,plan}
}

test('8x8 distinct Core commit prepares a real-address lookup construction below packet limit', async () => {
  const f = fixture()
  const legacy = new VersionedTransaction(new TransactionMessage({payerKey:f.payer,recentBlockhash:key().toBase58(),instructions:f.instructions}).compileToLegacyMessage())
  assert.ok(legacy.serialize().length > 1232, 'reproduces actual oversized legacy wire')
  assert.equal(typeof (session as any).prepareSessionCommitLookupTable, 'function', 'wallet-paid commit table preparation is missing')
  let table: AddressLookupTableAccount | null = null
  let slot = 100
  const setups: TransactionInstruction[][] = []
  const connection = { getSlot: async () => ++slot, getAddressLookupTable: async () => ({context:{slot},value:table}) } as any
  const tables = await (session as any).prepareSessionCommitLookupTable({ ...f, connection,
    sendSetup: async (instructions: TransactionInstruction[]) => {
      setups.push(instructions)
      for (const ix of instructions) {
        const type = AddressLookupTableInstruction.decodeInstructionType(ix)
        if (type === 'CreateLookupTable') table = new AddressLookupTableAccount({key:ix.keys[0].pubkey,state:{deactivationSlot:0xffffffffffffffffn,lastExtendedSlot:slot,lastExtendedSlotStartIndex:0,authority:f.payer,addresses:[]}})
        if (type === 'ExtendLookupTable') table!.state.addresses.push(...AddressLookupTableInstruction.decodeExtendLookupTable(ix).addresses)
      }
      return 'local-fixture-setup'
    },
  })
  assert.equal(setups.length, 2)
  for (const instructions of setups) {
    const tx = new VersionedTransaction(new TransactionMessage({payerKey:f.payer,recentBlockhash:key().toBase58(),instructions}).compileToLegacyMessage())
    assert.ok(tx.serialize().length <= 1232)
  }
  const tx = (session as any).compileSessionTransaction({...f,lookupTables:tables,recentBlockhash:key().toBase58()}) as VersionedTransaction
  assert.equal(tx.version, 0)
  assert.ok(tx.serialize().length <= 1232)
  const resolved = tx.message.getAccountKeys({addressLookupTableAccounts:tables})
  const compiled = tx.message.compiledInstructions[0]
  assert.deepEqual(Array.from(compiled.accountKeyIndexes, i => resolved.get(i)!.toBase58()), f.instructions[0].keys.map(k=>k.pubkey.toBase58()), 'manifest order and duplicates preserved through lookup compilation')
})

test('same finalized-slot retry reloads an existing derived table instead of duplicate creation', async () => {
  const {AddressLookupTableProgram} = await import('@solana/web3.js')
  const f = fixture()
  const [,address] = AddressLookupTableProgram.createLookupTable({payer:f.payer,authority:f.payer,recentSlot:200})
  const table = new AddressLookupTableAccount({key:address,state:{deactivationSlot:0xffffffffffffffffn,lastExtendedSlot:199,lastExtendedSlotStartIndex:0,authority:f.payer,addresses:session.sessionCommitLookupAddresses(f.instructions,f.payer)}})
  const tables = await session.prepareSessionCommitLookupTable({...f,connection:{getSlot:async()=>200,getAddressLookupTable:async()=>({context:{slot:200},value:table})},sendSetup:async()=>{throw new Error('duplicate creation')}})
  assert.equal(tables.at(-1)!.key.toBase58(),address.toBase58())
})

test('small and same-collection commits need no new wallet-paid lookup table', async () => {
 for(const f of [fixture(1),fixture(8,true)]) {
  const tables = await session.prepareSessionCommitLookupTable({...f,connection:{getSlot:async()=>{throw new Error('unexpected RPC')},getAddressLookupTable:async()=>{throw new Error('unexpected RPC')}},sendSetup:async()=>{throw new Error('unexpected signature')}})
  assert.deepEqual(tables,[])
 }
})

test('partially prepared table extends only missing keys, reuses stable indexes and waits past extension slot',async()=>{
 const f=fixture(),keys=session.sessionCommitLookupAddresses(f.instructions,f.payer),address=key()
 const table=new AddressLookupTableAccount({key:address,state:{deactivationSlot:0xffffffffffffffffn,lastExtendedSlot:100,lastExtendedSlotStartIndex:0,authority:f.payer,addresses:keys.slice(0,20)}})
 let slot=99,setups=0
 const tables=await session.prepareSessionCommitLookupTable({...f,lookupTableAddress:address,connection:{getSlot:async()=>++slot,getAddressLookupTable:async()=>({context:{slot},value:table})},sendSetup:async ixs=>{
  setups++;assert.equal(ixs.length,1);const extension=AddressLookupTableInstruction.decodeExtendLookupTable(ixs[0]);assert.deepEqual(extension.addresses.map(k=>k.toBase58()),keys.slice(20).map(k=>k.toBase58()));table.state.addresses.push(...extension.addresses);return 'partial-setup'
 }})
 assert.equal(setups,1);assert.ok(slot>100);assert.deepEqual(tables[0].state.addresses,keys)
})

test('dedicated table takes priority over fragmented configured tables to preserve the packet bound',async()=>{
 const f=fixture(),keys=session.sessionCommitLookupAddresses(f.instructions,f.payer),address=key()
 const state={deactivationSlot:0xffffffffffffffffn,lastExtendedSlot:1,lastExtendedSlotStartIndex:0,authority:f.payer}
 const dedicated=new AddressLookupTableAccount({key:address,state:{...state,addresses:keys}})
 const fragmented=keys.map(k=>new AddressLookupTableAccount({key:key(),state:{...state,addresses:[k]}}))
 const tables=await session.prepareSessionCommitLookupTable({...f,lookupTables:fragmented,lookupTableAddress:address,connection:{getSlot:async()=>100,getAddressLookupTable:async()=>({context:{slot:100},value:dedicated})},sendSetup:async()=>{throw new Error('no setup required')}})
 const tx=session.compileSessionTransaction({...f,lookupTables:tables,recentBlockhash:key().toBase58()})
 assert.equal(tx.message.addressTableLookups.length,1)
 assert.ok(tx.serialize().length<=1232)
})
