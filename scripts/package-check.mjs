import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
const root=process.cwd()
const [pack]=JSON.parse(execFileSync('npm',['pack','--json','--ignore-scripts'],{encoding:'utf8',maxBuffer:8*1024*1024}))
if(!pack.files.some(f=>f.path==='dist/index.js')||pack.files.some(f=>/^(src|test|node_modules)\//.test(f.path)||/\.env|keypair|\.map$/.test(f.path)))throw new Error('Unexpected package surface')
const dir=mkdtempSync(join(tmpdir(),'prismswap-consumer-'))
try {
  writeFileSync(join(dir,'package.json'),JSON.stringify({private:true,type:'module',dependencies:{'@prismswap/escrow-sdk':`file:${resolve(pack.filename)}`}}))
  execFileSync('npm',['install','--ignore-scripts','--omit=dev','--no-audit','--no-fund'],{cwd:dir,stdio:'pipe',timeout:120000})
  execFileSync(process.execPath,['--input-type=module','-e',"import {PrismSwapClient,createOffer} from '@prismswap/escrow-sdk';import {buildSessionPlan} from '@prismswap/escrow-sdk/session';import {listPrismSwapWallets} from '@prismswap/escrow-sdk/wallet-standard';if(!PrismSwapClient||!createOffer||!buildSessionPlan||!listPrismSwapWallets)process.exit(1)"],{cwd:dir,stdio:'pipe'})
  writeFileSync(join(dir,'consumer.ts'),"import {PrismSwapClient, type PrismSwapOffer} from '@prismswap/escrow-sdk'; import {buildSessionPlan} from '@prismswap/escrow-sdk/session'; export type Offer=PrismSwapOffer; export const client=PrismSwapClient; export const planner=buildSessionPlan;")
  execFileSync(process.execPath,[join(root,'node_modules/typescript/bin/tsc'),'consumer.ts','--noEmit','--strict','--skipLibCheck','--target','ES2022','--module','NodeNext','--moduleResolution','NodeNext'],{cwd:dir,stdio:'pipe'})
  console.log(`Packed package passed isolated import and TypeScript checks (${pack.files.length} files).`)
} finally { rmSync(dir,{recursive:true,force:true});rmSync(resolve(pack.filename),{force:true}) }
