import { getWallets } from '@wallet-standard/app'
import { PublicKey, VersionedTransaction } from '@solana/web3.js'
import type { PrismSwapWallet } from './client.js'
import type { PrismSwapCluster } from './offers.js'
type StandardWallet = ReturnType<ReturnType<typeof getWallets>['get']>[number]
export function listPrismSwapWallets() { return getWallets().get().filter(w => 'standard:connect' in w.features && 'solana:signTransaction' in w.features) }
/** Host chooses the wallet; select an address explicitly when it exposes multiple accounts. */
export async function connectPrismSwapWallet(wallet: StandardWallet, cluster: PrismSwapCluster, address?: string): Promise<PrismSwapWallet> {
  const feature = wallet.features['standard:connect'] as { connect(): Promise<{accounts:StandardWallet['accounts']}> }
  const {accounts} = await feature.connect()
  const chain = cluster === 'mainnet-beta' ? 'solana:mainnet' : `solana:${cluster}`
  const compatible = accounts.filter(a => a.chains.includes(chain as `${string}:${string}`) && a.features.includes('solana:signTransaction'))
  const account = address ? compatible.find(a => a.address === address) : compatible.length === 1 ? compatible[0] : undefined
  if (!account) throw new Error('CHOOSE_ONE_COMPATIBLE_WALLET_ACCOUNT')
  const sign = wallet.features['solana:signTransaction'] as { signTransaction(...args: {account:typeof account;chain:string;transaction:Uint8Array}[]): Promise<readonly {signedTransaction:Uint8Array}[]> }
  return {
    publicKey:new PublicKey(account.address),
    async signTransaction(transaction) {
      if (!wallet.accounts.some(a => a.address === account.address)) throw new Error('WALLET_ACCOUNT_DISCONNECTED')
      const [result] = await sign.signTransaction({account,chain,transaction:transaction.serialize()})
      if (!result) throw new Error('WALLET_DID_NOT_RETURN_TRANSACTION')
      return VersionedTransaction.deserialize(result.signedTransaction)
    },
  }
}
