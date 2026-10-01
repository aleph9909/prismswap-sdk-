import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFileSync} from 'node:fs'
import {computeTradeV2Commitment, type TradeV2CommitmentInput} from '../src/protocol.js'
import * as session from '../src/session/index.js'
const idl=JSON.parse(readFileSync(new URL('../contracts/prismswap-session-v4.json',import.meta.url),'utf8'))
test('all ten session discriminators match the independent program IDL',()=>{
  assert.equal(idl.instructions.length,10)
  for(const ix of idl.instructions)assert.deepEqual([...session.anchorInstructionDiscriminator(ix.name)],ix.discriminator,ix.name)
})
test('session account discriminators and enum ordinals match the program IDL',()=>{
  const account=idl.accounts.find((a:{name:string})=>a.name==='TradeSession');assert.deepEqual([...session.TRADE_SESSION_DISCRIMINATOR],account.discriminator)
  for(const [name,values]of [['SessionPhase',session.SessionPhase],['SlotStatus',session.SlotStatus],['AssetKind',session.AssetKindV4]] as const){
    const variants=idl.types.find((t:{name:string})=>t.name===name).type.variants
    variants.forEach((v:{name:string},index:number)=>assert.equal(values[v.name as keyof typeof values],index,v.name))
  }
})
test('canonical commitment and domain bytes preserve the independently generated reference vector',()=>{
  const fixture=JSON.parse(readFileSync(new URL('../fixtures/commitment-v1.json',import.meta.url),'utf8'))
  assert.deepEqual(computeTradeV2Commitment(fixture.input as TradeV2CommitmentInput),fixture.result)
})
