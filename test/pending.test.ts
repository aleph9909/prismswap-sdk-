import assert from 'node:assert/strict'
import {test} from 'node:test'
import {localStoragePendingStore, type PendingTransaction} from '../src/pending.js'
test('pending receipt survives a new browser adapter and refuses corrupted storage',async()=>{
  const data=new Map<string,string>()
  const storage={getItem(k:string){return data.get(k)??null},setItem(k:string,v:string){data.set(k,v)},removeItem(k:string){data.delete(k)}}
  const first=localStoragePendingStore(storage,'receipt')
  const receipt:PendingTransaction={signature:'public-signature-fixture',session:'public-session-fixture',programId:'program',cluster:'devnet',group:'create',blockhash:'blockhash',lastValidBlockHeight:100,createdAt:'2026-10-01T00:00:00Z'}
  await first.set(receipt);const reloaded=localStoragePendingStore(storage,'receipt');assert.deepEqual(await reloaded.get(),receipt)
  data.set('receipt','{}');await assert.rejects(reloaded.get(),/INVALID_PENDING_RECEIPT/)
  await reloaded.set(null);assert.equal(await first.get(),null)
})
