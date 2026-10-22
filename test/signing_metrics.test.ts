import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSigningMetrics, type SigningMetric } from '../src/signing-metrics.js'

test('reviews, wallet requests, transaction signatures and auth messages have distinct counters',()=>{
  let clock=100
  const events:SigningMetric[]=[],m=createSigningMetrics(e=>events.push(e),()=>clock)
  m.record('review','makerDeposit');clock+=25;m.record('walletRequest','makerDeposit','trade',3)
  m.record('signed','makerDeposit','trade',3);m.record('broadcast','makerDeposit');m.record('confirmed','makerDeposit')
  m.record('authentication',null,'authentication',0)
  const last=events.at(-1)!
  assert.equal(last.counters.review,1);assert.equal(last.counters.walletRequest,1);assert.equal(last.counters.signed,3)
  assert.equal(last.counters.authentication,1);assert.equal(last.transactionCount,0);assert.equal(last.elapsedMs,25)
  assert.equal(events[0].counters.signed,0,'snapshots are not mutated by later events')
  assert.deepEqual(Object.keys(last).sort(),['schema','kind','category','phase','elapsedMs','transactionCount','counters'].sort())
})
test('diagnostic consumers cannot throw into execution or create unhandled rejections',async()=>{
  assert.doesNotThrow(()=>createSigningMetrics(()=>{throw new Error('offline')}).record('walletRequest','commit'))
  createSigningMetrics(async()=>{throw new Error('offline')}).record('walletRequest','commit')
  await new Promise(resolve=>setTimeout(resolve,0))
})
