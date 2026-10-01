import { Buffer } from 'buffer'
import { PublicKey, SystemProgram, TransactionInstruction, type Connection, type Commitment } from '@solana/web3.js'
import { isSome } from '@solana/kit'
import { getMintDecoder, getTokenDecoder } from '@solana-program/token'

export const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
export const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb')
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')

export function getAssociatedTokenAddressSync(mint: PublicKey, owner: PublicKey, allowOwnerOffCurve=false, programId=TOKEN_PROGRAM_ID): PublicKey {
  if (!allowOwnerOffCurve && !PublicKey.isOnCurve(owner.toBytes())) throw new Error('TOKEN_OWNER_OFF_CURVE')
  return PublicKey.findProgramAddressSync([owner.toBytes(),programId.toBytes(),mint.toBytes()],ASSOCIATED_TOKEN_PROGRAM_ID)[0]
}
export function createAssociatedTokenAccountIdempotentInstruction(payer:PublicKey,ata:PublicKey,owner:PublicKey,mint:PublicKey,programId=TOKEN_PROGRAM_ID):TransactionInstruction {
  const expected=getAssociatedTokenAddressSync(mint,owner,true,programId)
  if(!expected.equals(ata))throw new Error('NONCANONICAL_ASSOCIATED_TOKEN_ACCOUNT')
  return new TransactionInstruction({programId:ASSOCIATED_TOKEN_PROGRAM_ID,keys:[
    {pubkey:payer,isSigner:true,isWritable:true},{pubkey:ata,isSigner:false,isWritable:true},
    {pubkey:owner,isSigner:false,isWritable:false},{pubkey:mint,isSigner:false,isWritable:false},
    {pubkey:SystemProgram.programId,isSigner:false,isWritable:false},{pubkey:programId,isSigner:false,isWritable:false},
  ],data:Buffer.from([1])})
}
async function readTokenBytes(connection:Connection,address:PublicKey,commitment:Commitment,programId:PublicKey,size:number):Promise<Uint8Array> {
  const info=await connection.getAccountInfo(address,commitment)
  if(!info||!info.owner.equals(programId))throw new Error('TOKEN_ACCOUNT_MISSING_OR_WRONG_OWNER')
  // Direct rail is extension-free. Advanced Token-2022 allocations are excluded.
  if(info.data.length!==size)throw new Error('TOKEN_EXTENSIONS_OR_UNSUPPORTED_LAYOUT')
  return Uint8Array.from(info.data)
}
export async function getMint(connection:Connection,mint:PublicKey,commitment:Commitment='confirmed',programId=TOKEN_PROGRAM_ID) {
  const decoded=getMintDecoder().decode(await readTokenBytes(connection,mint,commitment,programId,82))
  if(!decoded.isInitialized)throw new Error('MINT_NOT_INITIALIZED')
  return {supply:decoded.supply,decimals:decoded.decimals,freezeAuthority:isSome(decoded.freezeAuthority)?new PublicKey(decoded.freezeAuthority.value):null,tlvData:new Uint8Array()}
}
export async function getAccount(connection:Connection,account:PublicKey,commitment:Commitment='confirmed',programId=TOKEN_PROGRAM_ID) {
  const decoded=getTokenDecoder().decode(await readTokenBytes(connection,account,commitment,programId,165))
  if(decoded.state!==1&&decoded.state!==2)throw new Error('TOKEN_ACCOUNT_NOT_INITIALIZED')
  return {mint:new PublicKey(decoded.mint),owner:new PublicKey(decoded.owner),amount:decoded.amount,isFrozen:decoded.state===2,delegate:isSome(decoded.delegate)?new PublicKey(decoded.delegate.value):null,tlvData:new Uint8Array()}
}
