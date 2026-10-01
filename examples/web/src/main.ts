import { Connection } from '@solana/web3.js'
import { PrismSwapClient, PrismSwapSubmissionError, createOffer, validateOffer, localStoragePendingStore, PRISMSWAP_DEVNET_PROGRAM_ID, PRISMSWAP_MAINNET_PROGRAM_ID, type PrismSwapOffer, type PrismSwapWallet, type PreparedPrismSwapStep, type DirectAsset, type PrismSwapCluster, type PrismSwapAction } from '@prismswap/escrow-sdk'
import { listPrismSwapWallets, connectPrismSwapWallet } from '@prismswap/escrow-sdk/wallet-standard'
import './style.css'
const el = <T extends HTMLElement>(id:string) => document.getElementById(id)! as T
const field = (id:string) => el<HTMLInputElement>(id).value.trim()
const show = (s:string) => { el('status').textContent=s }
const pretty = (v:unknown) => JSON.stringify(v,(_k,x)=>typeof x==='bigint'?x.toString():x,2)
let wallets = listPrismSwapWallets(), wallet:PrismSwapWallet|undefined, client:PrismSwapClient|undefined, offer:PrismSwapOffer|undefined, step:PreparedPrismSwapStep|undefined
function resetStep(){step=undefined;el<HTMLButtonElement>('sign').disabled=true;el('review').textContent='No transaction prepared.'}
const pendingStore=localStoragePendingStore(localStorage,'prismswap.example.pending.v1')
function detect(){wallets=listPrismSwapWallets();const select=el<HTMLSelectElement>('wallets');select.replaceChildren(...wallets.map((w,i)=>new Option(w.name,String(i))))}
function bind(id:string,fn:()=>Promise<void>|void){el(id).onclick=async()=>{try{await fn()}catch(error){resetStep();if(error instanceof PrismSwapSubmissionError){show(`Submission needs checking. Known signature: ${error.pending.signature}`)}else{const message=error instanceof Error?error.message:'';show(/^[A-Z0-9_]+$/.test(message)?message:'Request failed. Check your wallet and connection, then prepare again.')}}}}
el<HTMLSelectElement>('cluster').onchange=()=>{el<HTMLInputElement>('rpc').value=field('cluster')==='devnet'?'https://api.devnet.solana.com':'https://api.mainnet-beta.solana.com';el<HTMLInputElement>('program').value=field('cluster')==='devnet'?PRISMSWAP_DEVNET_PROGRAM_ID:PRISMSWAP_MAINNET_PROGRAM_ID;wallet=undefined;client=undefined;resetStep();el('account').textContent='Reconnect the wallet for this network.'}
bind('detect',detect)
bind('connect',async()=>{
  const selected=wallets[Number(field('wallets'))];if(!selected)throw new Error('INSTALL_A_SOLANA_WALLET')
  const cluster=field('cluster') as PrismSwapCluster
  if(!cluster)throw new Error('CHOOSE_NETWORK_EXPLICITLY')
  wallet=await connectPrismSwapWallet(selected,cluster)
  client=new PrismSwapClient({connection:new Connection(field('rpc'),'confirmed'),cluster,programId:field('program'),pendingStore})
  el('account').textContent=`Connected: ${wallet.publicKey.toBase58()}`;show('Connected. Load or create an offer, then prepare a step.')
})
bind('newOffer',()=>{
  if(!wallet||!client)throw new Error('CONNECT_WALLET_FIRST')
  const assets:DirectAsset[]=[]
  for(const side of ['maker','taker'] as const){
    const mints=field(`${side}Mints`).split(/\s+/).filter(Boolean)
    mints.forEach((mint,index)=>assets.push({side,index,kind:'spl',mint,amount:'1'}))
    const lamports=field(`${side}Sol`);if(!/^\d+$/.test(lamports))throw new Error('LAMPORTS_MUST_BE_WHOLE_NUMBERS')
    if(BigInt(lamports)>0n)assets.push({side,index:0,kind:'sol',lamports})
  }
  const expiry=new Date(Date.now()+24*60*60*1000);expiry.setMilliseconds(0)
  offer=createOffer({cluster:client.options.cluster,programId:client.programId.toBase58(),maker:wallet.publicKey.toBase58(),taker:field('taker'),assets,expiresAt:expiry.toISOString()})
  el<HTMLTextAreaElement>('offer').value=pretty(offer);localStorage.setItem('prismswap.example.offer.v1',pretty(offer));el<HTMLSelectElement>('action').value='create';resetStep();show('Offer prepared. Share exactly this JSON with the taker.')
})
bind('loadOffer',()=>{const raw:unknown=JSON.parse(field('offer'));validateOffer(raw);offer=raw;localStorage.setItem('prismswap.example.offer.v1',pretty(offer));el<HTMLSelectElement>('action').value='continue';resetStep();show('Offer loaded. Check the participants and amounts before approving.')})
bind('copyOffer',async()=>{await navigator.clipboard.writeText(field('offer'));show('Offer JSON copied.')})
bind('prepare',async()=>{
  resetStep();if(!client||!wallet||!offer)throw new Error('CONNECT_AND_LOAD_OFFER_FIRST')
  const prepared=await client.prepareNext(offer,wallet.publicKey,field('action') as PrismSwapAction)
  if(!prepared){show('No next step for this wallet. The counterparty may need to act.');return}
  step=prepared;el('review').textContent=pretty({action:step.group.userFacing,cluster:offer.cluster,program:offer.programId,session:step.session.toBase58(),payer:step.payer.toBase58(),terms:offer,protocolFees:step.fees,chainEvidence:'RPC observation; platform completion is not asserted'})
  el<HTMLButtonElement>('sign').disabled=false;show('Simulation passed. Review the terms and the current step.')
})
bind('sign',async()=>{
  if(!client||!wallet||!step)throw new Error('PREPARE_FIRST')
  const current=step;el<HTMLButtonElement>('sign').disabled=true
  const receipt=await client.executeStep(current,wallet,async reviewed=>confirm(`${reviewed.group.userFacing.title}\n${reviewed.group.userFacing.detail}\n\nNetwork: ${reviewed.offer.cluster}\nSession: ${reviewed.session.toBase58()}\nPayer: ${reviewed.payer.toBase58()}\n\nApprove this step?`))
  localStorage.setItem('prismswap.example.last-receipt.v1',pretty(receipt));if(field('action')==='create')el<HTMLSelectElement>('action').value='continue';resetStep();show(`Transaction confirmed on chain: ${receipt.signature}. Prepare again for the next step.`)
})
bind('checkPending',async()=>{if(!client)throw new Error('CONNECT_WALLET_FIRST');const result=await client.reconcilePending();show(pretty(result))})
el<HTMLTextAreaElement>('offer').value=localStorage.getItem('prismswap.example.offer.v1')??''
detect()
