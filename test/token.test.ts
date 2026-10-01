import assert from 'node:assert/strict'
import {test} from 'node:test'
import {Buffer} from 'buffer'
import {PublicKey,type Connection} from '@solana/web3.js'
import {getMintEncoder,getTokenEncoder} from '@solana-program/token'
import {address} from '@solana/kit'
import {getMint,getAccount,TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID,ASSOCIATED_TOKEN_PROGRAM_ID,createAssociatedTokenAccountIdempotentInstruction,getAssociatedTokenAddressSync} from '../src/internal/token.js'
const mint=PublicKey.unique(),owner=PublicKey.unique()
function connection(data:Uint8Array,program=TOKEN_PROGRAM_ID){return {async getAccountInfo(){return {data:Buffer.from(data),owner:program}}} as unknown as Connection}
test('official mint codec verifies supply/decimals/freeze and exact extension-free layouts',async()=>{
  const bytes=Uint8Array.from(getMintEncoder().encode({mintAuthority:null,supply:1n,decimals:0,isInitialized:true,freezeAuthority:null}))
  assert.equal(bytes.length,82);const decoded=await getMint(connection(bytes),mint);assert.equal(decoded.supply,1n);assert.equal(decoded.freezeAuthority,null)
  const extended=new Uint8Array(83);extended.set(bytes);await assert.rejects(getMint(connection(extended,TOKEN_2022_PROGRAM_ID),mint,'confirmed',TOKEN_2022_PROGRAM_ID),/EXTENSIONS/)
  await assert.rejects(getMint(connection(bytes,TOKEN_2022_PROGRAM_ID),mint),/WRONG_OWNER/)
})
test('official token codec verifies exact owner/principal/delegate/frozen status',async()=>{
  const bytes=Uint8Array.from(getTokenEncoder().encode({mint:address(mint.toBase58()),owner:address(owner.toBase58()),amount:1n,delegate:null,state:1,isNative:null,delegatedAmount:0n,closeAuthority:null}))
  assert.equal(bytes.length,165);const decoded=await getAccount(connection(bytes),PublicKey.unique());assert.equal(decoded.owner.toBase58(),owner.toBase58());assert.equal(decoded.amount,1n);assert.equal(decoded.isFrozen,false)
  bytes[108]=2;assert.equal((await getAccount(connection(bytes),PublicKey.unique())).isFrozen,true)
})
test('idempotent associated-token setup preserves the public instruction ABI and rejects wrong destinations',()=>{
  const payer=PublicKey.unique(),ata=getAssociatedTokenAddressSync(mint,owner,true)
  const ix=createAssociatedTokenAccountIdempotentInstruction(payer,ata,owner,mint)
  assert.equal(ix.programId.toBase58(),ASSOCIATED_TOKEN_PROGRAM_ID.toBase58());assert.deepEqual([...ix.data],[1]);assert.equal(ix.keys.length,6);assert.equal(ix.keys[0].isSigner,true);assert.equal(ix.keys[1].pubkey.toBase58(),ata.toBase58())
  assert.throws(()=>createAssociatedTokenAccountIdempotentInstruction(payer,PublicKey.unique(),owner,mint),/NONCANONICAL/)
})
